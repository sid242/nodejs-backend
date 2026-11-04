import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  closeTenantDto,
  listPlatformTenantsQueryDto,
  provisionTenantDto,
  retryProvisioningDto,
  updatePlatformTenantDto,
} from '@/modules/platform/platform.dto';
import { publicTenant } from '@/db/schema/tenancy/tenants';

describe('Phase 03: Tenant Management & Provisioning Unit Tests', () => {
  describe('1. listPlatformTenantsQueryDto validation', () => {
    it('applies standard pagination and sort defaults', () => {
      const parsed = listPlatformTenantsQueryDto.parse({});
      assert.equal(parsed.page, 1);
      assert.equal(parsed.limit, 20);
      assert.equal(parsed.sortBy, 'createdAt');
      assert.equal(parsed.sortOrder, 'desc');
    });

    it('accepts multi-field filtering parameters', () => {
      const parsed = listPlatformTenantsQueryDto.parse({
        page: 2,
        limit: 50,
        search: 'Acme Corp',
        country: 'US',
        region: 'California',
        status: 'ACTIVE',
        provisioningStatus: 'PROVISIONING',
        plan: 'ENTERPRISE',
        databaseMode: 'dedicated',
        sortBy: 'legalName',
        sortOrder: 'asc',
      });

      assert.equal(parsed.page, 2);
      assert.equal(parsed.limit, 50);
      assert.equal(parsed.search, 'Acme Corp');
      assert.equal(parsed.country, 'US');
      assert.equal(parsed.region, 'California');
      assert.equal(parsed.status, 'ACTIVE');
      assert.equal(parsed.provisioningStatus, 'PROVISIONING');
      assert.equal(parsed.plan, 'ENTERPRISE');
      assert.equal(parsed.databaseMode, 'dedicated');
      assert.equal(parsed.sortBy, 'legalName');
      assert.equal(parsed.sortOrder, 'asc');
    });

    it('rejects invalid provisioning status or sortBy values', () => {
      assert.throws(() => {
        listPlatformTenantsQueryDto.parse({ provisioningStatus: 'INVALID_STATUS' });
      });

      assert.throws(() => {
        listPlatformTenantsQueryDto.parse({ sortBy: 'unknownColumn' });
      });
    });
  });

  describe('2. provisionTenantDto validation', () => {
    it('successfully parses full multi-step wizard input', () => {
      const input = {
        name: 'Globex Corporation',
        slug: 'globex-corp',
        legalName: 'Globex Corporation International Inc.',
        tenantCode: 'GLBX_01',
        country: 'US',
        region: 'North America',
        timezone: 'America/New_York',
        locale: 'en-US',
        currency: 'USD',
        supportEmail: 'support@globex.com',
        supportPhone: '+1-555-0199',
        billingEmail: 'billing@globex.com',
        internalNote: 'High growth enterprise account',
        ownerEmail: 'hank.scorpio@globex.com',
        ownerFirstName: 'Hank',
        ownerLastName: 'Scorpio',
        plan: 'ENTERPRISE',
        trialDays: 30,
        branding: {
          displayName: 'Globex Enterprise',
          logoUrl: 'https://cdn.globex.com/logo.png',
          faviconUrl: 'https://cdn.globex.com/favicon.ico',
          primaryColor: '#0055ff',
          secondaryColor: '#ffaa00',
        },
        databaseMode: 'dedicated',
        databaseConfig: {
          databaseName: 'globex_dedicated',
          poolLimit: 10,
        },
      };

      const parsed = provisionTenantDto.parse(input);
      assert.equal(parsed.name, 'Globex Corporation');
      assert.equal(parsed.slug, 'globex-corp');
      assert.equal(parsed.legalName, 'Globex Corporation International Inc.');
      assert.equal(parsed.tenantCode, 'GLBX_01');
      assert.equal(parsed.trialDays, 30);
      assert.equal(parsed.branding?.primaryColor, '#0055ff');
      assert.equal(parsed.databaseMode, 'dedicated');
      assert.equal(parsed.databaseConfig?.databaseName, 'globex_dedicated');
    });

    it('applies default locale, currency, timezone and plan for minimal input', () => {
      const parsed = provisionTenantDto.parse({
        name: 'Initech',
        slug: 'initech',
        ownerEmail: 'peter.gibbons@initech.com',
      });

      assert.equal(parsed.name, 'Initech');
      assert.equal(parsed.slug, 'initech');
      assert.equal(parsed.timezone, 'UTC');
      assert.equal(parsed.locale, 'en-US');
      assert.equal(parsed.currency, 'USD');
      assert.equal(parsed.plan, 'FREE');
      assert.equal(parsed.databaseMode, 'shared');
    });

    it('rejects invalid tenantCode with lowercase or illegal characters', () => {
      assert.throws(() => {
        provisionTenantDto.parse({
          name: 'Acme',
          slug: 'acme',
          ownerEmail: 'owner@acme.com',
          tenantCode: 'acme code with spaces',
        });
      });
    });

    it('rejects invalid branding hex colors', () => {
      assert.throws(() => {
        provisionTenantDto.parse({
          name: 'Acme',
          slug: 'acme',
          ownerEmail: 'owner@acme.com',
          branding: {
            primaryColor: 'red', // Not a hex color
          },
        });
      });
    });

    it('rejects reserved slug keywords', () => {
      assert.throws(() => {
        provisionTenantDto.parse({
          name: 'Admin Workspace',
          slug: 'api', // reserved slug
          ownerEmail: 'admin@example.com',
        });
      });
    });
  });

  describe('3. updatePlatformTenantDto validation', () => {
    it('accepts partial organization profile and lifecycle updates', () => {
      const parsed = updatePlatformTenantDto.parse({
        legalName: 'Updated Legal Entity LLC',
        tenantCode: 'ULE_2026',
        supportEmail: 'helpdesk@updated.com',
        trialEndsAt: '2026-12-31T23:59:59.000Z',
        internalNote: 'Extended pilot period granted',
      });

      assert.equal(parsed.legalName, 'Updated Legal Entity LLC');
      assert.equal(parsed.tenantCode, 'ULE_2026');
      assert.equal(parsed.supportEmail, 'helpdesk@updated.com');
      assert.equal(parsed.trialEndsAt, '2026-12-31T23:59:59.000Z');
      assert.equal(parsed.internalNote, 'Extended pilot period granted');
    });
  });

  describe('4. retryProvisioningDto and closeTenantDto validation', () => {
    it('validates retry provisioning optional reason', () => {
      const empty = retryProvisioningDto.parse({});
      assert.equal(empty.reason, undefined);

      const withReason = retryProvisioningDto.parse({ reason: 'Database cluster timed out' });
      assert.equal(withReason.reason, 'Database cluster timed out');
    });

    it('requires a mandatory reason of at least 3 characters when closing a tenant', () => {
      const valid = closeTenantDto.parse({ reason: 'Customer requested account closure' });
      assert.equal(valid.reason, 'Customer requested account closure');

      assert.throws(() => {
        closeTenantDto.parse({});
      });

      assert.throws(() => {
        closeTenantDto.parse({ reason: 'no' });
      });
    });
  });

  describe('5. publicTenant projection security', () => {
    it('ensures sensitive infrastructure and secret fields are omitted from public projections', () => {
      const publicFields = Object.keys(publicTenant);
      assert.ok(!publicFields.includes('databaseSecretRef'), 'databaseSecretRef must not be exposed');
      assert.ok(!publicFields.includes('internalNote'), 'internalNote must not be exposed in publicTenant');
      assert.ok(publicFields.includes('legalName'));
      assert.ok(publicFields.includes('tenantCode'));
      assert.ok(publicFields.includes('provisioningStatus'));
      assert.ok(publicFields.includes('trialEndsAt'));
      assert.ok(publicFields.includes('databaseMode'));
    });
  });
});

