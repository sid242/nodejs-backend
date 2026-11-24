import { Router } from 'express';

import { requireAuth } from '@/middleware/auth';
import { requirePermission } from '@/middleware/rbac';
import { requireTenant } from '@/middleware/tenant';
import { validate } from '@/middleware/validate';

import * as controller from './policies.controller';
import * as dto from './policies.dto';

const router: Router = Router();

// All policy routes require user authentication and tenant resolution
router.use(requireAuth, requireTenant);

// Policy CRUD
router.get(
  '/',
  requirePermission('roles:read'),
  validate({ query: dto.listPoliciesQueryDto }),
  controller.listPolicies,
);

router.post(
  '/',
  requirePermission('roles:update'),
  validate({ body: dto.createPolicyDto }),
  controller.createPolicy,
);

// PBAC Registry (for dynamic UI builder)
router.get('/registry', requirePermission('roles:read'), controller.getPolicyRegistry);

// PBAC Dry-Run Evaluation (for UI test panel)
router.post(
  '/evaluate',
  requirePermission('roles:read'),
  validate({ body: dto.evaluatePolicyDto }),
  controller.evaluateDryRun,
);

router.get(
  '/:policyId',
  requirePermission('roles:read'),
  validate({ params: dto.policyIdParamDto }),
  controller.getPolicy,
);

router.patch(
  '/:policyId',
  requirePermission('roles:update'),
  validate({ params: dto.policyIdParamDto, body: dto.updatePolicyDto }),
  controller.updatePolicy,
);

router.delete(
  '/:policyId',
  requirePermission('roles:delete'),
  validate({ params: dto.policyIdParamDto }),
  controller.deletePolicy,
);

// Role-Policy Associations
router.post(
  '/:policyId/roles/:roleId',
  requirePermission('roles:update'),
  validate({ params: dto.policyRoleParamDto }),
  controller.attachPolicyToRole,
);

router.delete(
  '/:policyId/roles/:roleId',
  requirePermission('roles:update'),
  validate({ params: dto.policyRoleParamDto }),
  controller.detachPolicyFromRole,
);

router.get(
  '/roles/:roleId',
  requirePermission('roles:read'),
  validate({ params: dto.roleIdParamDto }),
  controller.getPoliciesForRole,
);

export default router;
