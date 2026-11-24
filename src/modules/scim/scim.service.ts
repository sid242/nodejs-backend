import { createHash } from 'node:crypto';

import { REDIS_PREFIXES } from '@/constants/index';
import type { TenantMember, User } from '@/db/schema';
import { cache } from '@/lib/cache';
import * as auditRepo from '@/modules/audit/audit.repository';
import { revokeAllUserTokens } from '@/modules/auth/tokens';
import * as billingService from '@/modules/billing/billing.service';
import { groupsRepo } from '@/modules/groups/groups.repository';
import { ssoRepo } from '@/modules/sso/sso.repository';
import { disconnectWorkspaceMember, emitToUser } from '@/sockets/emitter';

import { ScimCreateUserDto, ScimError, ScimPatchUserDto, ScimQueryDto } from './scim.dto';
import { scimRepo } from './scim.repository';

export class ScimService {
  getServiceProviderConfig() {
    return {
      schemas: ['urn:ietf:params:scim:schemas:core:2.0:ServiceProviderConfig'],
      documentationUri: 'https://docs.saas-platform.com/scim',
      patch: { supported: true },
      bulk: { supported: false, maxOperations: 0, maxPayloadSize: 0 },
      filter: { supported: true, maxResults: 200 },
      changePassword: { supported: false },
      sort: { supported: false },
      etag: { supported: true },
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
          { name: 'externalId', type: 'string', multiValued: false, required: false },
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

  getResourceTypes() {
    return {
      schemas: ['urn:ietf:params:scim:api:messages:2.0:ListResponse'],
      totalResults: 2,
      itemsPerPage: 2,
      startIndex: 1,
      Resources: [this.getResourceTypeById('User'), this.getResourceTypeById('Group')],
    };
  }

  getResourceTypeById(id: string) {
    if (id.toLowerCase() === 'user') {
      return {
        schemas: ['urn:ietf:params:scim:schemas:core:2.0:ResourceType'],
        id: 'User',
        name: 'User',
        endpoint: '/Users',
        description: 'User Account',
        schema: 'urn:ietf:params:scim:schemas:core:2.0:User',
        meta: {
          location: '/api/v1/scim/v2/ResourceTypes/User',
          resourceType: 'ResourceType',
        },
      };
    }

    return {
      schemas: ['urn:ietf:params:scim:schemas:core:2.0:ResourceType'],
      id: 'Group',
      name: 'Group',
      endpoint: '/Groups',
      description: 'Group',
      schema: 'urn:ietf:params:scim:schemas:core:2.0:Group',
      meta: {
        location: '/api/v1/scim/v2/ResourceTypes/Group',
        resourceType: 'ResourceType',
      },
    };
  }

  private formatScimUser(user: User, membership: TenantMember & { role?: string }) {
    const isActive = membership?.status === 'ACTIVE';
    const firstName = user?.firstName ?? '';
    const lastName = user?.lastName ?? '';
    const displayName = [firstName, lastName].filter(Boolean).join(' ') || user.email;

    const lastModified = membership?.updatedAt || user?.updatedAt || new Date();
    const versionHash = createHash('sha256')
      .update(`${membership?.id}:${lastModified.getTime()}:${membership?.status}`)
      .digest('hex')
      .slice(0, 16);

    return {
      schemas: ['urn:ietf:params:scim:schemas:core:2.0:User'],
      id: user.id,
      userName: user.email,
      name: {
        givenName: firstName,
        familyName: lastName,
        formatted: displayName,
      },
      displayName,
      emails: [
        {
          value: user.email,
          primary: true,
          type: 'work',
        },
      ],
      active: isActive,
      externalId: membership?.externalId ?? undefined,
      roles: membership?.role ? [{ value: membership.role }] : [],
      meta: {
        resourceType: 'User',
        created: user.createdAt,
        lastModified,
        location: `/api/v1/scim/v2/Users/${user.id}`,
        version: `W/"${versionHash}"`,
      },
    };
  }

  private async revokeUserSessions(userId: string, tenantId: string, reason: string) {
    disconnectWorkspaceMember(tenantId, userId);
    await Promise.allSettled([
      revokeAllUserTokens(userId),
      cache.del(`${REDIS_PREFIXES.USER_CACHE}${userId}`),
    ]);

    try {
      emitToUser(userId, 'session:revoked', {
        tenantId,
        reason,
      });
    } catch {
      /* ignore socket emitter errors in offline tests */
    }
  }

  async listUsers(tenantId: string, query: ScimQueryDto) {
    await billingService.assertQuota(tenantId, 'sso.scim');

    let emailFilter: string | undefined;
    let externalIdFilter: string | undefined;
    let idFilter: string | undefined;

    if (query.filter) {
      const emailMatch = query.filter.match(/userName\s+eq\s+["']?([^"']+)["']?/i);
      if (emailMatch?.[1]) {
        emailFilter = emailMatch[1].trim().toLowerCase();
      }

      const extMatch = query.filter.match(/externalId\s+eq\s+["']?([^"']+)["']?/i);
      if (extMatch?.[1]) {
        externalIdFilter = extMatch[1].trim();
      }

      const idMatch = query.filter.match(/id\s+eq\s+["']?([^"']+)["']?/i);
      if (idMatch?.[1]) {
        idFilter = idMatch[1].trim();
      }
    }

    // 1. If filtering by email directly, resolve identity first
    if (emailFilter) {
      const user = await scimRepo.findUserByEmail(emailFilter);
      if (!user) {
        return {
          schemas: ['urn:ietf:params:scim:api:messages:2.0:ListResponse'],
          totalResults: 0,
          startIndex: query.startIndex,
          itemsPerPage: 0,
          Resources: [],
        };
      }

      const member = await scimRepo.findMemberByUserId(tenantId, user.id);
      if (!member) {
        return {
          schemas: ['urn:ietf:params:scim:api:messages:2.0:ListResponse'],
          totalResults: 0,
          startIndex: query.startIndex,
          itemsPerPage: 0,
          Resources: [],
        };
      }

      const resource = this.formatScimUser(user, member);
      return {
        schemas: ['urn:ietf:params:scim:api:messages:2.0:ListResponse'],
        totalResults: 1,
        startIndex: query.startIndex,
        itemsPerPage: 1,
        Resources: [resource],
      };
    }

    // 2. If filtering by externalId
    if (externalIdFilter) {
      const member = await scimRepo.findMemberByExternalId(tenantId, externalIdFilter);
      if (!member) {
        return {
          schemas: ['urn:ietf:params:scim:api:messages:2.0:ListResponse'],
          totalResults: 0,
          startIndex: query.startIndex,
          itemsPerPage: 0,
          Resources: [],
        };
      }

      const user = await scimRepo.findUserById(member.userId);
      const resource = user ? [this.formatScimUser(user, member)] : [];
      return {
        schemas: ['urn:ietf:params:scim:api:messages:2.0:ListResponse'],
        totalResults: resource.length,
        startIndex: query.startIndex,
        itemsPerPage: resource.length,
        Resources: resource,
      };
    }

    // 3. If filtering by ID
    if (idFilter) {
      const member = await scimRepo.findMemberByUserId(tenantId, idFilter);
      if (!member) {
        return {
          schemas: ['urn:ietf:params:scim:api:messages:2.0:ListResponse'],
          totalResults: 0,
          startIndex: query.startIndex,
          itemsPerPage: 0,
          Resources: [],
        };
      }

      const user = await scimRepo.findUserById(member.userId);
      const resource = user ? [this.formatScimUser(user, member)] : [];
      return {
        schemas: ['urn:ietf:params:scim:api:messages:2.0:ListResponse'],
        totalResults: resource.length,
        startIndex: query.startIndex,
        itemsPerPage: resource.length,
        Resources: resource,
      };
    }

    // 4. General paginated listing
    const { total, members } = await scimRepo.listMembers(tenantId, {
      startIndex: query.startIndex,
      count: Math.min(query.count, 200),
    });

    const userIds = members.map((m) => m.userId);
    const userRecords = await scimRepo.findUsersByIds(userIds);
    const userMap = new Map<string, any>(userRecords.map((u) => [u.id, u]));

    const resources = members
      .map((m) => {
        const u = userMap.get(m.userId);
        return u ? this.formatScimUser(u, m) : null;
      })
      .filter(Boolean);

    return {
      schemas: ['urn:ietf:params:scim:api:messages:2.0:ListResponse'],
      totalResults: total,
      startIndex: query.startIndex,
      itemsPerPage: resources.length,
      Resources: resources,
    };
  }

  async getUser(tenantId: string, userId: string) {
    await billingService.assertQuota(tenantId, 'sso.scim');

    const membership = await scimRepo.findMemberByUserId(tenantId, userId);
    if (!membership) {
      throw new ScimError(404, `User ${userId} not found in workspace`);
    }

    const user = await scimRepo.findUserById(userId);
    if (!user) {
      throw new ScimError(404, `User ${userId} record not found`);
    }

    return this.formatScimUser(user, membership);
  }

  async createUser(tenantId: string, payload: ScimCreateUserDto) {
    await billingService.assertQuota(tenantId, 'sso.scim');

    const email = (payload.userName || payload.emails?.[0]?.value)?.trim()?.toLowerCase();
    if (!email) {
      throw new ScimError(400, 'Valid email/userName is required', 'invalidValue');
    }

    // Enforce Tenant Domain Verification Policy
    const ssoConfig = await ssoRepo.findConfigByTenantId(tenantId);
    if (ssoConfig?.allowedDomains && ssoConfig.allowedDomains.length > 0) {
      const emailDomain = email.split('@')[1]?.toLowerCase();
      if (!emailDomain || !ssoConfig.allowedDomains.includes(emailDomain)) {
        throw new ScimError(
          403,
          `User email domain @${emailDomain} is not authorized for workspace domain policy`,
          'invalidValue',
        );
      }
    }

    const displayName =
      payload.displayName ||
      `${payload.name?.givenName || ''} ${payload.name?.familyName || ''}`.trim() ||
      email.split('@')[0] ||
      'SCIM User';

    let user = await scimRepo.findUserByEmail(email);

    if (user) {
      // Check if user is already a member of this tenant -> RFC 7644 409 uniqueness conflict
      const existingMembership = await scimRepo.findMemberByUserId(tenantId, user.id);
      if (existingMembership) {
        throw new ScimError(
          409,
          `User with userName ${email} already exists in this workspace`,
          'uniqueness',
        );
      }
    }

    // Assert workspace member limit quota
    await billingService.enforceLimit(tenantId, 'maxMembers');

    if (!user) {
      // Create user identity with unguessable null passwordHash and authMethod SCIM
      user = await scimRepo.createManagedUser({
        email,
        name: displayName,
        authMethod: 'SCIM',
        status: payload.active ? 'ACTIVE' : 'PENDING_VERIFICATION',
      });
    }

    const targetStatus = payload.active ? 'ACTIVE' : 'SUSPENDED';
    const membership = await scimRepo.createMember({
      tenantId,
      userId: user.id,
      status: targetStatus,
      externalId: payload.externalId,
    });

    await auditRepo.createAuditLog({
      tenantId,
      userId: user.id,
      action: 'SCIM_USER_PROVISIONED',
      entityType: 'USER',
      entityId: user.id,
      metadata: {
        email,
        externalId: payload.externalId,
        status: targetStatus,
      },
    });

    return this.formatScimUser(user, membership);
  }

  async updateUser(tenantId: string, userId: string, payload: ScimCreateUserDto) {
    await billingService.assertQuota(tenantId, 'sso.scim');

    const membership = await scimRepo.findMemberByUserId(tenantId, userId);
    if (!membership) {
      throw new ScimError(404, `User ${userId} not found in workspace`);
    }

    const displayName =
      payload.displayName ||
      `${payload.name?.givenName || ''} ${payload.name?.familyName || ''}`.trim();

    if (displayName) {
      await scimRepo.updateUserDisplayName(userId, displayName);
    }

    const newStatus = payload.active ? 'ACTIVE' : 'SUSPENDED';
    const statusChanged = membership.status !== newStatus;

    const updatedMembership = await scimRepo.updateMember(tenantId, membership.id, {
      status: newStatus,
      externalId: payload.externalId !== undefined ? payload.externalId : membership.externalId,
      tokenVersion: statusChanged ? (membership.tokenVersion ?? 1) + 1 : membership.tokenVersion,
      statusChangedAt: statusChanged ? new Date() : membership.statusChangedAt,
    });

    if (!updatedMembership) {
      throw new ScimError(404, `User ${userId} not found in workspace`);
    }

    if (statusChanged && newStatus === 'SUSPENDED') {
      await this.revokeUserSessions(userId, tenantId, 'SCIM_DEACTIVATED');
      await auditRepo.createAuditLog({
        tenantId,
        userId,
        action: 'SCIM_USER_DEACTIVATED',
        entityType: 'USER',
        entityId: userId,
      });
    }

    const user = await scimRepo.findUserById(userId);
    if (!user) {
      throw new ScimError(404, `User ${userId} record not found`);
    }
    return this.formatScimUser(user, updatedMembership);
  }

  async patchUser(tenantId: string, userId: string, payload: ScimPatchUserDto) {
    await billingService.assertQuota(tenantId, 'sso.scim');

    const membership = await scimRepo.findMemberByUserId(tenantId, userId);
    if (!membership) {
      throw new ScimError(404, `User ${userId} not found in workspace`);
    }

    let newStatus = membership.status;
    let newDisplayName: string | undefined;
    let newExternalId: string | undefined;

    for (const op of payload.Operations) {
      const opType = op.op?.toLowerCase();
      if (opType === 'replace' || opType === 'add') {
        const path = op.path?.toLowerCase();

        if (path === 'active') {
          newStatus = op.value === true || op.value === 'true' ? 'ACTIVE' : 'SUSPENDED';
        } else if (path === 'externalid') {
          newExternalId = String(op.value ?? '');
        } else if (path === 'displayname' || path === 'name.formatted') {
          newDisplayName = String(op.value ?? '');
        } else if (op.value && typeof op.value === 'object') {
          if (op.value.active !== undefined) {
            newStatus = op.value.active ? 'ACTIVE' : 'SUSPENDED';
          }
          if (op.value.externalId !== undefined) {
            newExternalId = String(op.value.externalId ?? '');
          }
          if (op.value.displayName) {
            newDisplayName = String(op.value.displayName);
          } else if (op.value.name?.formatted) {
            newDisplayName = String(op.value.name.formatted);
          }
        }
      } else if (opType === 'remove') {
        const path = op.path?.toLowerCase();
        if (path === 'externalid') {
          newExternalId = '';
        }
      }
    }

    if (newDisplayName) {
      await scimRepo.updateUserDisplayName(userId, newDisplayName);
    }

    const statusChanged = membership.status !== newStatus;
    const updatedMembership = await scimRepo.updateMember(tenantId, membership.id, {
      status: newStatus,
      externalId: newExternalId !== undefined ? newExternalId || null : membership.externalId,
      tokenVersion: statusChanged ? (membership.tokenVersion ?? 1) + 1 : membership.tokenVersion,
      statusChangedAt: statusChanged ? new Date() : membership.statusChangedAt,
    });

    if (!updatedMembership) {
      throw new ScimError(404, `User ${userId} not found in workspace`);
    }

    if (statusChanged && newStatus === 'SUSPENDED') {
      await this.revokeUserSessions(userId, tenantId, 'SCIM_DEACTIVATED');
      await auditRepo.createAuditLog({
        tenantId,
        userId,
        action: 'SCIM_USER_DEACTIVATED',
        entityType: 'USER',
        entityId: userId,
      });
    }

    const user = await scimRepo.findUserById(userId);
    if (!user) {
      throw new ScimError(404, `User ${userId} record not found`);
    }
    return this.formatScimUser(user, updatedMembership);
  }

  async deleteUser(tenantId: string, userId: string) {
    await billingService.assertQuota(tenantId, 'sso.scim');

    const membership = await scimRepo.findMemberByUserId(tenantId, userId);
    if (!membership) {
      throw new ScimError(404, `User ${userId} not found in workspace`);
    }

    await scimRepo.removeMember(tenantId, membership.id);
    await this.revokeUserSessions(userId, tenantId, 'SCIM_DELETED');

    await auditRepo.createAuditLog({
      tenantId,
      userId,
      action: 'SCIM_USER_DELETED',
      entityType: 'USER',
      entityId: userId,
    });
  }

  async listGroups(tenantId: string, query: ScimQueryDto) {
    await billingService.assertQuota(tenantId, 'sso.scim');

    const groups = await groupsRepo.listGroups({
      scope: 'TENANT',
      tenantId,
      page: Math.floor(query.startIndex / Math.min(query.count, 200)) + 1,
      limit: Math.min(query.count, 200),
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
    await billingService.assertQuota(tenantId, 'sso.scim');

    const group = await groupsRepo.findGroupById(groupId, 'TENANT');
    if (!group || group.tenantId !== tenantId) {
      throw new ScimError(404, `Group ${groupId} not found`);
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
