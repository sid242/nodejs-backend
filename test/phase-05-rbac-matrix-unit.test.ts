import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  createRoleDto,
  listRolesFilterDto,
  updateRoleDto,
  createPermissionDto,
} from '@/modules/rbac/rbac.dto';
import * as rbacService from '@/modules/rbac/rbac.service';
import { rbacRepo } from '@/modules/rbac/rbac.repository';
import { AppError } from '@/lib/errors';
import { cache } from '@/lib/cache';

describe('Phase 05: Roles & Permissions (RBAC Matrix) Unit Tests', () => {
  describe('1. listRolesFilterDto validation', () => {
    it('applies default pagination and sorting when empty object provided', () => {
      const parsed = listRolesFilterDto.parse({});
      assert.equal(parsed.page, 1);
      assert.equal(parsed.limit, 20);
      assert.equal(parsed.sortBy, 'createdAt');
      assert.equal(parsed.sortOrder, 'desc');
      assert.equal(parsed.scope, 'ALL');
      assert.equal(parsed.status, 'ALL');
      assert.equal(parsed.isSystem, 'all');
    });

    it('accepts multi-field filtering parameters', () => {
      const parsed = listRolesFilterDto.parse({
        search: 'Manager',
        scope: 'TENANT',
        status: 'ACTIVE',
        isSystem: 'false',
        module: 'billing',
        permission: 'billing:read',
        page: 2,
        limit: 10,
        sortBy: 'name',
        sortOrder: 'asc',
      });

      assert.equal(parsed.search, 'Manager');
      assert.equal(parsed.scope, 'TENANT');
      assert.equal(parsed.status, 'ACTIVE');
      assert.equal(parsed.isSystem, 'false');
      assert.equal(parsed.module, 'billing');
      assert.equal(parsed.permission, 'billing:read');
      assert.equal(parsed.page, 2);
      assert.equal(parsed.limit, 10);
      assert.equal(parsed.sortBy, 'name');
      assert.equal(parsed.sortOrder, 'asc');
    });

    it('rejects invalid scope values', () => {
      assert.throws(() => {
        listRolesFilterDto.parse({ scope: 'INVALID_SCOPE' });
      });
    });
  });

  describe('2. createRoleDto and updateRoleDto validation', () => {
    it('validates role creation payload with valid code and permissions', () => {
      const valid = {
        name: 'Billing Auditor',
        code: 'BILLING_AUDITOR',
        description: 'Audits tenant invoices and payment methods',
        scope: 'TENANT' as const,
        permissions: ['billing:read', 'audit:read'],
        isActive: true,
      };

      const parsed = createRoleDto.parse(valid);
      assert.equal(parsed.name, 'Billing Auditor');
      assert.equal(parsed.code, 'BILLING_AUDITOR');
      assert.deepEqual(parsed.permissions, ['billing:read', 'audit:read']);
      assert.equal(parsed.isActive, true);
    });

    it('rejects empty permissions list on role creation', () => {
      assert.throws(() => {
        createRoleDto.parse({
          name: 'Empty Role',
          permissions: [],
        });
      });
    });

    it('rejects invalid role code characters', () => {
      assert.throws(() => {
        createRoleDto.parse({
          name: 'Invalid Code Role',
          code: 'INVALID CODE with spaces!',
          permissions: ['files:read'],
        });
      });
    });

    it('validates partial update payload', () => {
      const parsed = updateRoleDto.parse({
        name: 'Senior Billing Auditor',
        isActive: false,
      });
      assert.equal(parsed.name, 'Senior Billing Auditor');
      assert.equal(parsed.isActive, false);
      assert.equal(parsed.permissions, undefined);
    });
  });

  describe('3. createPermissionDto metadata validation', () => {
    it('validates rich permission metadata including risk level and scope', () => {
      const parsed = createPermissionDto.parse({
        key: 'subscriptions:manage',
        code: 'subscriptions:manage',
        name: 'Manage Subscriptions',
        description: 'Modify tenant subscription tiers and seat counts',
        scope: 'TENANT',
        resource: 'subscriptions',
        action: 'manage',
        riskLevel: 'HIGH',
        isAssignable: true,
      });

      assert.equal(parsed.key, 'subscriptions:manage');
      assert.equal(parsed.riskLevel, 'HIGH');
      assert.equal(parsed.scope, 'TENANT');
      assert.equal(parsed.action, 'manage');
    });

    it('rejects invalid permission key format', () => {
      assert.throws(() => {
        createPermissionDto.parse({
          key: 'invalid-permission-without-colon',
          name: 'Bad Key',
        });
      });
    });
  });

  describe('4. Scope Mismatch Enforcement', () => {
    it('rejects creating a tenant role with platform-scoped permissions', async () => {
      // Mock repository methods
      const originalFindAll = rbacRepo.findAllPermissions;
      try {
        rbacRepo.findAllPermissions = async () => [
          {
            id: 'perm-tenant-1',
            moduleId: 'mod-1',
            key: 'files:read',
            code: 'files:read',
            name: 'Read Files',
            description: null,
            action: 'read',
            resource: 'files',
            category: 'files',
            scope: 'TENANT',
            riskLevel: 'LOW',
            isSystem: true,
            isAssignable: true,
            createdAt: new Date(),
          },
          {
            id: 'perm-platform-1',
            moduleId: 'mod-2',
            key: 'platform_staff:read',
            code: 'platform_staff:read',
            name: 'Read Platform Staff',
            description: null,
            action: 'read',
            resource: 'platform_staff',
            category: 'platform',
            scope: 'PLATFORM',
            riskLevel: 'CRITICAL',
            isSystem: true,
            isAssignable: true,
            createdAt: new Date(),
          },
        ];

        await assert.rejects(
          async () => {
            await rbacService.createCustomTenantRole(
              'tenant-123',
              {
                name: 'Cross Scope Role',
                scope: 'TENANT',
                permissions: ['files:read', 'platform_staff:read'],
              },
            );
          },
          (err: any) => {
            assert.ok(err instanceof AppError);
            assert.equal(err.status, 400);
            assert.match(err.message, /Permission scope mismatch/i);
            return true;
          },
        );
      } finally {
        rbacRepo.findAllPermissions = originalFindAll;
      }
    });
  });

  describe('5. Protected System Roles Safeguards', () => {
    it('prevents renaming built-in system roles', async () => {
      const originalFindRoleById = rbacRepo.findRoleById;
      try {
        rbacRepo.findRoleById = async () => ({
          id: 'role-owner-1',
          tenantId: null,
          code: 'OWNER',
          name: 'OWNER',
          description: 'Owner system role',
          scope: 'TENANT',
          isActive: true,
          isSystem: true,
          createdAt: new Date(),
          updatedAt: new Date(),
        });

        await assert.rejects(
          async () => {
            await rbacService.updateCustomTenantRole('tenant-123', 'role-owner-1', {
              name: 'Renamed Owner',
            });
          },
          (err: any) => {
            assert.ok(err instanceof AppError);
            assert.equal(err.status, 403);
            assert.match(err.message, /Cannot rename built-in system roles/i);
            return true;
          },
        );
      } finally {
        rbacRepo.findRoleById = originalFindRoleById;
      }
    });

    it('prevents deactivating built-in system roles', async () => {
      const originalFindRoleById = rbacRepo.findRoleById;
      try {
        rbacRepo.findRoleById = async () => ({
          id: 'role-admin-1',
          tenantId: null,
          code: 'ADMIN',
          name: 'ADMIN',
          description: 'Admin system role',
          scope: 'TENANT',
          isActive: true,
          isSystem: true,
          createdAt: new Date(),
          updatedAt: new Date(),
        });

        await assert.rejects(
          async () => {
            await rbacService.updateCustomTenantRole('tenant-123', 'role-admin-1', {
              isActive: false,
            });
          },
          (err: any) => {
            assert.ok(err instanceof AppError);
            assert.equal(err.status, 403);
            assert.match(err.message, /Cannot deactivate built-in system roles/i);
            return true;
          },
        );
      } finally {
        rbacRepo.findRoleById = originalFindRoleById;
      }
    });

    it('prevents deleting built-in system roles', async () => {
      const originalFindRoleById = rbacRepo.findRoleById;
      try {
        rbacRepo.findRoleById = async () => ({
          id: 'role-member-1',
          tenantId: null,
          code: 'MEMBER',
          name: 'MEMBER',
          description: 'Member system role',
          scope: 'TENANT',
          isActive: true,
          isSystem: true,
          createdAt: new Date(),
          updatedAt: new Date(),
        });

        await assert.rejects(
          async () => {
            await rbacService.deleteTenantRole('tenant-123', 'role-member-1');
          },
          (err: any) => {
            assert.ok(err instanceof AppError);
            assert.equal(err.status, 403);
            assert.match(err.message, /Cannot delete built-in system roles/i);
            return true;
          },
        );
      } finally {
        rbacRepo.findRoleById = originalFindRoleById;
      }
    });
  });

  describe('6. Role Deletion In-Use Safeguards', () => {
    it('blocks role deletion if members are currently assigned', async () => {
      const originalFindRoleById = rbacRepo.findRoleById;
      const originalCountMembers = rbacRepo.countMembersAssignedToRole;
      try {
        rbacRepo.findRoleById = async () => ({
          id: 'role-custom-1',
          tenantId: 'tenant-123',
          code: 'CUSTOM_ROLE',
          name: 'Custom Role',
          description: null,
          scope: 'TENANT',
          isActive: true,
          isSystem: false,
          createdAt: new Date(),
          updatedAt: new Date(),
        });
        rbacRepo.countMembersAssignedToRole = async () => 3;

        await assert.rejects(
          async () => {
            await rbacService.deleteTenantRole('tenant-123', 'role-custom-1');
          },
          (err: any) => {
            assert.ok(err instanceof AppError);
            assert.equal(err.status, 400);
            assert.match(err.message, /currently assigned to 3 member\(s\)/i);
            return true;
          },
        );
      } finally {
        rbacRepo.findRoleById = originalFindRoleById;
        rbacRepo.countMembersAssignedToRole = originalCountMembers;
      }
    });

    it('blocks role deletion if user groups are currently bound', async () => {
      const originalFindRoleById = rbacRepo.findRoleById;
      const originalCountMembers = rbacRepo.countMembersAssignedToRole;
      const originalCountGroups = rbacRepo.countGroupsAssignedToRole;
      try {
        rbacRepo.findRoleById = async () => ({
          id: 'role-custom-2',
          tenantId: 'tenant-123',
          code: 'GROUP_ROLE',
          name: 'Group Bound Role',
          description: null,
          scope: 'TENANT',
          isActive: true,
          isSystem: false,
          createdAt: new Date(),
          updatedAt: new Date(),
        });
        rbacRepo.countMembersAssignedToRole = async () => 0;
        rbacRepo.countGroupsAssignedToRole = async () => 2;

        await assert.rejects(
          async () => {
            await rbacService.deleteTenantRole('tenant-123', 'role-custom-2');
          },
          (err: any) => {
            assert.ok(err instanceof AppError);
            assert.equal(err.status, 400);
            assert.match(err.message, /currently assigned to 2 user group\(s\)/i);
            return true;
          },
        );
      } finally {
        rbacRepo.findRoleById = originalFindRoleById;
        rbacRepo.countMembersAssignedToRole = originalCountMembers;
        rbacRepo.countGroupsAssignedToRole = originalCountGroups;
      }
    });
  });

  describe('7. Actor Grantability (Privilege Escalation Protection)', () => {
    it('prevents non-owner caller from granting permissions they do not possess', async () => {
      const originalFindAll = rbacRepo.findAllPermissions;
      const originalGetEffective = rbacRepo.getEffectivePermissions;
      try {
        rbacRepo.findAllPermissions = async () => [
          {
            id: 'p1',
            moduleId: 'm1',
            key: 'files:read',
            code: 'files:read',
            name: 'Read Files',
            description: null,
            action: 'read',
            resource: 'files',
            category: 'files',
            scope: 'TENANT',
            riskLevel: 'LOW',
            isSystem: true,
            isAssignable: true,
            createdAt: new Date(),
          },
          {
            id: 'p2',
            moduleId: 'm1',
            key: 'billing:manage',
            code: 'billing:manage',
            name: 'Manage Billing',
            description: null,
            action: 'manage',
            resource: 'billing',
            category: 'billing',
            scope: 'TENANT',
            riskLevel: 'HIGH',
            isSystem: true,
            isAssignable: true,
            createdAt: new Date(),
          },
        ];

        // Caller only has files:read and MEMBER role
        rbacRepo.getEffectivePermissions = async () => ({
          roles: ['MEMBER'],
          permissions: ['files:read'],
        });

        await assert.rejects(
          async () => {
            await rbacService.createCustomTenantRole(
              'tenant-123',
              {
                name: 'Elevated Role',
                permissions: ['files:read', 'billing:manage'],
              },
              'caller-user-id-456',
            );
          },
          (err: any) => {
            assert.ok(err instanceof AppError);
            assert.equal(err.status, 403);
            assert.match(err.message, /Unauthorized grant.*billing:manage/i);
            return true;
          },
        );
      } finally {
        rbacRepo.findAllPermissions = originalFindAll;
        rbacRepo.getEffectivePermissions = originalGetEffective;
      }
    });

    it('allows OWNER caller to grant any valid tenant permissions', async () => {
      const originalFindAll = rbacRepo.findAllPermissions;
      const originalGetEffective = rbacRepo.getEffectivePermissions;
      const originalFindCode = rbacRepo.findRoleByCode;
      const originalCreateRole = rbacRepo.createRole;
      const originalSetPerms = rbacRepo.setRolePermissions;
      const originalDelByPrefix = cache.delByPrefix;

      try {
        rbacRepo.findAllPermissions = async () => [
          {
            id: 'p1',
            moduleId: 'm1',
            key: 'files:read',
            code: 'files:read',
            name: 'Read Files',
            description: null,
            action: 'read',
            resource: 'files',
            category: 'files',
            scope: 'TENANT',
            riskLevel: 'LOW',
            isSystem: true,
            isAssignable: true,
            createdAt: new Date(),
          },
          {
            id: 'p2',
            moduleId: 'm1',
            key: 'billing:manage',
            code: 'billing:manage',
            name: 'Manage Billing',
            description: null,
            action: 'manage',
            resource: 'billing',
            category: 'billing',
            scope: 'TENANT',
            riskLevel: 'HIGH',
            isSystem: true,
            isAssignable: true,
            createdAt: new Date(),
          },
        ];

        // Caller has OWNER role
        rbacRepo.getEffectivePermissions = async () => ({
          roles: ['OWNER'],
          permissions: ['files:read', 'billing:manage'],
        });

        rbacRepo.findRoleByCode = async () => null;
        rbacRepo.createRole = async (data) => ({
          id: 'role-new-1',
          tenantId: data.tenantId ?? null,
          code: data.code ?? 'FINANCE_LEAD',
          name: data.name,
          description: data.description ?? null,
          scope: data.scope ?? 'TENANT',
          isActive: data.isActive ?? true,
          isSystem: data.isSystem ?? false,
          createdAt: new Date(),
          updatedAt: new Date(),
        });
        rbacRepo.setRolePermissions = async () => {};
        cache.delByPrefix = async () => {};

        const role = await rbacService.createCustomTenantRole(
          'tenant-123',
          {
            name: 'Finance Lead',
            code: 'FINANCE_LEAD',
            permissions: ['files:read', 'billing:manage'],
          },
          'owner-user-id',
        );

        assert.equal(role.id, 'role-new-1');
        assert.equal(role.code, 'FINANCE_LEAD');
        assert.deepEqual(role.permissions, ['files:read', 'billing:manage']);
      } finally {
        rbacRepo.findAllPermissions = originalFindAll;
        rbacRepo.getEffectivePermissions = originalGetEffective;
        rbacRepo.findRoleByCode = originalFindCode;
        rbacRepo.createRole = originalCreateRole;
        rbacRepo.setRolePermissions = originalSetPerms;
        cache.delByPrefix = originalDelByPrefix;
      }
    });
  });

  describe('8. Role Disablement and Cache Invalidation', () => {
    it('invalidates rbac cache on role updates and deletions', async () => {
      const originalFindRoleById = rbacRepo.findRoleById;
      const originalCountMembers = rbacRepo.countMembersAssignedToRole;
      const originalCountGroups = rbacRepo.countGroupsAssignedToRole;
      const originalDeleteRole = rbacRepo.deleteRole;
      const originalDelByPrefix = cache.delByPrefix;

      let cacheInvalidated = false;

      try {
        rbacRepo.findRoleById = async () => ({
          id: 'role-to-del',
          tenantId: 'tenant-123',
          code: 'OBSOLETE',
          name: 'Obsolete Role',
          description: null,
          scope: 'TENANT',
          isActive: true,
          isSystem: false,
          createdAt: new Date(),
          updatedAt: new Date(),
        });
        rbacRepo.countMembersAssignedToRole = async () => 0;
        rbacRepo.countGroupsAssignedToRole = async () => 0;
        rbacRepo.deleteRole = async () => true;

        cache.delByPrefix = async (prefix: string) => {
          if (prefix.includes('tenant-123')) {
            cacheInvalidated = true;
          }
        };

        await rbacService.deleteTenantRole('tenant-123', 'role-to-del');
        assert.equal(cacheInvalidated, true);
      } finally {
        rbacRepo.findRoleById = originalFindRoleById;
        rbacRepo.countMembersAssignedToRole = originalCountMembers;
        rbacRepo.countGroupsAssignedToRole = originalCountGroups;
        rbacRepo.deleteRole = originalDeleteRole;
        cache.delByPrefix = originalDelByPrefix;
      }
    });
  });
});
