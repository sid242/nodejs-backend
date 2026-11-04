import { Router } from 'express';

import { requireAuth } from '@/middleware/auth';
import { requirePermission } from '@/middleware/rbac';
import { requireTenant } from '@/middleware/tenant';
import { validate } from '@/middleware/validate';
import {
  createScimToken,
  getTenantSsoConfig,
  handleAcs,
  initiateSso,
  listScimTokens,
  lookupSso,
  revokeScimToken,
  testSsoConnection,
  updateTenantSsoConfig,
} from './sso.controller';
import {
  createScimTokenDto,
  ssoAcsBodyDto,
  ssoInitiateQueryDto,
  ssoLookupDto,
  testSsoConnectionDto,
  updateTenantSsoConfigDto,
} from './sso.dto';

// Public SSO Auth Router (/api/v1/auth/sso)
export const ssoAuthRouter = Router();

ssoAuthRouter.post('/lookup', validate({ body: ssoLookupDto }), lookupSso);
ssoAuthRouter.get('/initiate', validate({ query: ssoInitiateQueryDto }), initiateSso);
ssoAuthRouter.post('/acs', validate({ body: ssoAcsBodyDto }), handleAcs);

// Tenant Workspace SSO Management Router (/api/v1/tenants/:tenantId/sso and /scim)
export const tenantSsoRouter = Router({ mergeParams: true });

tenantSsoRouter.use(requireAuth, requireTenant, requirePermission('tenants:update'));

tenantSsoRouter.get('/', getTenantSsoConfig);
tenantSsoRouter.put('/', validate({ body: updateTenantSsoConfigDto }), updateTenantSsoConfig);
tenantSsoRouter.post('/test', validate({ body: testSsoConnectionDto }), testSsoConnection);

export const tenantScimManagementRouter = Router({ mergeParams: true });

tenantScimManagementRouter.use(requireAuth, requireTenant, requirePermission('tenants:update'));

tenantScimManagementRouter.get('/tokens', listScimTokens);
tenantScimManagementRouter.post('/tokens', validate({ body: createScimTokenDto }), createScimToken);
tenantScimManagementRouter.delete('/tokens/:tokenId', revokeScimToken);

