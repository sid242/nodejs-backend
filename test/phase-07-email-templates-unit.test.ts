import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { after, before, describe, test } from 'node:test';
import { eq } from 'drizzle-orm';

import { closeDb, db } from '@/config/db';
import { env } from '@/config/env';
import { closeRedisClients } from '@/config/redis';
import {
  emailMessages,
  emailSuppressions,
  emailTemplates,
  emailTemplateVersions,
  tenants,
  users,
} from '@/db/schema/index';
import { AppError } from '@/lib/errors';
import { isPrivateOrReservedHost, sendEmail, verifySmtpConnection } from '@/lib/mailer';
import * as repo from '@/modules/email-templates/email-templates.repository';
import * as service from '@/modules/email-templates/email-templates.service';
import { closeQueues } from '@/queues/index';
import { closeSocketEmitter } from '@/sockets/emitter';

describe('Module 06 — Email Templates & Delivery Tests', () => {
  let testTenantId: string;
  let testUserId: string;

  before(async () => {
    // Setup test tenant and user in DB
    const [tenant] = await db
      .insert(tenants)
      .values({
        name: 'Email Test Workspace',
        slug: `email-test-${Date.now()}`,
      })
      .returning();
    testTenantId = tenant!.id;

    const [user] = await db
      .insert(users)
      .values({
        email: `email-tester-${Date.now()}@example.com`,
        firstName: 'Email',
        lastName: 'Tester',
      })
      .returning();
    testUserId = user!.id;
  });

  after(async () => {
    // Cleanup
    if (testTenantId) {
      await db
        .delete(emailTemplateVersions)
        .where(eq(emailTemplateVersions.tenantId, testTenantId));
      await db.delete(emailMessages).where(eq(emailMessages.tenantId, testTenantId));
      await db.delete(emailSuppressions).where(eq(emailSuppressions.tenantId, testTenantId));
      await db.delete(emailTemplates).where(eq(emailTemplates.tenantId, testTenantId));
      await db.delete(tenants).where(eq(tenants.id, testTenantId));
    }
    if (testUserId) {
      await db.delete(users).where(eq(users.id, testUserId));
    }
    await Promise.allSettled([closeQueues(), closeSocketEmitter(), closeRedisClients(), closeDb()]);
  });

  test('renderVariables escapes HTML in double braces {{var}} and preserves raw HTML in triple braces {{{var}}}', () => {
    const template = '<p>Hello {{name}}, your link is {{{buttonHtml}}}</p>';
    const rendered = service.renderVariables(template, {
      name: '<script>alert("xss")</script>',
      buttonHtml: '<a href="https://example.com">Click Here</a>',
    });

    assert.equal(
      rendered,
      '<p>Hello &lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;, your link is <a href="https://example.com">Click Here</a></p>',
    );
  });

  test('renderVariables correctly resolves nested properties and maintains unprovided variables', () => {
    const template =
      'Hi {{user.firstName}}, your organization is {{tenant.name}} (ref: {{unknownCode}})';
    const rendered = service.renderVariables(template, {
      user: { firstName: 'Alice' },
      tenant: { name: 'Acme Corp' },
    });

    assert.equal(rendered, 'Hi Alice, your organization is Acme Corp (ref: {{unknownCode}})');
  });

  test('sanitizeHtmlContent removes dangerous script tags, inline event handlers, and javascript: URLs', () => {
    const malicious = `
      <div onclick="evil()" onmouseover="alert('xss')">
        <h1>Welcome</h1>
        <script>window.location='http://attacker.com';</script>
        <a href="javascript:void(0)" src="javascript:bad()">Click</a>
      </div>
    `;

    const cleaned = service.sanitizeHtmlContent(malicious);
    assert.doesNotMatch(cleaned, /<script/i);
    assert.doesNotMatch(cleaned, /onclick/i);
    assert.doesNotMatch(cleaned, /onmouseover/i);
    assert.doesNotMatch(cleaned, /javascript:/i);
    assert.match(cleaned, /Welcome/);
    assert.match(cleaned, /href="#"/);
  });

  test('sanitizeHtmlContent rejects HTML exceeding 512 KB', () => {
    const hugeHtml = 'x'.repeat(513 * 1024);
    assert.throws(
      () => service.sanitizeHtmlContent(hugeHtml),
      (err: any) => err.status === 400 && err.message.includes('512 KB'),
    );
  });

  test('isPrivateOrReservedHost blocks SSRF to private and loopback networks', () => {
    assert.equal(isPrivateOrReservedHost('localhost'), true);
    assert.equal(isPrivateOrReservedHost('sub.localhost'), true);
    assert.equal(isPrivateOrReservedHost('127.0.0.1'), true);
    assert.equal(isPrivateOrReservedHost('127.0.0.5'), true);
    assert.equal(isPrivateOrReservedHost('10.0.1.5'), true);
    assert.equal(isPrivateOrReservedHost('172.16.0.1'), true);
    assert.equal(isPrivateOrReservedHost('172.31.255.255'), true);
    assert.equal(isPrivateOrReservedHost('192.168.1.1'), true);
    assert.equal(isPrivateOrReservedHost('169.254.169.254'), true);
    assert.equal(isPrivateOrReservedHost('0.0.0.0'), true);
    assert.equal(isPrivateOrReservedHost('::1'), true);
    assert.equal(isPrivateOrReservedHost('internal.cluster.local'), true);

    // Public valid hosts
    assert.equal(isPrivateOrReservedHost('smtp.sendgrid.net'), false);
    assert.equal(isPrivateOrReservedHost('smtp.mailgun.org'), false);
    assert.equal(isPrivateOrReservedHost('email-smtp.us-east-1.amazonaws.com'), false);
  });

  test('verifySmtpConnection rejects private host without initiating network socket', async () => {
    const res = await verifySmtpConnection({
      host: '169.254.169.254',
      port: 25,
      secure: false,
      user: 'test',
      pass: 'test',
    });
    assert.equal(res.success, false);
    assert.match(res.message, /private/i);
  });

  test('System template enforcement rejects verify-email override missing required {{link}}', async () => {
    await assert.rejects(
      async () => {
        await service.createTemplate(testTenantId, testUserId, {
          name: 'Custom Verification',
          slug: 'verify-email',
          subject: 'Verify your email',
          htmlContent: '<p>Click here to verify, but without the required link token</p>',
          isSystemOverride: true,
        });
      },
      (err: any) => err.status === 400 && err.message.includes('required variable'),
    );
  });

  test('Template creation, version snapshotting, and rollback flow', async () => {
    // 1. Create template
    const template = await service.createTemplate(testTenantId, testUserId, {
      name: 'Onboarding Welcome',
      subject: 'Welcome to our platform {{name}}',
      htmlContent: '<p>Welcome {{name}}! Version 1</p>',
      category: 'CUSTOM',
      status: 'PUBLISHED',
    });
    assert.equal(template.currentVersion, 1);
    assert.equal(template.subject, 'Welcome to our platform {{name}}');

    // 2. Update template -> creates version snapshot
    const updated = await service.updateTemplate(template.id, testTenantId, testUserId, {
      subject: 'Welcome aboard {{name}} (Updated)',
      htmlContent: '<p>Welcome {{name}}! Version 2</p>',
    });
    assert.equal(updated.currentVersion, 2);
    assert.equal(updated.subject, 'Welcome aboard {{name}} (Updated)');

    // 3. Inspect version history
    const versions = await service.listTemplateVersions(template.id, testTenantId);
    assert.equal(versions.length, 1);
    assert.equal(versions[0]?.version, 1);
    assert.equal(versions[0]?.subject, 'Welcome to our platform {{name}}');

    // 4. Rollback to version 1
    const rolledBack = await service.rollbackVersion(template.id, 1, testTenantId, testUserId);
    assert.equal(rolledBack.currentVersion, 3);
    assert.equal(rolledBack.subject, 'Welcome to our platform {{name}}');
    assert.equal(rolledBack.htmlContent, '<p>Welcome {{name}}! Version 1</p>');
  });

  test('Email suppressions skip delivery and log delivery error', async () => {
    const suppressedEmail = `bounced-${Date.now()}@example.com`;

    // 1. Add suppression
    await service.createSuppression(testTenantId, {
      email: suppressedEmail,
      reason: 'BOUNCE',
      details: '550 User unknown',
    });

    // 2. Verify suppression check
    const isSuppressed = await repo.isEmailSuppressed(testTenantId, suppressedEmail);
    assert.equal(isSuppressed, true);

    // 3. Attempt sendEmail -> should skip and return skippedSuppressed: true
    const result = await sendEmail({
      to: suppressedEmail,
      subject: 'Should not send',
      html: '<p>Hello</p>',
      tenantId: testTenantId,
    });
    assert.equal(result.success, false);
    assert.equal(result.skippedSuppressed, true);

    // 4. Check delivery log in email_messages
    const logs = await service.listDeliveryLogs(testTenantId, { to: suppressedEmail });
    assert.equal(logs.messages.length >= 1, true);
    assert.equal(logs.messages[0]?.status, 'FAILED');
    assert.match(logs.messages[0]?.lastError ?? '', /suppressed/i);
  });

  test('handleBounceWebhook rejects unauthenticated or wrongly signed webhook requests', async () => {
    const bounceEmail = `unauth-bounce-${Date.now()}@example.com`;
    const payload = {
      email: bounceEmail,
      reason: 'BOUNCE',
    };

    // 1. Unsigned / unauthenticated -> returns 401 Unauthorized
    await assert.rejects(
      async () => service.handleBounceWebhook(payload),
      (err: any) => err instanceof AppError && err.status === 401,
    );

    // 2. Wrong secret -> returns 403 Forbidden
    await assert.rejects(
      async () => service.handleBounceWebhook(payload, { 'x-webhook-secret': 'wrong-secret' }),
      (err: any) => err instanceof AppError && err.status === 403,
    );

    // 3. Unknown SNS message type -> returns 400 Bad Request
    await assert.rejects(
      async () =>
        service.handleBounceWebhook(
          { Type: 'UnknownMessageType', Message: '{}' },
          { 'x-webhook-secret': env.EMAIL_BOUNCE_WEBHOOK_SECRET },
        ),
      (err: any) => err instanceof AppError && err.status === 400,
    );

    // Verify no suppression was created
    const suppression = await repo.findSuppression(testTenantId, bounceEmail);
    assert.equal(suppression, undefined);
  });

  test('handleBounceWebhook resolves tenant ONLY from stored emailMessages, never trusting body tenantId', async () => {
    const bounceEmail = `webhook-bounce-${Date.now()}@example.com`;
    const spoofedTenantId = crypto.randomUUID();

    // 1. Insert genuine emailMessage belonging to testTenantId
    await db.insert(emailMessages).values({
      id: crypto.randomUUID(),
      tenantId: testTenantId,
      to: bounceEmail,
      subject: 'Test message for bounce resolution',
      status: 'SENT',
    });

    // 2. Attacker provides a spoofed tenantId in the payload
    const sesNotification = {
      Type: 'Notification',
      Message: JSON.stringify({
        notificationType: 'Bounce',
        bounce: {
          bounceType: 'Permanent',
          bounceSubType: 'General',
          bouncedRecipients: [
            {
              emailAddress: bounceEmail,
              diagnosticCode: 'smtp; 550 5.1.1 user does not exist',
            },
          ],
        },
      }),
      tenantId: spoofedTenantId, // Attacker trying to suppress in spoofedTenantId
    };

    // Authenticate with valid secret
    const webhookResult = await service.handleBounceWebhook(sesNotification, {
      'x-webhook-secret': env.EMAIL_BOUNCE_WEBHOOK_SECRET,
    });
    assert.equal(webhookResult.processed, 1);

    // Suppression MUST be created in testTenantId (resolved from emailMessages), NOT spoofedTenantId
    const suppressionGenuine = await repo.findSuppression(testTenantId, bounceEmail);
    assert.ok(suppressionGenuine);
    assert.equal(suppressionGenuine.email, bounceEmail);
    assert.equal(suppressionGenuine.reason, 'BOUNCE');

    // Confirm no suppression exists for the spoofed tenantId
    const suppressionSpoofed = await repo.findSuppression(spoofedTenantId, bounceEmail);
    assert.equal(suppressionSpoofed, undefined);
  });

  test('handleBounceWebhook creates no suppression when recipient is not found in emailMessages', async () => {
    const unknownEmail = `unknown-recipient-${Date.now()}@example.com`;
    const payload = {
      email: unknownEmail,
      reason: 'BOUNCE',
      tenantId: testTenantId, // body tenantId must be ignored
    };

    const result = await service.handleBounceWebhook(payload, {
      'x-webhook-secret': env.EMAIL_BOUNCE_WEBHOOK_SECRET,
    });
    assert.equal(result.processed, 0);

    const suppression = await repo.findSuppression(testTenantId, unknownEmail);
    assert.equal(suppression, undefined);
  });
});
