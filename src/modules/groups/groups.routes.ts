import { Router } from 'express';

import { requireAuth } from '@/middleware/auth';
import { requirePermission } from '@/middleware/rbac';
import { requireTenant } from '@/middleware/tenant';
import { validate } from '@/middleware/validate';

import * as controller from './groups.controller';
import * as dto from './groups.dto';

const router: Router = Router();

// All tenant group routes require authentication and an active tenant context
router.use(requireAuth, requireTenant);

// Group CRUD
router.get(
  '/',
  requirePermission('groups:read'),
  validate({ query: dto.listGroupsQueryDto }),
  controller.listGroups,
);

router.post(
  '/',
  requirePermission('groups:create'),
  validate({ body: dto.createGroupDto }),
  controller.createGroup,
);

router.get(
  '/:groupId',
  requirePermission('groups:read'),
  validate({ params: dto.groupIdParamDto }),
  controller.getGroup,
);

router.patch(
  '/:groupId',
  requirePermission('groups:update'),
  validate({ params: dto.groupIdParamDto, body: dto.updateGroupDto }),
  controller.updateGroup,
);

router.delete(
  '/:groupId',
  requirePermission('groups:delete'),
  validate({ params: dto.groupIdParamDto }),
  controller.archiveGroup,
);

// Group Membership Management
router.get(
  '/:groupId/members',
  requirePermission('groups:read'),
  validate({ params: dto.groupIdParamDto }),
  controller.listGroupMembers,
);

router.post(
  '/:groupId/members',
  requirePermission('groups:manage-members'),
  validate({ params: dto.groupIdParamDto, body: dto.addTenantGroupMembersDto }),
  controller.addGroupMembers,
);

router.delete(
  '/:groupId/members/:userId',
  requirePermission('groups:manage-members'),
  validate({ params: dto.groupMemberParamsDto }),
  controller.removeGroupMember,
);

// Group Role Bindings & Permissions Contribution
router.get(
  '/:groupId/roles',
  requirePermission('groups:read'),
  validate({ params: dto.groupIdParamDto }),
  controller.listGroupRoles,
);

router.post(
  '/:groupId/roles',
  requirePermission('groups:assign-roles'),
  validate({ params: dto.groupIdParamDto, body: dto.bindRoleDto }),
  controller.bindGroupRole,
);

router.delete(
  '/:groupId/roles/:roleId',
  requirePermission('groups:assign-roles'),
  validate({ params: dto.groupRoleParamsDto }),
  controller.unbindGroupRole,
);

router.get(
  '/:groupId/permissions',
  requirePermission('groups:read'),
  validate({ params: dto.groupIdParamDto }),
  controller.getGroupPermissions,
);

export default router;

