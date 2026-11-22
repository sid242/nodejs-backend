import { Router } from 'express';

import { requireAuth } from '@/middleware/auth';
import { ssoLimiter } from '@/middleware/rate-limit';
import { requirePermission } from '@/middleware/rbac';
import { requireTenant } from '@/middleware/tenant';
import { validate } from '@/middleware/validate';

import {
  createScimToken,
  getSpMetadata,
  getTenantSsoConfig,
  handleOidcCallback,
  handleSamlAcs,
  initiateSso,
  listScimTokens,
  lookupSso,
  revokeScimToken,
  rotateScimToken,
  testSsoConnection,
  updateTenantSsoConfig,
} from './sso.controller';
import {
  createScimTokenDto,
  oidcCallbackQueryDto,
  rotateScimTokenDto,
  samlAcsBodyDto,
  ssoInitiateQueryDto,
  ssoLookupDto,
  testSsoConnectionDto,
  updateTenantSsoConfigDto,
} from './sso.dto';

// Public SSO Auth Router (/api/v1/auth/sso and /sso)
export const ssoAuthRouter = Router();

// Cache-Control: no-store on all authentication and SSO paths
ssoAuthRouter.use((_req, res, next) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  next();
});

// Throttle public lookups and initiation to prevent enumeration / DoS
ssoAuthRouter.post('/lookup', ssoLimiter, validate({ body: ssoLookupDto }), lookupSso);
ssoAuthRouter.get('/initiate', ssoLimiter, validate({ query: ssoInitiateQueryDto }), initiateSso);

// SAML ACS endpoints (both path-based tenantId and universal)
ssoAuthRouter.post('/acs/:tenantId', ssoLimiter, validate({ body: samlAcsBodyDto }), handleSamlAcs);
ssoAuthRouter.post('/acs', ssoLimiter, validate({ body: samlAcsBodyDto }), handleSamlAcs);

// OIDC Callback endpoints (both path-based tenantId and universal)
ssoAuthRouter.get(
  '/callback/oidc/:tenantId',
  ssoLimiter,
  validate({ query: oidcCallbackQueryDto }),
  handleOidcCallback,
);
ssoAuthRouter.get(
  '/callback/oidc',
  ssoLimiter,
  validate({ query: oidcCallbackQueryDto }),
  handleOidcCallback,
);

// Public SAML SP Metadata endpoint
ssoAuthRouter.get('/metadata/:tenantId', getSpMetadata);

// Tenant Workspace SSO Management Router (/api/v1/tenants/:tenantId/sso)
export const tenantSsoRouter = Router({ mergeParams: true });

tenantSsoRouter.use(requireAuth, requireTenant, requirePermission('tenants:update'));

tenantSsoRouter.get('/', getTenantSsoConfig);
tenantSsoRouter.put('/', validate({ body: updateTenantSsoConfigDto }), updateTenantSsoConfig);
tenantSsoRouter.post(
  '/test',
  ssoLimiter,
  validate({ body: testSsoConnectionDto }),
  testSsoConnection,
);
tenantSsoRouter.get('/metadata', getSpMetadata);

// Tenant SCIM Management Router (/api/v1/tenants/:tenantId/scim)
export const tenantScimManagementRouter = Router({ mergeParams: true });

tenantScimManagementRouter.use(requireAuth, requireTenant, requirePermission('tenants:update'));

tenantScimManagementRouter.get('/tokens', listScimTokens);
tenantScimManagementRouter.post('/tokens', validate({ body: createScimTokenDto }), createScimToken);
tenantScimManagementRouter.post(
  '/tokens/:tokenId/rotate',
  validate({ body: rotateScimTokenDto }),
  rotateScimToken,
);
tenantScimManagementRouter.delete('/tokens/:tokenId', revokeScimToken);
