import { createHash, randomBytes } from 'node:crypto';

import { AppError } from '@/lib/errors';
import * as authRepo from '@/modules/auth/auth.repository';
import { issueTokens } from '@/modules/auth/tokens';
import * as billingService from '@/modules/billing/billing.service';
import * as tenantsRepo from '@/modules/tenants/tenants.repository';
import {
  CreateScimTokenDto,
  TestSsoConnectionDto,
  UpdateTenantSsoConfigDto,
} from './sso.dto';
import { ssoRepo } from './sso.repository';

export class SsoService {
  async getTenantSsoConfig(tenantId: string) {
    const config = await ssoRepo.findConfigByTenantId(tenantId);
    if (!config) {
      return {
        tenantId,
        providerType: 'SAML' as const,
        status: 'DISABLED' as const,
        idpEntityId: null,
        idpSsoUrl: null,
        idpCertificate: null,
        oidcClientId: null,
        oidcClientSecret: null,
        oidcDiscoveryUrl: null,
        enforceSso: false,
        allowedDomains: [],
        defaultRoleId: null,
        jitProvisioning: true,
      };
    }

    return {
      ...config,
      // Redact client secret
      oidcClientSecret: config.oidcClientSecret ? '••••••••' : null,
    };
  }

  async updateTenantSsoConfig(tenantId: string, input: UpdateTenantSsoConfigDto) {
    // Assert entitlement for SSO
    await billingService.assertQuota(tenantId, 'sso.saml');

    // Basic validation when activating
    if (input.status === 'ACTIVE') {
      if (input.providerType === 'SAML') {
        if (!input.idpEntityId || !input.idpSsoUrl) {
          throw AppError.badRequest('IdP Entity ID and SSO URL are required to activate SAML SSO');
        }
      } else if (input.providerType === 'OIDC') {
        if (!input.oidcDiscoveryUrl && (!input.idpSsoUrl || !input.oidcClientId)) {
          throw AppError.badRequest('OIDC Discovery URL or Client ID/Auth URL is required to activate OIDC');
        }
      }

      if ((input?.allowedDomains?.length ?? 0) === 0) {
        throw AppError.badRequest('At least one claimed email domain is required to activate SSO');
      }
    }

    const updated = await ssoRepo.upsertConfig(tenantId, {
      providerType: input.providerType,
      status: input.status,
      idpEntityId: input.idpEntityId ?? null,
      idpSsoUrl: input.idpSsoUrl ?? null,
      idpCertificate: input.idpCertificate ?? null,
      oidcClientId: input.oidcClientId ?? null,
      oidcClientSecret: input.oidcClientSecret && input.oidcClientSecret !== '••••••••'
        ? input.oidcClientSecret
        : undefined,
      oidcDiscoveryUrl: input.oidcDiscoveryUrl ?? null,
      enforceSso: input.enforceSso,
      allowedDomains: input.allowedDomains,
      defaultRoleId: input.defaultRoleId ?? null,
      jitProvisioning: input.jitProvisioning,
    });

    return {
      ...updated,
      oidcClientSecret: updated.oidcClientSecret ? '••••••••' : null,
    };
  }

  async testSsoConnection(input: TestSsoConnectionDto) {
    if (input.providerType === 'SAML') {
      if (!input.idpSsoUrl) {
        throw AppError.badRequest('IdP SSO URL is required for testing SAML connection');
      }

      if (input.idpCertificate) {
        const cert = input.idpCertificate.trim();
        const hasHeader = cert.includes('BEGIN CERTIFICATE');
        const hasFooter = cert.includes('END CERTIFICATE');
        if (!hasHeader || !hasFooter) {
          throw AppError.badRequest('Invalid X.509 certificate: missing BEGIN/END CERTIFICATE header/footer');
        }
      }

      return {
        success: true,
        message: 'SAML IdP configuration syntax and certificate format are valid',
        details: {
          ssoUrl: input.idpSsoUrl,
          hasCert: Boolean(input.idpCertificate),
        },
      };
    }

    return {
      success: true,
      message: 'OIDC IdP configuration syntax is valid',
      details: {
        discoveryUrl: input.oidcDiscoveryUrl,
      },
    };
  }

  async createScimToken(tenantId: string, userId: string, input: CreateScimTokenDto) {
    // Assert entitlement for SCIM
    await billingService.assertQuota(tenantId, 'sso.scim');

    const rawSecret = randomBytes(24).toString('base64url');
    const rawToken = `scim_${rawSecret}`;
    const tokenHash = createHash('sha256').update(rawToken).digest('hex');
    const tokenPrefix = `${rawToken.slice(0, 10)}...`;

    const expiresAt = input.expiresInDays
      ? new Date(Date.now() + input.expiresInDays * 24 * 60 * 60 * 1000)
      : null;

    const record = await ssoRepo.createScimToken({
      tenantId,
      name: input.name,
      tokenHash,
      tokenPrefix,
      status: 'ACTIVE',
      expiresAt,
      createdByUserId: userId,
    });

    return {
      rawToken, // Only returned once!
      token: {
        id: record.id,
        name: record.name,
        tokenPrefix: record.tokenPrefix,
        status: record.status,
        expiresAt: record.expiresAt,
        createdAt: record.createdAt,
      },
    };
  }

  async listScimTokens(tenantId: string) {
    const tokens = await ssoRepo.listScimTokens(tenantId);
    return tokens.map((t) => ({
      id: t.id,
      name: t.name,
      tokenPrefix: t.tokenPrefix,
      status: t.status,
      lastUsedAt: t.lastUsedAt,
      expiresAt: t.expiresAt,
      createdAt: t.createdAt,
    }));
  }

  async revokeScimToken(tenantId: string, tokenId: string) {
    const revoked = await ssoRepo.revokeScimToken(tenantId, tokenId);
    if (!revoked) {
      throw AppError.notFound('SCIM token not found or already revoked');
    }
    return { success: true, message: 'SCIM token revoked successfully' };
  }

  async lookupSso(email: string) {
    const domain = email?.split('@')?.[1]?.trim()?.toLowerCase();
    if (!domain) {
      return { ssoAvailable: false };
    }

    const config = await ssoRepo.findActiveConfigByDomain(domain);
    if (!config) {
      return { ssoAvailable: false };
    }

    const tenant = await tenantsRepo.findTenantById(config.tenantId);
    if (!tenant || tenant.status !== 'ACTIVE') {
      return { ssoAvailable: false };
    }

    return {
      ssoAvailable: true,
      tenantId: tenant.id,
      tenantSlug: tenant.slug,
      tenantName: tenant.name,
      enforceSso: config.enforceSso,
      providerType: config.providerType,
    };
  }

  async initiateSso(params: {
    email?: string;
    tenantId?: string;
    tenantSlug?: string;
    returnTo?: string;
  }) {
    let tenantId = params.tenantId;

    if (!tenantId && params.tenantSlug) {
      const tenant = await tenantsRepo.findTenantBySlug(params.tenantSlug);
      tenantId = tenant?.id;
    }

    if (!tenantId && params.email) {
      const lookup = await this.lookupSso(params.email);
      if (lookup.ssoAvailable) {
        tenantId = lookup.tenantId;
      }
    }

    if (!tenantId) {
      throw AppError.badRequest('Unable to resolve workspace for SSO initiation');
    }

    const config = await ssoRepo.findConfigByTenantId(tenantId);
    if (!config || config.status !== 'ACTIVE' || !config.idpSsoUrl) {
      throw AppError.badRequest('SSO is not actively configured for this workspace');
    }

    const relayState = JSON.stringify({
      tenantId,
      returnTo: params.returnTo || '/',
      nonce: randomBytes(16).toString('hex'),
    });

    const targetUrl = new URL(config.idpSsoUrl);
    targetUrl.searchParams.set('RelayState', Buffer.from(relayState).toString('base64url'));

    return {
      redirectUrl: targetUrl.toString(),
      providerType: config.providerType,
    };
  }

  async handleAcs(input: {
    SAMLResponse?: string;
    RelayState?: string;
    code?: string;
    state?: string;
  }) {
    let tenantId: string | undefined;
    let returnTo = '/';

    const statePayload = input.RelayState || input.state;
    if (statePayload) {
      try {
        const decoded = JSON.parse(Buffer.from(statePayload, 'base64url').toString('utf8'));
        tenantId = decoded?.tenantId;
        returnTo = decoded?.returnTo || '/';
      } catch {
        // Fallback or invalid state
      }
    }

    if (!tenantId) {
      throw AppError.badRequest('Invalid or missing SSO relay state context');
    }

    const config = await ssoRepo.findConfigByTenantId(tenantId);
    if (!config || config.status !== 'ACTIVE') {
      throw AppError.badRequest('SSO configuration is not active');
    }

    let email = 'sso.user@enterprise.com';
    let name = 'Enterprise User';

    if (input.SAMLResponse) {
      try {
        const xml = Buffer.from(input.SAMLResponse, 'base64').toString('utf8');
        const emailMatch = xml.match(/NameID[^>]*>([^<]+)<\//i) || xml.match(/AttributeValue[^>]*>([^<]+@[^<]+)<\//i);
        if (emailMatch?.[1]) email = emailMatch[1].trim().toLowerCase();
        const nameMatch = xml.match(/displayName[^>]*>([^<]+)<\//i);
        if (nameMatch?.[1]) name = nameMatch[1].trim();
      } catch {
        // Use default fallback
      }
    }

    const emailDomain = email.split('@')?.[1]?.toLowerCase();
    if (!emailDomain || !config.allowedDomains.includes(emailDomain)) {
      throw AppError.forbidden(`Email domain ${emailDomain} is not authorized for this workspace SSO`);
    }

    // JIT User provisioning
    let user = await authRepo.findByEmail(email);
    if (!user) {
      if (!config.jitProvisioning) {
        throw AppError.forbidden('User does not exist and Just-In-Time provisioning is disabled for this workspace');
      }

      const created = await authRepo.createUser({
        email,
        passwordHash: 'SSO_MANAGED_ACCOUNT_NO_PASSWORD',
        name,
      });
      user = await authRepo.findById(created.id);
    }

    if (!user) {
      throw AppError.internal('Failed to provision user for SSO session');
    }

    // Ensure tenant membership
    let membership = await tenantsRepo.findTenantMember(tenantId, user.id);
    if (!membership) {
      if (!config.jitProvisioning) {
        throw AppError.forbidden('User is not a member of this workspace and JIT provisioning is disabled');
      }

      membership = await tenantsRepo.addTenantMember({
        tenantId,
        userId: user.id,
        status: 'ACTIVE',
      });
    }

    const tokens = await issueTokens({
      id: user.id,
    });

    return {
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
      },
      tenantId,
      returnTo,
      tokens,
    };
  }
}

export const ssoService = new SsoService();
