/**
 * PBAC Attribute & Resource Registry
 * Defines all available resources, actions, and attributes with their types.
 * Used for DTO validation, compiler verification, and the policy builder UI.
 */

export type AttributeDataType = 'string' | 'number' | 'boolean' | 'date' | 'array';

export interface AttributeDefinition {
  name: string;
  path: string;
  type: AttributeDataType;
  description: string;
}

export interface ResourceDefinition {
  resource: string;
  displayName: string;
  description: string;
  actions: string[];
  attributes: AttributeDefinition[];
}

export const COMMON_ACTOR_ATTRIBUTES: AttributeDefinition[] = [
  {
    name: 'User ID',
    path: 'actor.userId',
    type: 'string',
    description: 'ID of the authenticated user performing the action',
  },
  {
    name: 'Member ID',
    path: 'actor.memberId',
    type: 'string',
    description: 'Tenant membership ID of the authenticated user',
  },
  {
    name: 'Department ID',
    path: 'actor.departmentId',
    type: 'string',
    description: 'Department to which the member belongs',
  },
  {
    name: 'Region ID',
    path: 'actor.regionId',
    type: 'string',
    description: 'Geographic or sales region assigned to the member',
  },
  {
    name: 'Role Keys',
    path: 'actor.roleKeys',
    type: 'array',
    description: 'List of role keys assigned to the member',
  },
];

export const COMMON_ENV_ATTRIBUTES: AttributeDefinition[] = [
  {
    name: 'Current Time',
    path: 'env.currentTime',
    type: 'date',
    description: 'Evaluation timestamp',
  },
  {
    name: 'IP Address',
    path: 'env.ip',
    type: 'string',
    description: 'Client IP address of the incoming request',
  },
];

export const PBAC_REGISTRY: {
  resources: ResourceDefinition[];
  commonActorAttributes: AttributeDefinition[];
  commonEnvAttributes: AttributeDefinition[];
  operators: {
    operator: string;
    description: string;
    supportedTypes: AttributeDataType[];
  }[];
} = {
  resources: [
    {
      resource: 'leads',
      displayName: 'CRM Leads',
      description: 'Customer leads and sales prospect records',
      actions: ['read', 'create', 'update', 'delete', 'reassign', 'set_confidential', '*'],
      attributes: [
        {
          name: 'Lead ID',
          path: 'resource.id',
          type: 'string',
          description: 'Unique identifier of the lead',
        },
        {
          name: 'Name',
          path: 'resource.name',
          type: 'string',
          description: 'Lead or organization name',
        },
        {
          name: 'Assigned Member ID',
          path: 'resource.assignedMemberId',
          type: 'string',
          description: 'Member assigned to handle the lead',
        },
        {
          name: 'Department ID',
          path: 'resource.departmentId',
          type: 'string',
          description: 'Department owning the lead record',
        },
        {
          name: 'Region ID',
          path: 'resource.regionId',
          type: 'string',
          description: 'Geographic region of the lead',
        },
        {
          name: 'Is Confidential',
          path: 'resource.isConfidential',
          type: 'boolean',
          description: 'Whether the lead contains sensitive or confidential data',
        },
        {
          name: 'Status',
          path: 'resource.status',
          type: 'string',
          description: 'Current lifecycle status of the lead',
        },
        {
          name: 'Created At',
          path: 'resource.createdAt',
          type: 'date',
          description: 'Creation timestamp',
        },
      ],
    },
    {
      resource: 'tenants',
      displayName: 'Tenants & Workspaces',
      description: 'Workspace accounts and settings',
      actions: ['read', 'update', 'delete', '*'],
      attributes: [
        {
          name: 'Tenant ID',
          path: 'resource.id',
          type: 'string',
          description: 'Workspace ID',
        },
        {
          name: 'Workspace Name',
          path: 'resource.name',
          type: 'string',
          description: 'Display name of the workspace',
        },
        {
          name: 'Plan',
          path: 'resource.plan',
          type: 'string',
          description: 'Subscription plan key',
        },
      ],
    },
    {
      resource: 'billing',
      displayName: 'Billing & Subscriptions',
      description: 'Payment orders, invoices, and subscriptions',
      actions: ['read', 'manage', 'checkout', 'refund', '*'],
      attributes: [
        {
          name: 'Tenant ID',
          path: 'resource.tenantId',
          type: 'string',
          description: 'Workspace owning the billing record',
        },
        {
          name: 'Amount (Minor)',
          path: 'resource.amountMinor',
          type: 'number',
          description: 'Payment amount in smallest currency unit',
        },
        {
          name: 'Currency',
          path: 'resource.currency',
          type: 'string',
          description: 'Three-letter ISO currency code',
        },
        {
          name: 'Status',
          path: 'resource.status',
          type: 'string',
          description: 'Payment or subscription status',
        },
      ],
    },
    {
      resource: 'roles',
      displayName: 'Roles & Permissions',
      description: 'Workspace role assignments and security policies',
      actions: ['read', 'create', 'update', 'delete', 'assign', '*'],
      attributes: [
        {
          name: 'Role ID',
          path: 'resource.id',
          type: 'string',
          description: 'Unique role identifier',
        },
        {
          name: 'Role Name',
          path: 'resource.name',
          type: 'string',
          description: 'Role name',
        },
      ],
    },
  ],
  commonActorAttributes: COMMON_ACTOR_ATTRIBUTES,
  commonEnvAttributes: COMMON_ENV_ATTRIBUTES,
  operators: [
    {
      operator: '$eq',
      description: 'Equal to',
      supportedTypes: ['string', 'number', 'boolean', 'date'],
    },
    {
      operator: '$ne',
      description: 'Not equal to',
      supportedTypes: ['string', 'number', 'boolean', 'date'],
    },
    {
      operator: '$in',
      description: 'In array',
      supportedTypes: ['string', 'number'],
    },
    {
      operator: '$nin',
      description: 'Not in array',
      supportedTypes: ['string', 'number'],
    },
    {
      operator: '$gt',
      description: 'Greater than',
      supportedTypes: ['number', 'date', 'string'],
    },
    {
      operator: '$gte',
      description: 'Greater than or equal to',
      supportedTypes: ['number', 'date', 'string'],
    },
    {
      operator: '$lt',
      description: 'Less than',
      supportedTypes: ['number', 'date', 'string'],
    },
    {
      operator: '$lte',
      description: 'Less than or equal to',
      supportedTypes: ['number', 'date', 'string'],
    },
    {
      operator: '$contains',
      description: 'Contains substring or array element',
      supportedTypes: ['string', 'array'],
    },
    {
      operator: '$startsWith',
      description: 'Starts with prefix',
      supportedTypes: ['string'],
    },
  ],
};

/**
 * Validates whether a resource string is known in the registry or wildcard.
 */
export function isValidResource(resource: string): boolean {
  if (resource === '*') return true;
  return PBAC_REGISTRY.resources.some((r) => r.resource === resource);
}

/**
 * Validates whether an action string is valid for a given resource.
 */
export function isValidAction(resource: string, action: string): boolean {
  if (action === '*') return true;
  if (resource === '*') return true;
  const def = PBAC_REGISTRY.resources.find((r) => r.resource === resource);
  if (!def) return false;
  return def.actions.includes(action);
}

/**
 * Validates whether an attribute path is valid for the given resource context.
 */
export function isValidAttributePath(resource: string, path: string): boolean {
  if (!path || typeof path !== 'string') return false;

  // Actor and env attributes are always valid across all resources
  if (COMMON_ACTOR_ATTRIBUTES.some((a) => a.path === path)) return true;
  if (COMMON_ENV_ATTRIBUTES.some((a) => a.path === path)) return true;
  if (path.startsWith('actor.attributes.')) return true;

  if (resource === '*') {
    // If wildcard resource, any attribute in any known resource is valid
    return PBAC_REGISTRY.resources.some((res) => res.attributes.some((attr) => attr.path === path));
  }

  const def = PBAC_REGISTRY.resources.find((r) => r.resource === resource);
  if (!def) return false;
  return def.attributes.some((attr) => attr.path === path);
}
