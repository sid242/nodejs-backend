import test from 'node:test';
import assert from 'node:assert/strict';
import {
  upsertTenantEmailConfigDto,
  testTenantEmailConfigDto,
} from '@/modules/tenants/tenants.dto.js';
import { verifySmtpConnection } from '@/lib/mailer.js';

test('upsertTenantEmailConfigDto validates valid SMTP payload', () => {
  const valid = {
    host: 'smtp.mailgun.org',
    port: 587,
    secure: false,
    user: 'postmaster@tenant.example.com',
    password: 'securePassword123',
    fromEmail: 'notifications@tenant.example.com',
    fromName: 'Acme Corp Notifications',
    replyTo: 'support@tenant.example.com',
    isEnabled: true,
  };

  const parsed = upsertTenantEmailConfigDto.safeParse(valid);
  assert.equal(parsed.success, true);
  if (parsed.success) {
    assert.equal(parsed.data.host, 'smtp.mailgun.org');
    assert.equal(parsed.data.port, 587);
    assert.equal(parsed.data.secure, false);
    assert.equal(parsed.data.fromEmail, 'notifications@tenant.example.com');
  }
});

test('upsertTenantEmailConfigDto rejects invalid emails and missing required fields', () => {
  const invalid = {
    host: '',
    port: 999999, // out of range
    user: '',
    fromEmail: 'not-an-email',
  };

  const parsed = upsertTenantEmailConfigDto.safeParse(invalid);
  assert.equal(parsed.success, false);
});

test('testTenantEmailConfigDto allows partial testing payload with target email', () => {
  const testPayload = {
    host: 'smtp.sendgrid.net',
    port: 465,
    secure: true,
    user: 'apikey',
    password: 'SG.123456789',
    fromEmail: 'alerts@company.org',
    targetEmail: 'admin@company.org',
  };

  const parsed = testTenantEmailConfigDto.safeParse(testPayload);
  assert.equal(parsed.success, true);
  if (parsed.success) {
    assert.equal(parsed.data.targetEmail, 'admin@company.org');
  }
});

test('verifySmtpConnection fails gracefully on unreachable host without crashing', async () => {
  const result = await verifySmtpConnection({
    host: '127.0.0.1',
    port: 54321, // non-existent SMTP port
    secure: false,
    user: 'testuser',
    pass: 'testpass',
  });

  assert.equal(result?.success, false);
  assert.equal(typeof result?.message, 'string');
});
