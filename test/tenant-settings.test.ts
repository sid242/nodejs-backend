import assert from 'node:assert/strict';
import { after, test } from 'node:test';

import { closeDb } from '../src/config/db';
import { closeRedisClients } from '../src/config/redis';
import {
  updateTenantSecurityPolicyDto,
  updateTenantSettingsDto,
} from '../src/modules/tenants/tenants.dto';

after(async () => {
  await Promise.allSettled([closeRedisClients(), closeDb()]);
});

test('Tenant Settings: updateTenantSettingsDto validates currency codes, time formats, and domains', () => {
  const valid = updateTenantSettingsDto.safeParse({
    timezone: 'America/New_York',
    locale: 'en-US',
    currency: 'USD',
    dateFormat: 'YYYY-MM-DD',
    timeFormat: '12h',
    weekStartsOn: 'sunday',
    fiscalYearStartMonth: 4,
    country: 'US',
    legalName: 'Acme International LLC',
    allowedEmailDomains: ['acme.com', 'acme.org'],
    autoJoinDomains: true,
  });
  assert.equal(valid.success, true);

  // Invalid 4-letter currency
  const invalidCurrency = updateTenantSettingsDto.safeParse({
    currency: 'USDT',
  });
  assert.equal(invalidCurrency.success, false);

  // Invalid timeFormat
  const invalidTimeFormat = updateTenantSettingsDto.safeParse({
    timeFormat: '36h',
  });
  assert.equal(invalidTimeFormat.success, false);

  // Invalid fiscal year month (13)
  const invalidFiscalMonth = updateTenantSettingsDto.safeParse({
    fiscalYearStartMonth: 13,
  });
  assert.equal(invalidFiscalMonth.success, false);
});

test('Tenant Settings: updateTenantSecurityPolicyDto validates MFA options, minimum password lengths, and auth methods', () => {
  const valid = updateTenantSecurityPolicyDto.safeParse({
    requireMfa: 'ADMINS',
    passwordMinLength: 12,
    passwordMaxAgeDays: 90,
    sessionIdleMinutes: 30,
    sessionMaxHours: 12,
    ipAllowlist: ['192.168.1.0/24', '10.0.0.1'],
    allowedAuthMethods: ['PASSWORD', 'SSO'],
    enforceSso: false,
    allowSupportAccess: true,
    inviteExpiryDays: 3,
    allowPersonalEmails: false,
  });
  assert.equal(valid.success, true);

  // Password min length too small (< 8)
  const weakPassword = updateTenantSecurityPolicyDto.safeParse({
    passwordMinLength: 4,
  });
  assert.equal(weakPassword.success, false);

  // Invalid requireMfa value
  const invalidMfa = updateTenantSecurityPolicyDto.safeParse({
    requireMfa: 'OPTIONAL',
  });
  assert.equal(invalidMfa.success, false);

  // Invalid auth method
  const invalidAuthMethod = updateTenantSecurityPolicyDto.safeParse({
    allowedAuthMethods: ['PASSWORD', 'FACEBOOK'],
  });
  assert.equal(invalidAuthMethod.success, false);
});
