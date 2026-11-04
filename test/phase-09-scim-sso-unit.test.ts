import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';

import { closeDb } from '@/config/db';
import { closeRedisClients } from '@/config/redis';
import * as authRepo from '@/modules/auth/auth.repository';
import * as billingRepo from '@/modules/billing/billing.repository';
import { scimService } from '@/modules/scim/scim.service';
import { ssoService } from '@/modules/sso/sso.service';
import * as tenantsRepo from '@/modules/tenants/tenants.repository';

after(async () => {
  await Promise.allSettled([closeRedisClients(), closeDb()]);
  setTimeout(() => process.exit(0), 200).unref();
});

describe('SCIM 2.0 Directory Sync & Enterprise SSO Unit Tests', () => {
  let freeTenant: any;
  let enterpriseTenant: any;
  let staffUser: any;
  let enterprisePlan: any;
  let freePlan: any;
  let testDomain: string;

  before(async () => {
    // Seed test user
    const stamp = Date.now();
    testDomain = `acme-${stamp}.corp`;
    staffUser = await authRepo.createUser({
      email: `scim-admin-${stamp}@example.com`,
      passwordHash: 'dummy_hash',
      name: 'Admin User',
    });

    // Seed Free and Enterprise plans
    freePlan = await billingRepo.findPlanByKey('FREE');
    if (!freePlan) {
      freePlan = await billingRepo.createPlan({
        name: 'Free Plan',
        key: 'FREE',
        limits: { maxMembers: 5, maxStorageBytes: 1024 * 1024 * 1024, maxCustomRoles: 0 },
        currency: 'USD',
        priceMonthlyMinor: 0,
        priceYearlyMinor: 0,
        isActive: true,
      });
    }

    enterprisePlan = await billingRepo.findPlanByKey('ENTERPRISE');
    if (!enterprisePlan) {
      enterprisePlan = await billingRepo.createPlan({
        name: 'Enterprise Plan',
        key: 'ENTERPRISE',
        limits: { maxMembers: 500, maxStorageBytes: 500 * 1024 * 1024 * 1024, maxCustomRoles: 50 },
        currency: 'USD',
        priceMonthlyMinor: 99900,
        priceYearlyMinor: 999000,
        isActive: true,
      });
    }

    // Create Free workspace
    freeTenant = await tenantsRepo.createTenant({
      name: 'Free Workspace',
      slug: `free-scim-${stamp}`,
      status: 'ACTIVE',
      plan: 'FREE',
      currency: 'USD',
      createdAt: new Date(),
    });
    await billingRepo.createSubscription({
      tenantId: freeTenant.id,
      planId: freePlan.id,
      status: 'ACTIVE',
      billingInterval: 'MONTHLY',
      currentPeriodStart: new Date(),
      currentPeriodEnd: new Date(Date.now() + 30 * 86400000),
    });

    // Create Enterprise workspace
    enterpriseTenant = await tenantsRepo.createTenant({
      name: 'Acme Enterprise',
      slug: `acme-scim-${stamp}`,
      status: 'ACTIVE',
      plan: 'ENTERPRISE',
      currency: 'USD',
      createdAt: new Date(),
    });
    await billingRepo.createSubscription({
      tenantId: enterpriseTenant.id,
      planId: enterprisePlan.id,
      status: 'ACTIVE',
      billingInterval: 'MONTHLY',
      currentPeriodStart: new Date(),
      currentPeriodEnd: new Date(Date.now() + 30 * 86400000),
    });
  });

  describe('1. SSO Configuration & Entitlement Gating', () => {
    it('throws 403 when FREE workspace attempts to configure SSO', async () => {
      await assert.rejects(
        async () => {
          await ssoService.updateTenantSsoConfig(freeTenant.id, {
            providerType: 'SAML',
            status: 'ACTIVE',
            idpEntityId: 'https://idp.okta.com/exk123',
            idpSsoUrl: 'https://idp.okta.com/app/sso',
            allowedDomains: ['freeworkspace.com'],
            enforceSso: false,
            jitProvisioning: true,
          });
        },
        (err: any) => {
          assert.strictEqual(err.status, 403);
          return true;
        },
      );
    });

    it('rejects activating SAML when missing allowed domains or IdP URLs', async () => {
      await assert.rejects(
        async () => {
          await ssoService.updateTenantSsoConfig(enterpriseTenant.id, {
            providerType: 'SAML',
            status: 'ACTIVE',
            idpEntityId: '',
            idpSsoUrl: '',
            allowedDomains: [],
            enforceSso: false,
            jitProvisioning: true,
          });
        },
        (err: any) => {
          assert.strictEqual(err.status, 400);
          return true;
        },
      );
    });

    it('allows ENTERPRISE workspace to configure and activate SAML SSO', async () => {
      const config = await ssoService.updateTenantSsoConfig(enterpriseTenant.id, {
        providerType: 'SAML',
        status: 'ACTIVE',
        idpEntityId: 'https://okta.acme.corp/exk123',
        idpSsoUrl: 'https://okta.acme.corp/app/sso',
        idpCertificate: '-----BEGIN CERTIFICATE-----\nMIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8A\n-----END CERTIFICATE-----',
        allowedDomains: [testDomain, 'subsidiary.acme.com'],
        enforceSso: true,
        jitProvisioning: true,
      });

      assert.strictEqual(config.status, 'ACTIVE');
      assert.strictEqual(config.providerType, 'SAML');
      assert.deepStrictEqual(config.allowedDomains, [testDomain, 'subsidiary.acme.com']);
      assert.strictEqual(config.enforceSso, true);
    });

    it('validates SAML certificate syntax during connection test', async () => {
      const valid = await ssoService.testSsoConnection({
        providerType: 'SAML',
        idpSsoUrl: 'https://okta.acme.corp/app/sso',
        idpCertificate: '-----BEGIN CERTIFICATE-----\nABCDEF123456\n-----END CERTIFICATE-----',
      });
      assert.strictEqual(valid.success, true);

      await assert.rejects(
        async () => {
          await ssoService.testSsoConnection({
            providerType: 'SAML',
            idpSsoUrl: 'https://okta.acme.corp/app/sso',
            idpCertificate: 'corrupted-certificate-content',
          });
        },
        (err: any) => {
          assert.strictEqual(err.status, 400);
          return true;
        },
      );
    });
  });

  describe('2. SSO Domain Discovery & Initiation', () => {
    it('discovers workspace SSO for claimed email domain', async () => {
      const lookup = await ssoService.lookupSso(`alice@${testDomain}`);
      assert.strictEqual(lookup.ssoAvailable, true);
      assert.strictEqual(lookup.tenantId, enterpriseTenant.id);
      assert.strictEqual(lookup.tenantSlug, enterpriseTenant.slug);
      assert.strictEqual(lookup.enforceSso, true);
      assert.strictEqual(lookup.providerType, 'SAML');
    });

    it('returns ssoAvailable=false for unclaimed email domain', async () => {
      const lookup = await ssoService.lookupSso('stranger@randomcorp.org');
      assert.strictEqual(lookup.ssoAvailable, false);
    });

    it('initiates SSO and generates signed RelayState redirect URL', async () => {
      const init = await ssoService.initiateSso({
        email: `alice@${testDomain}`,
        returnTo: '/dashboard/settings',
      });

      assert.strictEqual(init.providerType, 'SAML');
      assert.ok(init.redirectUrl.startsWith('https://okta.acme.corp/app/sso?RelayState='));
    });
  });

  describe('3. SCIM Token Management & Entitlement Gating', () => {
    it('throws 403 when FREE workspace attempts to create a SCIM token', async () => {
      await assert.rejects(
        async () => {
          await ssoService.createScimToken(freeTenant.id, staffUser.id, {
            name: 'Okta SCIM Sync',
          });
        },
        (err: any) => {
          assert.strictEqual(err.status, 403);
          return true;
        },
      );
    });

    it('generates SCIM token on ENTERPRISE workspace, returning plaintext once', async () => {
      const result = await ssoService.createScimToken(enterpriseTenant.id, staffUser.id, {
        name: 'Okta SCIM Sync',
        expiresInDays: 90,
      });

      assert.ok(result.rawToken.startsWith('scim_'));
      assert.strictEqual(result.token.name, 'Okta SCIM Sync');
      assert.strictEqual(result.token.status, 'ACTIVE');
      assert.ok(result.token.tokenPrefix.startsWith('scim_'));

      // List tokens
      const tokens = await ssoService.listScimTokens(enterpriseTenant.id);
      assert.ok(tokens.length >= 1);
      assert.strictEqual(tokens[0]!.name, 'Okta SCIM Sync');

      // Revoke token
      const revoke = await ssoService.revokeScimToken(enterpriseTenant.id, result.token.id);
      assert.strictEqual(revoke.success, true);
    });
  });

  describe('4. SCIM 2.0 Protocol Conformance & Discovery', () => {
    it('returns compliant ServiceProviderConfig with patch and bearer token support', () => {
      const config = scimService.getServiceProviderConfig();
      assert.deepStrictEqual(config.schemas, ['urn:ietf:params:scim:schemas:core:2.0:ServiceProviderConfig']);
      assert.strictEqual(config.patch.supported, true);
      assert.strictEqual(config.bulk.supported, false);
      assert.strictEqual(config.filter.supported, true);
      assert.strictEqual(config.authenticationSchemes[0]!.type, 'oauthbearertoken');
    });

    it('returns compliant Schemas list and individual schemas', () => {
      const schemas = scimService.getSchemas();
      assert.strictEqual(schemas.totalResults, 2);
      assert.ok(schemas.Resources.length === 2);

      const userSchema = scimService.getSchemaById('urn:ietf:params:scim:schemas:core:2.0:User');
      assert.strictEqual(userSchema.name, 'User');
    });
  });

  describe('5. SCIM 2.0 User Provisioning & Lifecycle', () => {
    let createdUserId: string;
    const testEmail = `scim.dev.${Date.now()}@acme.corp`;

    it('provisions new user into workspace via POST /Users', async () => {
      const scimUser = await scimService.createUser(enterpriseTenant.id, {
        userName: testEmail,
        displayName: 'Dev Engineer',
        name: {
          givenName: 'Dev',
          familyName: 'Engineer',
        },
        emails: [{ value: testEmail, primary: true }],
        active: true,
      });

      assert.strictEqual(scimUser.userName, testEmail);
      assert.strictEqual(scimUser.active, true);
      assert.strictEqual(scimUser.displayName, 'Dev Engineer');
      assert.ok(scimUser.id);
      createdUserId = scimUser.id;
    });

    it('retrieves provisioned user via GET /Users/:id', async () => {
      const user = await scimService.getUser(enterpriseTenant.id, createdUserId);
      assert.strictEqual(user.id, createdUserId);
      assert.strictEqual(user.userName, testEmail);
      assert.strictEqual(user.active, true);
    });

    it('filters users by userName eq "..."', async () => {
      const list = await scimService.listUsers(enterpriseTenant.id, {
        filter: `userName eq "${testEmail}"`,
        startIndex: 1,
        count: 10,
      });

      assert.strictEqual(list.totalResults, 1);
      assert.strictEqual(list.Resources[0]!.userName, testEmail);
    });

    it('patches user active=false via PATCH /Users/:id (deactivation)', async () => {
      const patched = await scimService.patchUser(enterpriseTenant.id, createdUserId, {
        Operations: [
          {
            op: 'replace',
            path: 'active',
            value: false,
          },
        ],
      });

      assert.strictEqual(patched.active, false);

      // Verify membership is now suspended
      const member = await tenantsRepo.findTenantMember(enterpriseTenant.id, createdUserId);
      assert.strictEqual(member?.status, 'SUSPENDED');
    });

    it('removes member from workspace via DELETE /Users/:id', async () => {
      await scimService.deleteUser(enterpriseTenant.id, createdUserId);
      const member = await tenantsRepo.findTenantMember(enterpriseTenant.id, createdUserId);
      assert.strictEqual(member, null);
    });
  });
});
