import { Router, type Request, type Response } from 'express';

import { env } from '@/config/env';
import { asyncHandler } from '@/lib/async-handler';
import { safeEqual } from '@/lib/crypto';
import { internalLimiter } from '@/middleware/rate-limit';
import { getTenantEntitlements } from '@/modules/billing/billing.service';
import { tenantBrandingRepo } from '@/modules/tenants/tenant-branding.repository';
import * as tenantsRepo from '@/modules/tenants/tenants.repository';

const router = Router();

// Apply rate limiting and security headers to all internal endpoints
router.use(internalLimiter);
router.use((_req, res, next) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  next();
});

/**
 * Caddy / Reverse Proxy `ask` endpoint for dynamic TLS certificate issuance.
 * Returns 200 if the domain is verified, active, and plan-entitled to custom domains.
 * Returns 404 to deny TLS certificate issuance.
 */
router.get(
  '/domains/allowed',
  asyncHandler(async (req: Request, res: Response) => {
    const deny = (status: number, message: string) => {
      res.status(status).json({ error: message });
    };

    // 1. IP Allow-list validation if configured
    if (env.INTERNAL_ALLOWED_IPS) {
      const allowed = env.INTERNAL_ALLOWED_IPS.split(',').map((ip) => ip.trim());
      const clientIp = (req.ip || req.socket.remoteAddress || '').replace(/^.*:/, '');
      if (allowed.length > 0 && !allowed.includes(clientIp)) {
        deny(403, 'Forbidden IP address');
        return;
      }
    }

    // 2. Constant-time secret comparison resistant to timing attacks
    const secret = req?.headers?.['x-internal-secret'] as string | undefined;
    if (!safeEqual(secret, env.INTERNAL_API_SECRET)) {
      deny(401, 'Unauthorized');
      return;
    }

    const domain = (req?.query?.domain as string | undefined)?.trim?.()?.toLowerCase?.();
    if (!domain) {
      deny(400, 'domain query parameter required');
      return;
    }

    const branding = await tenantBrandingRepo.findBrandingByCustomDomain(domain);
    if (!branding || branding?.customDomainStatus !== 'VERIFIED') {
      deny(404, 'Domain not found or not verified');
      return;
    }

    const tenant = await tenantsRepo.findTenantById(branding?.tenantId);
    if (!tenant || tenant?.status !== 'ACTIVE') {
      deny(404, 'Tenant is not active');
      return;
    }

    const entitlements = await getTenantEntitlements(branding?.tenantId);
    const isSubscriptionActive = ['ACTIVE', 'TRIALING'].includes(
      entitlements?.subscriptionStatus ?? '',
    );
    const hasCustomDomainEntitlement = Boolean(entitlements?.limits?.urlAccess?.customDomain);

    if (!isSubscriptionActive || !hasCustomDomainEntitlement) {
      deny(404, 'Tenant does not have an active custom domain plan');
      return;
    }

    res.status(200).json({ status: 'ok', domain, tenantId: branding?.tenantId });
  }),
);

export default router;
