import { Router } from 'express';

import { requirePermission } from '@/middleware/rbac';
import { validate } from '@/middleware/validate';

import * as controller from './audit.controller';
import * as dto from './audit.dto';

export const tenantAuditRouter: Router = Router({ mergeParams: true });

// Audit Logs & Search
tenantAuditRouter.get(
  '/',
  requirePermission('audit:read'),
  validate({ query: dto.searchAuditLogsQueryDto }),
  controller.getTenantAuditLogs,
);

// Compliance Export (Streamed CSV / JSON)
tenantAuditRouter.get(
  '/export',
  requirePermission('audit:export'),
  validate({ query: dto.exportAuditLogsQueryDto }),
  controller.exportTenantAuditLogs,
);

// Retention Policies
tenantAuditRouter.get(
  '/policy',
  requirePermission('audit:read'),
  controller.getTenantAuditPolicy,
);

tenantAuditRouter.put(
  '/policy',
  requirePermission('audit:retention:manage'),
  validate({ body: dto.updateTenantAuditPolicyDto }),
  controller.updateTenantAuditPolicy,
);

export const tenantAccessRouter: Router = Router({ mergeParams: true });

// Effective Access Introspection
tenantAccessRouter.get(
  '/effective/:userId',
  requirePermission('access:read'),
  controller.getEffectiveAccess,
);

// Zero-Mutation Access Simulator
tenantAccessRouter.post(
  '/simulate',
  requirePermission('access:simulate'),
  validate({ body: dto.simulateAccessDto }),
  controller.simulateAccess,
);

