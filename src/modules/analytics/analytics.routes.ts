import { Router } from 'express';

import { requireAuth } from '@/middleware/auth';
import { requirePlatformAuth, requirePlatformPermission } from '@/middleware/platform';
import { requirePermission } from '@/middleware/rbac';
import { requireTenant } from '@/middleware/tenant';
import { validate } from '@/middleware/validate';
import { PLATFORM_PERMISSIONS } from '@/modules/platform/platform.permissions';

import * as controller from './analytics.controller';
import * as dto from './analytics.dto';

// Router mounted at /api/v1/tenants/:tenantId
export const tenantAnalyticsRouter = Router({ mergeParams: true });

tenantAnalyticsRouter.use(requireAuth, requireTenant);

// 1. Dashboard Overview
tenantAnalyticsRouter.get(
  '/analytics/overview',
  requirePermission('analytics:read'),
  validate({ query: dto.analyticsOverviewQueryDto }),
  controller.getAnalyticsOverview,
);

// 2. Usage Metering
tenantAnalyticsRouter.post(
  '/usage',
  requirePermission('usage:read'),
  validate({ body: dto.recordUsageEventDto }),
  controller.recordUsageEvent,
);

tenantAnalyticsRouter.get(
  '/usage',
  requirePermission('usage:read'),
  validate({ query: dto.listUsageQueryDto }),
  controller.getUsageRollup,
);

// 3. Activity Feed
tenantAnalyticsRouter.get(
  '/activity',
  requirePermission('activity:read'),
  validate({ query: dto.listActivityQueryDto }),
  controller.getActivityFeed,
);

// 4. Reports & Exports
tenantAnalyticsRouter.post(
  '/reports/definitions',
  requirePermission('reports:create'),
  validate({ body: dto.createReportDefinitionDto }),
  controller.createReportDefinition,
);

tenantAnalyticsRouter.get(
  '/reports/definitions',
  requirePermission('reports:read'),
  controller.listReportDefinitions,
);

tenantAnalyticsRouter.post(
  '/reports/definitions/:id/run',
  requirePermission('reports:run'),
  controller.triggerReportRun,
);

tenantAnalyticsRouter.get(
  '/reports/runs',
  requirePermission('reports:read'),
  controller.listReportRuns,
);

// Platform Metrics Router mounted at /api/v1/platform/metrics
export const platformMetricsRouter = Router();

platformMetricsRouter.use(requirePlatformAuth);

platformMetricsRouter.get(
  '/overview',
  requirePlatformPermission(PLATFORM_PERMISSIONS.METRICS_READ),
  controller.getPlatformMetricsOverview,
);
