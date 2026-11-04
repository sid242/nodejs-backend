import { and, count, eq, isNull } from 'drizzle-orm';

import { db } from '@/config/db';
import { tenantMembers, users } from '@/db/schema/index';
import { AppError } from '@/lib/errors';
import * as authRepo from '@/modules/auth/auth.repository';
import { groupsRepo } from '@/modules/groups/groups.repository';
import * as tenantsRepo from '@/modules/tenants/tenants.repository';
import { ScimCreateUserDto, ScimPatchUserDto, ScimQueryDto } from './scim.dto';

export class ScimService {
  getServiceProviderConfig() {
    return {
      schemas: ['urn:ietf:params:scim:schemas:core:2.0:ServiceProviderConfig'],
      documentationUri: 'https://docs.saas-platform.com/scim',
      patch: { supported: true },
      bulk: { supported: false, maxOperations: 0, maxPayloadSize: 0 },
      filter: { supported: true, maxResults: 100 },
      changePassword: { supported: false },
      sort: { supported: false },
      etag: { supported: false },
      authenticationSchemes: [
        {
          name: 'OAuth Bearer Token',
          description: 'Authentication using tenant-scoped Bearer token',
          specUri: 'http://www.rfc-editor.org/info/rfc6750',
          type: 'oauthbearertoken',
          primary: true,
        },
      ],
      meta: {
        location: '/api/v1/scim/v2/ServiceProviderConfig',
        resourceType: 'ServiceProviderConfig',
      },
    };
  }

  getSchemas() {
    return {
      schemas: ['urn:ietf:params:scim:api:messages:2.0:ListResponse'],
      totalResults: 2,
      itemsPerPage: 2,
      startIndex: 1,
      Resources: [
        this.getSchemaById('urn:ietf:params:scim:schemas:core:2.0:User'),
        this.getSchemaById('urn:ietf:params:scim:schemas:core:2.0:Group'),
      ],
    };
  }

  getSchemaById(id: string) {
    if (id === 'urn:ietf:params:scim:schemas:core:2.0:User' || id === 'User') {
      return {
        id: 'urn:ietf:params:scim:schemas:core:2.0:User',
        name: 'User',
        description: 'Core User Schema',
        attributes: [
          { name: 'userName', type: 'string', multiValued: false, required: true },
          { name: 'name', type: 'complex', multiValued: false, required: false },
          { name: 'emails', type: 'complex', multiValued: true, required: false },
          { name: 'active', type: 'boolean', multiValued: false, required: false },
        ],
        meta: {
          location: '/api/v1/scim/v2/Schemas/urn:ietf:params:scim:schemas:core:2.0:User',
          resourceType: 'Schema',
        },
      };
    }

    return {
      id: 'urn:ietf:params:scim:schemas:core:2.0:Group',
      name: 'Group',
      description: 'Core Group Schema',
      attributes: [
        { name: 'displayName', type: 'string', multiValued: false, required: true },
        { name: 'members', type: 'complex', multiValued: true, required: false },
      ],
      meta: {
        location: '/api/v1/scim/v2/Schemas/urn:ietf:params:scim:schemas:core:2.0:Group',
        resourceType: 'Schema',
      },
    };
  }

  private formatScimUser(user: any, membership: any) {
    const isActive = membership?.status === 'ACTIVE';
    const parts = (user?.name || '').split(' ');
    const firstName = parts[0] || '';
    const lastName = parts.slice(1).join(' ') || '';

    return {
      schemas: ['urn:ietf:params:scim:schemas:core:2.0:User'],
      id: user.id,
      userName: user.email,
      name: {
        givenName: firstName,
        familyName: lastName,
        formatted: user.name || user.email,
      },
      displayName: user.name || user.email,
      emails: [
        {
          value: user.email,
          primary: true,
          type: 'work',
        },
      ],
      active: isActive,
      roles: membership?.role ? [{ value: membership.role }] : [],
      meta: {
        resourceType: 'User',
        created: user.createdAt,
        lastModified: membership?.updatedAt || user.updatedAt,
        location: `/api/v1/scim/v2/Users/${user.id}`,
      },
    };
  }

  async listUsers(tenantId: string, query: ScimQueryDto) {
    let emailFilter: string | undefined;

    if (query.filter) {
      const match = query.filter.match(/userName\s+eq\s+["']?([^"']+)["']?/i);
      if (match?.[1]) {
        emailFilter = match[1].trim().toLowerCase();
      }
    }

    const conditions = [
      eq(tenantMembers.tenantId, tenantId),
      isNull(tenantMembers.deletedAt),
    ];
    if (emailFilter) {
      conditions.push(eq(users.email, emailFilter));
    }

    const [totalRow] = await db
      .select({ count: count() })
      .from(tenantMembers)
      .innerJoin(users, eq(tenantMembers.userId, users.id))
      .where(and(...conditions));

    const total = Number(totalRow?.count ?? 0);

    const rows = await db
      .select({
        member: tenantMembers,
        user: users,
      })
      .from(tenantMembers)
      .innerJoin(users, eq(tenantMembers.userId, users.id))
      .where(and(...conditions))
      .limit(query.count)
      .offset(Math.max(0, query.startIndex - 1));

    const resources = rows.map((r) => this.formatScimUser(r.user, r.member));

    return {
      schemas: ['urn:ietf:params:scim:api:messages:2.0:ListResponse'],
      totalResults: total,
      startIndex: query.startIndex,
      itemsPerPage: resources.length,
      Resources: resources,
    };
  }

  async getUser(tenantId: string, userId: string) {
    const membership = await tenantsRepo.findTenantMember(tenantId, userId);
    if (!membership) {
      throw AppError.notFound(`User ${userId} not found in this workspace`);
    }

    const user = await authRepo.findById(userId);
    if (!user) {
      throw AppError.notFound(`User ${userId} record not found`);
    }

    return this.formatScimUser(user, membership);
  }

  async createUser(tenantId: string, payload: ScimCreateUserDto) {
    const email = (payload.userName || payload.emails?.[0]?.value)?.trim()?.toLowerCase();
    if (!email) {
      throw AppError.badRequest('Valid email/userName is required');
    }

    const displayName =
      payload.displayName ||
      `${payload.name?.givenName || ''} ${payload.name?.familyName || ''}`.trim() ||
      'SCIM User';

    let user = await authRepo.findByEmail(email);
    if (!user) {
      const created = await authRepo.createUser({
        email,
        passwordHash: 'SCIM_MANAGED_ACCOUNT_NO_PASSWORD',
        name: displayName,
      });
      if (payload.active) {
        await db.update(users).set({ status: 'ACTIVE' }).where(eq(users.id, created.id));
      }
      user = await authRepo.findById(created.id);
    }

    if (!user) {
      throw AppError.internal('Failed to provision SCIM user');
    }

    let membership = await tenantsRepo.findTenantMember(tenantId, user.id);
    if (membership) {
      await tenantsRepo.updateTenantMemberStatus(
        membership.id,
        payload.active ? 'ACTIVE' : 'SUSPENDED',
      );
      membership = await tenantsRepo.findTenantMember(tenantId, user.id);
    } else {
      membership = await tenantsRepo.addTenantMember({
        tenantId,
        userId: user.id,
        status: payload.active ? 'ACTIVE' : 'SUSPENDED',
      });
    }

    return this.formatScimUser(user, membership);
  }

  async updateUser(tenantId: string, userId: string, payload: ScimCreateUserDto) {
    let membership = await tenantsRepo.findTenantMember(tenantId, userId);
    if (!membership) {
      throw AppError.notFound(`User ${userId} not found in workspace`);
    }

    const displayName =
      payload.displayName ||
      `${payload.name?.givenName || ''} ${payload.name?.familyName || ''}`.trim();

    if (displayName) {
      await db
        .update(users)
        .set({ name: displayName, updatedAt: new Date() })
        .where(eq(users.id, userId));
    }

    await tenantsRepo.updateTenantMemberStatus(
      membership.id,
      payload.active ? 'ACTIVE' : 'SUSPENDED',
    );

    const user = await authRepo.findById(userId);
    membership = await tenantsRepo.findTenantMember(tenantId, userId);

    return this.formatScimUser(user, membership);
  }

  async patchUser(tenantId: string, userId: string, payload: ScimPatchUserDto) {
    let membership = await tenantsRepo.findTenantMember(tenantId, userId);
    if (!membership) {
      throw AppError.notFound(`User ${userId} not found in workspace`);
    }

    let newStatus = membership.status;
    let newDisplayName: string | undefined;

    for (const op of payload.Operations) {
      const opType = op.op?.toLowerCase();
      if (opType === 'replace' || opType === 'add') {
        const path = op.path?.toLowerCase();

        if (path === 'active') {
          newStatus = op.value === true || op.value === 'true' ? 'ACTIVE' : 'SUSPENDED';
        } else if (op.value && typeof op.value === 'object') {
          if (op.value.active !== undefined) {
            newStatus = op.value.active ? 'ACTIVE' : 'SUSPENDED';
          }
          if (op.value.displayName) {
            newDisplayName = String(op.value.displayName);
          }
        } else if (path === 'displayname') {
          newDisplayName = String(op.value);
        }
      }
    }

    if (newDisplayName) {
      await db
        .update(users)
        .set({ name: newDisplayName, updatedAt: new Date() })
        .where(eq(users.id, userId));
    }

    if (newStatus !== membership.status) {
      await tenantsRepo.updateTenantMemberStatus(membership.id, newStatus);
    }

    const user = await authRepo.findById(userId);
    membership = await tenantsRepo.findTenantMember(tenantId, userId);

    return this.formatScimUser(user, membership);
  }

  async deleteUser(tenantId: string, userId: string) {
    const membership = await tenantsRepo.findTenantMember(tenantId, userId);
    if (!membership) {
      throw AppError.notFound(`User ${userId} not found in workspace`);
    }

    await tenantsRepo.removeTenantMember(tenantId, membership.id);
  }

  async listGroups(tenantId: string, query: ScimQueryDto) {
    const groups = await groupsRepo.listGroups({
      scope: 'TENANT',
      tenantId,
      page: Math.floor(query.startIndex / query.count) + 1,
      limit: query.count,
    });

    const resources = groups.items.map((g: any) => ({
      schemas: ['urn:ietf:params:scim:schemas:core:2.0:Group'],
      id: g.id,
      displayName: g.name,
      meta: {
        resourceType: 'Group',
        created: g.createdAt,
        lastModified: g.updatedAt,
        location: `/api/v1/scim/v2/Groups/${g.id}`,
      },
    }));

    return {
      schemas: ['urn:ietf:params:scim:api:messages:2.0:ListResponse'],
      totalResults: groups.total,
      startIndex: query.startIndex,
      itemsPerPage: resources.length,
      Resources: resources,
    };
  }

  async getGroup(tenantId: string, groupId: string) {
    const group = await groupsRepo.findGroupById(groupId, 'TENANT');
    if (!group || group.tenantId !== tenantId) {
      throw AppError.notFound(`Group ${groupId} not found`);
    }

    const members = await groupsRepo.listTenantGroupMembers(groupId, tenantId, 1, 100);

    return {
      schemas: ['urn:ietf:params:scim:schemas:core:2.0:Group'],
      id: group.id,
      displayName: group.name,
      members: members.items.map((m: any) => ({
        value: m.userId,
        display: m.name || m.email,
      })),
      meta: {
        resourceType: 'Group',
        created: group.createdAt,
        lastModified: group.updatedAt,
        location: `/api/v1/scim/v2/Groups/${group.id}`,
      },
    };
  }
}

export const scimService = new ScimService();
