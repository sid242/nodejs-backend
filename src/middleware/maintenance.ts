import type { NextFunction, Request, Response } from 'express';

import {
  getGlobalMaintenance,
  getTenantMaintenance,
} from '@/modules/maintenance/maintenance.service';

const EXEMPT_PATHS = [
  '/health',
  '/metrics',
  '/docs',
  '/admin/queues',
  '/api/v1/platform',
  '/api/v1/auth',
  '/api/v1/webhooks',
];

export async function maintenanceMiddleware(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const path = req.path;

  // 1. Bypass exempt system & platform control plane paths
  if (EXEMPT_PATHS.some((exempt) => path.startsWith(exempt))) {
    return next();
  }

  // 2. Resolve maintenance state (Global, then Tenant)
  let activeState = await getGlobalMaintenance();

  const tenantId =
    req.tenant?.id ??
    (Array.isArray(req.params?.tenantId) ? req.params.tenantId[0] : req.params?.tenantId) ??
    (Array.isArray(req.params?.id) ? req.params.id[0] : req.params?.id);

  if (!activeState.enabled && tenantId) {
    const tenantState = await getTenantMaintenance(String(tenantId));
    if (tenantState?.enabled) {
      activeState = tenantState;
    }
  }

  // If maintenance is not active, proceed normally
  if (!activeState.enabled) {
    return next();
  }

  // 3. Bypass if platform staff access is allowed and caller is authenticated staff
  const isStaff = Boolean(req.staff?.id || req.headers['x-platform-token']);
  if (activeState.allowStaff && isStaff) {
    return next();
  }

  // 4. Handle Read-Only Maintenance Mode (Permit safe read methods)
  const isSafeMethod = ['GET', 'HEAD', 'OPTIONS'].includes(req.method.toUpperCase());
  if (activeState.readOnly && isSafeMethod) {
    res.setHeader('X-System-Mode', 'READ_ONLY');
    return next();
  }

  const requestId = (req as any).id || (req.headers['x-request-id'] as string) || '';

  if (activeState.readOnly) {
    res.setHeader('Retry-After', '60');
    res.status(503).json({
      error: {
        code: 'READ_ONLY_MODE',
        message:
          activeState.message || 'System is currently operating in read-only maintenance mode.',
      },
      requestId,
    });
    return;
  }

  // 5. Handle Full Maintenance Mode
  res.setHeader('Retry-After', '300');
  res.status(503).json({
    error: {
      code: 'MAINTENANCE',
      message:
        activeState.message ||
        'System is currently undergoing scheduled maintenance. Please try again shortly.',
    },
    requestId,
  });
}
