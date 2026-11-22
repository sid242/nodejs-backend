import { createHash, randomBytes } from 'node:crypto';
import { SAML } from '@node-saml/node-saml';
import * as jose from 'jose';

import { db } from '@/config/db';
import { env } from '@/config/env';
import { logger } from '@/config/logger';
import { tenantMemberRoles } from '@/db/schema/access/rbac';
import { decrypt, encrypt } from '@/lib/crypto';
import { AppError } from '@/lib/errors';
import { logSecurityEvent } from '@/modules/audit/audit.service';
import * as authRepo from '@/modules/auth/auth.repository';
import * as authService from '@/modules/auth/auth.service';
import * as billingService from '@/modules/billing/billing.service';
import { rbacRepo } from '@/modules/rbac/rbac.repository';
import * as tenantsRepo from '@/modules/tenants/tenants.repository';

import {
  CreateScimTokenDto,
  RotateScimTokenDto,
  TestSsoConnectionDto,
  UpdateTenantSsoConfigDto,
} from './sso.dto';
import { ssoRepo } from './sso.repository';
import { assertSafeUrl, safeFetch, validateReturnTo } from './sso.security';
import { consumeSsoState, createSsoState, recordSamlAssertion } from './sso.state';

export function getSpEntityId(tenantId: string): string {
  const base = env.SSO_SP_ENTITY_ID_BASE || `${env.APP_PROTOCOL}://${env.PLATFORM_HOST}`;
  return `${base.replace(/\/$/, '')}/sso/sp/${tenantId}`;
}

export function getAcsUrl(tenantId: string, host?: string): string {
  const protocol = host?.includes('localhost') ? 'http' : env.APP_PROTOCOL;
  const targetHost = host || env.PLATFORM_HOST;
  return `${protocol}://${targetHost}/api/v1/auth/sso/acs/${tenantId}`;
}

export function getOidcCallbackUrl(tenantId: string, host?: string): string {
  const protocol = host?.includes('localhost') ? 'http' : env.APP_PROTOCOL;
  const targetHost = host || env.PLATFORM_HOST;
  return `${protocol}://${targetHost}/api/v1/auth/sso/callback/oidc/${tenantId}`;
}

export class SsoService {
  async getTenantSsoConfig(tenantId: string) {
    const config = await ssoRepo.findConfigByTenantId(tenantId);
    const spEntityId = getSpEntityId(tenantId);
    const acsUrl = getAcsUrl(tenantId);
    const oidcCallbackUrl = getOidcCallbackUrl(tenantId);
    const metadataUrl = `${env.APP_PROTOCOL}://${env.PLATFORM_HOST}/api/v1/auth/sso/metadata/${tenantId}`;

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
        spEntityId,
        acsUrl,
        oidcCallbackUrl,
        metadataUrl,
      };
    }

    return {
      ...config,
      oidcClientSecret: config.oidcClientSecret ? '••••••••' : null,
      spEntityId,
      acsUrl,
      oidcCallbackUrl,
      metadataUrl,
    };
  }

  async updateTenantSsoConfig(tenantId: string, input: UpdateTenantSsoConfigDto) {
    // Assert entitlement for SSO
    await billingService.assertQuota(tenantId, 'sso.saml');

    // Validation when activating
    if (input.status === 'ACTIVE') {
      if (input.providerType === 'SAML') {
        if (!input.idpEntityId || !input.idpSsoUrl) {
          throw AppError.badRequest('IdP Entity ID and SSO URL are required to activate SAML SSO');
        }
        if (!input.idpCertificate) {
          throw AppError.badRequest('IdP X.509 Certificate is required to activate SAML SSO');
        }
      } else if (input.providerType === 'OIDC') {
        if (!input.oidcDiscoveryUrl || !input.oidcClientId) {
          throw AppError.badRequest(
            'OIDC Discovery URL and Client ID are required to activate OIDC',
          );
        }
      }

      if ((input?.allowedDomains?.length ?? 0) === 0) {
        throw AppError.badRequest('At least one claimed email domain is required to activate SSO');
      }
    }

    // Validate default role assignment to prevent privilege escalation
    if (input.defaultRoleId) {
      const targetRole = await rbacRepo.findRoleById(input.defaultRoleId);
      if (!targetRole) {
        throw AppError.badRequest('Configured default role does not exist');
      }
      const roleName = targetRole.name?.toUpperCase?.() ?? '';
      const permissions = (targetRole as any).permissions ?? [];
      const hasAdminRights =
        roleName === 'OWNER' ||
        roleName === 'ADMIN' ||
        permissions.includes('*') ||
        permissions.includes('roles:manage') ||
        permissions.includes('members:manage') ||
        permissions.includes('tenants:delete');

      if (hasAdminRights) {
        throw AppError.badRequest(
          'Default SSO/SCIM role cannot be OWNER, ADMIN, or possess administrative permissions',
        );
      }
    }

    // Encrypt client secret if provided and not the masked placeholder
    let encryptedSecret: string | undefined;
    if (input.oidcClientSecret && input.oidcClientSecret !== '••••••••') {
      encryptedSecret = encrypt(input.oidcClientSecret);
    }

    const updated = await ssoRepo.upsertConfig(tenantId, {
      providerType: input.providerType,
      status: input.status,
      idpEntityId: input.idpEntityId ?? null,
      idpSsoUrl: input.idpSsoUrl ?? null,
      idpCertificate: input.idpCertificate ?? null,
      oidcClientId: input.oidcClientId ?? null,
      oidcClientSecret: encryptedSecret,
      oidcDiscoveryUrl: input.oidcDiscoveryUrl ?? null,
      enforceSso: input.enforceSso,
      allowedDomains: input.allowedDomains,
      defaultRoleId: input.defaultRoleId ?? null,
      jitProvisioning: input.jitProvisioning,
      lastConnectionTestAt: null,
      lastConnectionTestSucceeded: null,
    });

    return {
      ...updated,
      oidcClientSecret: updated.oidcClientSecret ? '••••••••' : null,
      spEntityId: getSpEntityId(tenantId),
      acsUrl: getAcsUrl(tenantId),
      oidcCallbackUrl: getOidcCallbackUrl(tenantId),
    };
  }

  async testSsoConnection(input: TestSsoConnectionDto, tenantId?: string) {
    const saved = tenantId ? await ssoRepo.findConfigByTenantId(tenantId) : null;
    const matchesSaved =
      saved?.providerType === input.providerType &&
      (input.providerType === 'SAML'
        ? saved.idpSsoUrl === (input.idpSsoUrl ?? null) &&
          saved.idpEntityId === (input.idpEntityId ?? null) &&
          (saved.idpCertificate ?? '').trim() === (input.idpCertificate ?? '').trim()
        : saved.oidcDiscoveryUrl === (input.oidcDiscoveryUrl ?? null));
    let passed = false;
    try {
      const result = await this.validateSsoConnection(input);
      passed = result.success;
      return result;
    } finally {
      if (tenantId && saved && matchesSaved) {
        await ssoRepo.recordConnectionTest(tenantId, saved.updatedAt, passed);
      }
    }
  }

  private async validateSsoConnection(input: TestSsoConnectionDto) {
    if (input.providerType === 'SAML') {
      if (!input.idpSsoUrl) {
        throw AppError.badRequest('IdP SSO URL is required for testing SAML connection');
      }

      // SSRF check on SSO URL
      await assertSafeUrl(input.idpSsoUrl, { allowHttpInDev: true });

      if (input.idpCertificate) {
        const cert = input.idpCertificate.trim();
        const hasHeader = cert.includes('BEGIN CERTIFICATE');
        const hasFooter = cert.includes('END CERTIFICATE');
        if (!hasHeader || !hasFooter) {
          throw AppError.badRequest(
            'Invalid X.509 certificate: missing BEGIN/END CERTIFICATE header/footer',
          );
        }
      }

      return {
        success: true,
        message:
          'SAML URL and certificate format checks passed. Verify sign-in with your identity provider before enforcement.',
        details: {
          ssoUrl: input.idpSsoUrl,
          hasCert: Boolean(input.idpCertificate),
        },
      };
    }

    // OIDC Test
    if (!input.oidcDiscoveryUrl) {
      throw AppError.badRequest('OIDC Discovery URL is required for testing OIDC connection');
    }

    // Fetch and validate openid-configuration with SSRF protection
    const wellKnownUrl = `${input.oidcDiscoveryUrl.replace(/\/$/, '')}/.well-known/openid-configuration`;
    try {
      const res = await safeFetch(
        wellKnownUrl,
        { headers: { Accept: 'application/json' } },
        { allowHttpInDev: true },
      );
      if (!res.ok) {
        throw AppError.badRequest(`OIDC discovery endpoint returned HTTP ${res.status}`);
      }
      const data = (await res.json()) as any;
      if (!data.authorization_endpoint || !data.token_endpoint || !data.jwks_uri) {
        throw AppError.badRequest('OIDC discovery response is missing required OAuth endpoints');
      }

      return {
        success: true,
        message: 'OIDC Discovery document successfully resolved and validated',
        details: {
          issuer: data.issuer,
          authorizationEndpoint: data.authorization_endpoint,
          tokenEndpoint: data.token_endpoint,
          jwksUri: data.jwks_uri,
        },
      };
    } catch (err: any) {
      if (err instanceof AppError) throw err;
      throw AppError.badRequest(
        `Failed to reach OIDC discovery endpoint: ${err?.message ?? 'Network error'}`,
      );
    }
  }

  async getSpMetadata(tenantId: string, host?: string): Promise<string> {
    const spEntityId = getSpEntityId(tenantId);
    const acsUrl = getAcsUrl(tenantId, host);

    const saml = new SAML({
      callbackUrl: acsUrl,
      issuer: spEntityId,
      entryPoint: 'https://placeholder.invalid',
      idpCert: 'dummy',
    });

    return saml.generateServiceProviderMetadata(null, null);
  }

  async createScimToken(tenantId: string, userId: string, input: CreateScimTokenDto) {
    await billingService.assertQuota(tenantId, 'sso.scim');

    const rawSecret = randomBytes(24).toString('base64url');
    const rawToken = `scim_${rawSecret}`;
    const tokenHash = createHash('sha256').update(rawToken).digest('hex');
    const tokenPrefix = `${rawToken.slice(0, 10)}...`;

    const days = input.expiresInDays ?? 365;
    const expiresAt = new Date(Date.now() + days * 24 * 60 * 60 * 1000);

    const record = await ssoRepo.createScimToken({
      tenantId,
      name: input.name,
      tokenHash,
      tokenPrefix,
      allowedIps: input.allowedIps ?? [],
      status: 'ACTIVE',
      expiresAt,
      createdByUserId: userId,
    });

    return {
      rawToken,
      token: {
        id: record.id,
        name: record.name,
        tokenPrefix: record.tokenPrefix,
        allowedIps: (record as any).allowedIps,
        status: record.status,
        expiresAt: record.expiresAt,
        lastUsedAt: record.lastUsedAt,
        lastUsedIp: (record as any).lastUsedIp,
        createdAt: record.createdAt,
      },
    };
  }

  async listScimTokens(tenantId: string) {
    const tokens = await ssoRepo.listScimTokens(tenantId);
    return tokens.map((t: any) => ({
      id: t.id,
      name: t.name,
      tokenPrefix: t.tokenPrefix,
      allowedIps: t.allowedIps,
      status: t.status,
      lastUsedAt: t.lastUsedAt,
      lastUsedIp: t.lastUsedIp,
      expiresAt: t.expiresAt,
      createdAt: t.createdAt,
    }));
  }

  async rotateScimToken(tenantId: string, tokenId: string, input: RotateScimTokenDto) {
    await billingService.assertQuota(tenantId, 'sso.scim');

    const existing = await ssoRepo.findScimTokenById(tenantId, tokenId);
    if (!existing) {
      throw AppError.notFound('SCIM token not found');
    }

    const rawSecret = randomBytes(24).toString('base64url');
    const rawToken = `scim_${rawSecret}`;
    const tokenHash = createHash('sha256').update(rawToken).digest('hex');
    const tokenPrefix = `${rawToken.slice(0, 10)}...`;

    const days = input.expiresInDays ?? 365;
    const expiresAt = new Date(Date.now() + days * 24 * 60 * 60 * 1000);

    const rotated = await ssoRepo.rotateScimToken(
      tenantId,
      tokenId,
      tokenHash,
      tokenPrefix,
      expiresAt,
    );

    if (!rotated) {
      throw AppError.notFound('Failed to rotate SCIM token');
    }

    return {
      rawToken,
      token: {
        id: rotated.id,
        name: rotated.name,
        tokenPrefix: rotated.tokenPrefix,
        allowedIps: (rotated as any).allowedIps,
        status: rotated.status,
        expiresAt: rotated.expiresAt,
        lastUsedAt: rotated.lastUsedAt,
        lastUsedIp: (rotated as any).lastUsedIp,
        updatedAt: rotated.updatedAt,
      },
    };
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

    // Never leak tenant IDs or workspace details in public unauthenticated lookup
    return {
      ssoAvailable: true,
      redirectUrl: `/api/v1/auth/sso/initiate?email=${encodeURIComponent(email)}`,
    };
  }

  async initiateSso(
    params: {
      email?: string;
      tenantId?: string;
      tenantSlug?: string;
      returnTo?: string;
    },
    reqHost?: string,
  ) {
    let tenantId = params.tenantId;

    if (!tenantId && params.tenantSlug) {
      const tenant = await tenantsRepo.findTenantBySlug(params.tenantSlug);
      tenantId = tenant?.id;
    }

    if (!tenantId && params.email) {
      const domain = params.email.split('@')[1]?.trim()?.toLowerCase();
      if (domain) {
        const activeCfg = await ssoRepo.findActiveConfigByDomain(domain);
        if (activeCfg?.tenantId) {
          tenantId = activeCfg.tenantId;
        }
      }
    }

    if (!tenantId) {
      throw AppError.badRequest('Unable to resolve workspace for SSO initiation');
    }

    const config = await ssoRepo.findConfigByTenantId(tenantId);
    if (!config || config.status !== 'ACTIVE') {
      throw AppError.badRequest('SSO is not actively configured for this workspace');
    }

    const host = reqHost || env.PLATFORM_HOST;
    const validatedReturnTo = validateReturnTo(params.returnTo);
    const nonce = randomBytes(16).toString('hex');

    if (config.providerType === 'SAML') {
      if (!config.idpSsoUrl || !config.idpCertificate) {
        throw AppError.badRequest('Incomplete SAML configuration in workspace');
      }

      const spEntityId = getSpEntityId(tenantId);
      const acsUrl = getAcsUrl(tenantId, host);

      const saml = new SAML({
        callbackUrl: acsUrl,
        issuer: spEntityId,
        entryPoint: config.idpSsoUrl,
        idpCert: config.idpCertificate,
        audience: spEntityId,
        wantAssertionsSigned: true,
        acceptedClockSkewMs: 120000,
      });

      // Generate server-side state token
      const stateId = await createSsoState({
        tenantId,
        nonce,
        returnTo: validatedReturnTo,
        host,
        providerType: 'SAML',
      });

      const redirectUrl = await saml.getAuthorizeUrlAsync(stateId, {});

      return {
        redirectUrl,
        providerType: 'SAML' as const,
      };
    }

    // OIDC Flow with PKCE
    if (!config.oidcDiscoveryUrl || !config.oidcClientId) {
      throw AppError.badRequest('Incomplete OIDC configuration in workspace');
    }

    // Discover OIDC endpoints
    const wellKnownUrl = `${config.oidcDiscoveryUrl.replace(/\/$/, '')}/.well-known/openid-configuration`;
    const discoveryRes = await safeFetch(
      wellKnownUrl,
      { headers: { Accept: 'application/json' } },
      { allowHttpInDev: true },
    );
    if (!discoveryRes.ok) {
      throw AppError.internal('Failed to discover OIDC provider configuration');
    }
    const discovery = (await discoveryRes.json()) as any;

    const codeVerifier = randomBytes(32).toString('base64url');
    const codeChallenge = createHash('sha256').update(codeVerifier).digest('base64url');

    const stateId = await createSsoState({
      tenantId,
      nonce,
      codeVerifier,
      returnTo: validatedReturnTo,
      host,
      providerType: 'OIDC',
    });

    const oidcRedirectUrl = new URL(discovery.authorization_endpoint);
    oidcRedirectUrl.searchParams.set('client_id', config.oidcClientId);
    oidcRedirectUrl.searchParams.set('redirect_uri', getOidcCallbackUrl(tenantId, host));
    oidcRedirectUrl.searchParams.set('response_type', 'code');
    oidcRedirectUrl.searchParams.set('scope', 'openid profile email');
    oidcRedirectUrl.searchParams.set('state', stateId);
    oidcRedirectUrl.searchParams.set('nonce', nonce);
    oidcRedirectUrl.searchParams.set('code_challenge', codeChallenge);
    oidcRedirectUrl.searchParams.set('code_challenge_method', 'S256');

    return {
      redirectUrl: oidcRedirectUrl.toString(),
      providerType: 'OIDC' as const,
    };
  }

  async handleSamlAcs(
    input: { SAMLResponse?: string; RelayState?: string },
    pathTenantId?: string,
  ): Promise<{ redirectUrl: string; handoffUrl: string; code: string; returnTo: string }> {
    const stateId = input.RelayState;
    if (!stateId) {
      throw AppError.unauthorized('Missing SSO RelayState');
    }

    const state = await consumeSsoState(stateId);
    if (!state || state.providerType !== 'SAML') {
      throw AppError.unauthorized('Invalid, expired, or already-used SSO state context');
    }

    const tenantId = state.tenantId;
    if (pathTenantId && pathTenantId !== tenantId) {
      throw AppError.unauthorized('SSO tenant context mismatch between URL and signed state');
    }

    const config = await ssoRepo.findConfigByTenantId(tenantId);
    if (!config || config.status !== 'ACTIVE' || !config.idpCertificate) {
      throw AppError.unauthorized('SSO configuration is inactive or missing IdP certificate');
    }

    if (!input.SAMLResponse) {
      throw AppError.unauthorized('Missing SAMLResponse in ACS payload');
    }

    const spEntityId = getSpEntityId(tenantId);
    const acsUrl = getAcsUrl(tenantId, state.host);

    const saml = new SAML({
      callbackUrl: acsUrl,
      issuer: spEntityId,
      idpCert: config.idpCertificate,
      entryPoint: config.idpSsoUrl || 'https://placeholder.invalid',
      audience: spEntityId,
      wantAssertionsSigned: true,
      acceptedClockSkewMs: 120000,
    });

    let profile: any;
    try {
      const result = await saml.validatePostResponseAsync({ SAMLResponse: input.SAMLResponse });
      profile = result.profile;
    } catch (err: any) {
      logger.warn({ err, tenantId }, 'SAML signature or assertion validation failed');
      await logSecurityEvent({
        tenantId,
        action: 'SSO_LOGIN_FAILED',
        result: 'FAILURE',
        reason: 'SAML signature or assertion invalid',
      });
      throw AppError.unauthorized('SAML assertion invalid or signature verification failed');
    }

    if (!profile) {
      throw AppError.unauthorized('No profile returned from SAML assertion');
    }

    // Assertion replay protection
    const assertionId =
      profile.getAssertion?.()?.['$']?.['ID'] ||
      profile.sessionIndex ||
      createHash('sha256').update(input.SAMLResponse).digest('hex');
    await recordSamlAssertion(assertionId);

    // InResponseTo check if requestId was tracked
    if (state.requestId && profile.inResponseTo && profile.inResponseTo !== state.requestId) {
      throw AppError.unauthorized('SAML InResponseTo does not match initial request');
    }

    // Extract email attribute from verified assertion
    const email = (
      profile.nameID ||
      profile.email ||
      profile.mail ||
      profile['urn:oid:0.9.2342.19200300.100.1.1']
    )
      ?.trim()
      ?.toLowerCase();

    if (!email || !email.includes('@')) {
      throw AppError.unauthorized('Verified SAML assertion is missing a valid email address');
    }

    const name =
      profile.displayName ||
      profile.cn ||
      profile.name ||
      `${profile.firstName ?? ''} ${profile.lastName ?? ''}`.trim() ||
      email.split('@')[0];

    return this.completeSsoLoginAndHandoff({
      tenantId,
      email,
      name,
      config,
      state,
      authMethod: 'SAML',
    });
  }

  async handleOidcCallback(
    query: { code?: string; state?: string; error?: string; error_description?: string },
    pathTenantId?: string,
  ): Promise<{ redirectUrl: string; handoffUrl: string; code: string; returnTo: string }> {
    if (query.error) {
      throw AppError.unauthorized(
        `OIDC authentication failed: ${query.error_description || query.error}`,
      );
    }

    const stateId = query.state;
    if (!stateId) {
      throw AppError.unauthorized('Missing OIDC state parameter');
    }

    const state = await consumeSsoState(stateId);
    if (!state || state.providerType !== 'OIDC') {
      throw AppError.unauthorized('Invalid, expired, or already-used OIDC state context');
    }

    const tenantId = state.tenantId;
    if (pathTenantId && pathTenantId !== tenantId) {
      throw AppError.unauthorized('SSO tenant context mismatch between URL and signed state');
    }

    const config = await ssoRepo.findConfigByTenantId(tenantId);
    if (!config || config.status !== 'ACTIVE' || !config.oidcDiscoveryUrl || !config.oidcClientId) {
      throw AppError.unauthorized('OIDC configuration is inactive or incomplete');
    }

    if (!query.code) {
      throw AppError.unauthorized('Missing authorization code in OIDC callback');
    }

    // Discover endpoints
    const wellKnownUrl = `${config.oidcDiscoveryUrl.replace(/\/$/, '')}/.well-known/openid-configuration`;
    const discoveryRes = await safeFetch(
      wellKnownUrl,
      { headers: { Accept: 'application/json' } },
      { allowHttpInDev: true },
    );
    if (!discoveryRes.ok) {
      throw AppError.internal('Failed to retrieve OIDC discovery document');
    }
    const discovery = (await discoveryRes.json()) as any;

    // Decrypt client secret if stored
    let clientSecret = config.oidcClientSecret;
    if (clientSecret) {
      try {
        clientSecret = decrypt(clientSecret);
      } catch {
        // If decryption fails, secret might have been plaintext or invalid
      }
    }

    // Exchange authorization code for tokens
    const bodyParams = new URLSearchParams({
      grant_type: 'authorization_code',
      code: query.code,
      redirect_uri: getOidcCallbackUrl(tenantId, state.host),
      client_id: config.oidcClientId,
      code_verifier: state.codeVerifier || '',
    });

    const headers: Record<string, string> = {
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
    };

    if (clientSecret) {
      headers.Authorization = `Basic ${Buffer.from(`${config.oidcClientId}:${clientSecret}`).toString('base64')}`;
    }

    const tokenRes = await safeFetch(
      discovery.token_endpoint,
      {
        method: 'POST',
        headers,
        body: bodyParams.toString(),
      },
      { allowHttpInDev: true },
    );

    if (!tokenRes.ok) {
      const errText = await tokenRes.text().catch(() => '');
      logger.warn({ status: tokenRes.status, errText, tenantId }, 'OIDC token exchange failed');
      throw AppError.unauthorized('OIDC code exchange failed');
    }

    const tokenData = (await tokenRes.json()) as any;
    if (!tokenData.id_token) {
      throw AppError.unauthorized('OIDC token endpoint did not return an ID token');
    }

    // Verify ID Token signature and claims via JWKS
    const JWKS = jose.createRemoteJWKSet(new URL(discovery.jwks_uri));
    let claims: any;
    try {
      const verified = await jose.jwtVerify(tokenData.id_token, JWKS, {
        issuer: discovery.issuer,
        audience: config.oidcClientId,
      });
      claims = verified.payload;
    } catch (err: any) {
      logger.warn({ err, tenantId }, 'OIDC ID token signature verification failed');
      await logSecurityEvent({
        tenantId,
        action: 'SSO_LOGIN_FAILED',
        result: 'FAILURE',
        reason: 'OIDC ID token verification failed',
      });
      throw AppError.unauthorized('OIDC ID token verification failed');
    }

    // Verify nonce
    if (claims.nonce !== state.nonce) {
      throw AppError.unauthorized('OIDC nonce mismatch (replay protection)');
    }

    // Verify email & email_verified
    const email = claims.email?.trim()?.toLowerCase();
    if (!email || !email.includes('@')) {
      throw AppError.unauthorized('OIDC identity is missing a valid email address');
    }

    if (claims.email_verified === false) {
      throw AppError.unauthorized('Email is not verified by OIDC provider');
    }

    const name = claims.name || claims.preferred_username || email.split('@')[0];

    return this.completeSsoLoginAndHandoff({
      tenantId,
      email,
      name,
      config,
      state,
      authMethod: 'OIDC',
    });
  }

  private async completeSsoLoginAndHandoff(params: {
    tenantId: string;
    email: string;
    name: string;
    config: any;
    state: any;
    authMethod: 'SAML' | 'OIDC';
  }): Promise<{ redirectUrl: string; handoffUrl: string; code: string; returnTo: string }> {
    const { tenantId, email, name, config, state, authMethod } = params;

    // Domain validation
    const emailDomain = email.split('@')?.[1]?.toLowerCase();
    if (!emailDomain || !config.allowedDomains.includes(emailDomain)) {
      await logSecurityEvent({
        tenantId,
        action: 'SSO_LOGIN_FAILED',
        result: 'FAILURE',
        reason: `Email domain '${emailDomain}' is not authorized`,
      });
      throw AppError.forbidden(
        `Email domain '${emailDomain}' is not authorized for this workspace SSO`,
      );
    }

    // User lookup / JIT provisioning
    let user = await authRepo.findByEmail(email);
    if (!user) {
      if (!config.jitProvisioning) {
        throw AppError.forbidden(
          'User does not exist and Just-In-Time provisioning is disabled for this workspace',
        );
      }

      const nameParts = name.trim().split(/\s+/);
      const firstName = nameParts[0] || email.split('@')[0] || 'User';
      const lastName = nameParts.slice(1).join(' ') || 'User';

      // Create new user with passwordHash = null (no password login allowed)
      const created = await authRepo.createUser({
        email,
        passwordHash: null,
        firstName,
        lastName,
      });
      user = await authRepo.findById(created.id);
    }

    if (!user || user.deletedAt) {
      throw AppError.unauthorized('User account not found or deactivated');
    }

    if (user.status === 'SUSPENDED' || user.status === 'DEACTIVATED') {
      throw AppError.forbidden(`User account is ${user.status.toLowerCase()}`);
    }

    // Tenant membership check / JIT assignment
    let membership = await tenantsRepo.findTenantMember(tenantId, user.id);
    if (!membership) {
      if (!config.jitProvisioning) {
        throw AppError.forbidden(
          'User is not a member of this workspace and JIT provisioning is disabled',
        );
      }

      membership = await tenantsRepo.addTenantMember({
        tenantId,
        userId: user.id,
        status: 'ACTIVE',
      });

      if (config.defaultRoleId && membership?.id) {
        await db
          .insert(tenantMemberRoles)
          .values({
            memberId: membership.id,
            roleId: config.defaultRoleId,
            tenantId,
          })
          .catch(() => {});
      }
    }

    if (!membership || membership.status !== 'ACTIVE') {
      throw AppError.forbidden('Workspace membership is inactive or suspended');
    }

    // Issue secure handoff session code
    const handoff = await authService.createHandoff(user.id, {
      tenantId,
      targetHost: state.host,
    });

    await logSecurityEvent({
      tenantId,
      userId: user.id,
      action: 'SSO_LOGIN_SUCCESS',
      result: 'SUCCESS',
      metadata: { authMethod, email },
    });

    const protocol = state.host?.includes('localhost') ? 'http' : 'https';
    const returnTo = validateReturnTo(state.returnTo);
    const redirectUrl = `${protocol}://${state.host}/api/auth/handoff?code=${handoff.code}&next=${encodeURIComponent(returnTo)}`;

    return {
      redirectUrl,
      handoffUrl: handoff.handoffUrl,
      code: handoff.code,
      returnTo,
    };
  }
}

export const ssoService = new SsoService();
