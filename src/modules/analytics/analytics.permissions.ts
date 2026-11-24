import type { DomainModuleDefinition } from '@/modules/rbac/modules.types';

export const analyticsModuleDefinition: DomainModuleDefinition = {
  key: 'analytics',
  name: 'Analytics, Usage & Reports',
  description:
    'Inspect workspace telemetry, metered entitlement consumption, and scheduled data reports',
  icon: 'bar-chart-2',
  sortOrder: 45,
  permissions: [
    {
      key: 'analytics:read',
      name: 'View Analytics Overview',
      action: 'read',
      description: 'Access aggregated workspace KPIs, activity charts, and user adoption stats',
    },
    {
      key: 'usage:read',
      name: 'View Metered Usage',
      action: 'read',
      description: 'Inspect metered entitlement usage events, daily rollups, and limit thresholds',
    },
    {
      key: 'activity:read',
      name: 'View Activity Feed',
      action: 'read',
      description: 'Access the workspace human-readable event and action timeline',
    },
    {
      key: 'reports:read',
      name: 'View Reports & Runs',
      action: 'read',
      description: 'Inspect report definitions and download generated report run files',
    },
    {
      key: 'reports:create',
      name: 'Create Report Definition',
      action: 'create',
      description: 'Configure new automated or on-demand report definitions and schedules',
    },
    {
      key: 'reports:run',
      name: 'Generate Reports',
      action: 'run',
      description: 'Trigger asynchronous report exports across workspace domains',
    },
  ],
};
