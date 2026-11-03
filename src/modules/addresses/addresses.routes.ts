import { Router } from 'express';

import { requireAuth } from '@/middleware/auth';
import { requirePermission } from '@/middleware/rbac';
import { addressLimiter } from '@/middleware/rate-limit';
import { blockInSupportSession } from '@/middleware/support';
import { resolveTenantContext } from '@/middleware/tenant';
import { validate } from '@/middleware/validate';
import * as controller from './addresses.controller';
import {
  addressBodyDto,
  addressIdParamDto,
  addressPatchDto,
  memberAddressParamDto,
  memberIdParamDto,
} from './addresses.dto';

const router = Router();

router.use(requireAuth);

// --- 1. USER OWNER (/addresses/me) ---
router.get('/me', controller.listMyAddresses);
router.post(
  '/me',
  addressLimiter,
  blockInSupportSession('Creating user address'),
  validate({ body: addressBodyDto }),
  controller.createMyAddress,
);
router.get('/me/:id', validate({ params: addressIdParamDto }), controller.getMyAddress);
router.patch(
  '/me/:id',
  addressLimiter,
  blockInSupportSession('Updating user address'),
  validate({ params: addressIdParamDto, body: addressPatchDto }),
  controller.updateMyAddress,
);
router.delete(
  '/me/:id',
  addressLimiter,
  blockInSupportSession('Deleting user address'),
  validate({ params: addressIdParamDto }),
  controller.deleteMyAddress,
);
router.post(
  '/me/:id/default',
  addressLimiter,
  blockInSupportSession('Setting default user address'),
  validate({ params: addressIdParamDto }),
  controller.setDefaultMyAddress,
);

// --- 2. TENANT OWNER (/addresses/workspace) ---
router.get(
  '/workspace',
  resolveTenantContext,
  requirePermission('addresses:read'),
  controller.listWorkspaceAddresses,
);
router.post(
  '/workspace',
  resolveTenantContext,
  requirePermission('addresses:write'),
  addressLimiter,
  blockInSupportSession('Creating workspace address'),
  validate({ body: addressBodyDto }),
  controller.createWorkspaceAddress,
);
router.get(
  '/workspace/:id',
  resolveTenantContext,
  requirePermission('addresses:read'),
  validate({ params: addressIdParamDto }),
  controller.getWorkspaceAddress,
);
router.patch(
  '/workspace/:id',
  resolveTenantContext,
  requirePermission('addresses:write'),
  addressLimiter,
  blockInSupportSession('Updating workspace address'),
  validate({ params: addressIdParamDto, body: addressPatchDto }),
  controller.updateWorkspaceAddress,
);
router.delete(
  '/workspace/:id',
  resolveTenantContext,
  requirePermission('addresses:delete'),
  addressLimiter,
  blockInSupportSession('Deleting workspace address'),
  validate({ params: addressIdParamDto }),
  controller.deleteWorkspaceAddress,
);
router.post(
  '/workspace/:id/default',
  resolveTenantContext,
  requirePermission('addresses:write'),
  addressLimiter,
  blockInSupportSession('Setting default workspace address'),
  validate({ params: addressIdParamDto }),
  controller.setDefaultWorkspaceAddress,
);

// --- 3. MEMBER OWNER (/addresses/members/:memberId) ---
router.get(
  '/members/:memberId',
  resolveTenantContext,
  requirePermission('members:read'),
  validate({ params: memberIdParamDto }),
  controller.listMemberAddresses,
);
router.post(
  '/members/:memberId',
  resolveTenantContext,
  requirePermission('members:update'),
  addressLimiter,
  blockInSupportSession('Creating member address'),
  validate({ params: memberIdParamDto, body: addressBodyDto }),
  controller.createMemberAddress,
);
router.get(
  '/members/:memberId/:id',
  resolveTenantContext,
  requirePermission('members:read'),
  validate({ params: memberAddressParamDto }),
  controller.getMemberAddress,
);
router.patch(
  '/members/:memberId/:id',
  resolveTenantContext,
  requirePermission('members:update'),
  addressLimiter,
  blockInSupportSession('Updating member address'),
  validate({ params: memberAddressParamDto, body: addressPatchDto }),
  controller.updateMemberAddress,
);
router.delete(
  '/members/:memberId/:id',
  resolveTenantContext,
  requirePermission('members:update'),
  addressLimiter,
  blockInSupportSession('Deleting member address'),
  validate({ params: memberAddressParamDto }),
  controller.deleteMemberAddress,
);
router.post(
  '/members/:memberId/:id/default',
  resolveTenantContext,
  requirePermission('members:update'),
  addressLimiter,
  blockInSupportSession('Setting default member address'),
  validate({ params: memberAddressParamDto }),
  controller.setDefaultMemberAddress,
);

export default router;

