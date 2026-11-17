import assert from 'node:assert/strict';
import { after, describe, it } from 'node:test';

import { closeDb } from '@/config/db';
import { closeRedisClients } from '@/config/redis';
import * as authRepo from '@/modules/auth/auth.repository';
import * as authService from '@/modules/auth/auth.service';
import { assertSafeUrl, validateReturnTo } from '@/modules/sso/sso.security';
import { ssoService } from '@/modules/sso/sso.service';
import {
  consumeSsoState,
  createSsoState,
  recordSamlAssertion,
} from '@/modules/sso/sso.state';

after(async () => {
  await Promise.allSettled([closeRedisClients(), closeDb()]);
  setTimeout(() => process.exit(0), 200).unref();
});

describe('SSO Security Hardening & Isolation Tests (Gap Pack 01)', () => {
  describe('1. Open Redirect & returnTo Validation', () => {
    it('accepts safe relative paths', () => {
      assert.strictEqual(validateReturnTo('/'), '/');
      assert.strictEqual(validateReturnTo('/dashboard'), '/dashboard');
      assert.strictEqual(validateReturnTo('/w/acme/settings?tab=sso'), '/w/acme/settings?tab=sso');
      assert.strictEqual(validateReturnTo('/app/projects#overview'), '/app/projects#overview');
    });

    it('rejects external URLs and protocol-relative paths', () => {
      assert.strictEqual(validateReturnTo('https://evil.com'), '/');
      assert.strictEqual(validateReturnTo('http://evil.com/phish'), '/');
      assert.strictEqual(validateReturnTo('//evil.com/test'), '/');
      assert.strictEqual(validateReturnTo('/\\evil.com'), '/');
      assert.strictEqual(validateReturnTo('javascript:alert(1)'), '/');
      assert.strictEqual(validateReturnTo(null), '/');
      assert.strictEqual(validateReturnTo(''), '/');
    });
  });

  describe('2. SSRF Protection Guard', () => {
    it('blocks AWS/cloud metadata address (169.254.169.254)', async () => {
      await assert.rejects(
        async () => {
          await assertSafeUrl('http://169.254.169.254/latest/meta-data');
        },
        (err: any) => {
          assert.strictEqual(err.status, 400);
          assert.ok(err.message.includes('SSRF blocked') || err.message.includes('Insecure URL protocol'));
          return true;
        },
      );
    });

    it('blocks RFC1918 private IPv4 networks', async () => {
      const privateIps = [
        'https://10.0.0.1/auth',
        'https://172.16.5.1/sso',
        'https://192.168.1.100/idp',
        'https://127.0.0.1/admin',
      ];

      for (const url of privateIps) {
        await assert.rejects(
          async () => {
            await assertSafeUrl(url);
          },
          (err: any) => {
            assert.strictEqual(err.status, 400);
            return true;
          },
        );
      }
    });

    it('accepts valid public HTTPS endpoints', async () => {
      const url = await assertSafeUrl('https://example.com/sso/saml');
      assert.strictEqual(url.hostname, 'example.com');
      assert.strictEqual(url.protocol, 'https:');
    });
  });

  describe('3. Server-Side SSO State Binding & Replay Protection', () => {
    it('creates and atomically consumes single-use SSO state', async () => {
      const tenantId = '00000000-0000-0000-0000-000000000001';
      const stateId = await createSsoState({
        tenantId,
        nonce: 'nonce-12345',
        returnTo: '/w/acme',
        host: 'example.com',
        providerType: 'SAML',
      });

      assert.ok(stateId.length > 20);

      // First consume succeeds
      const state = await consumeSsoState(stateId);
      assert.ok(state);
      assert.strictEqual(state.tenantId, tenantId);
      assert.strictEqual(state.nonce, 'nonce-12345');
      assert.strictEqual(state.returnTo, '/w/acme');

      // Second consume must return null (single use)
      const replayed = await consumeSsoState(stateId);
      assert.strictEqual(replayed, null);
    });

    it('prevents SAML assertion replay attacks', async () => {
      const assertionId = `assert-${Date.now()}`;

      // First processing succeeds
      await recordSamlAssertion(assertionId, 60);

      // Immediate second processing must throw unauthorized replay
      await assert.rejects(
        async () => {
          await recordSamlAssertion(assertionId, 60);
        },
        (err: any) => {
          assert.strictEqual(err.status, 401);
          assert.ok(err.message.includes('replay'));
          return true;
        },
      );
    });
  });

  describe('4. Forged / Unsigned SAML Rejection', () => {
    it('rejects missing or invalid state in ACS callback', async () => {
      await assert.rejects(
        async () => {
          await ssoService.handleSamlAcs({
            SAMLResponse: Buffer.from('<saml>fake</saml>').toString('base64'),
            RelayState: 'non-existent-state',
          });
        },
        (err: any) => {
          assert.strictEqual(err.status, 401);
          return true;
        },
      );
    });

    it('rejects hand-crafted unsigned SAML response without valid cryptographic signature', async () => {
      const fakeTenantId = '00000000-0000-0000-0000-000000000002';
      const stateId = await createSsoState({
        tenantId: fakeTenantId,
        nonce: 'nonce-forged',
        returnTo: '/',
        host: 'localhost:3000',
        providerType: 'SAML',
      });

      // Handcrafted forged XML claiming to be admin@enterprise.com
      const forgedXml = `
        <samlp:Response xmlns:samlp="urn:oasis:names:tc:SAML:2.0:protocol" ID="forged-1" IssueInstant="2026-11-17T00:00:00Z">
          <saml:Assertion xmlns:saml="urn:oasis:names:tc:SAML:2.0:assertion" ID="assertion-forged">
            <saml:Subject>
              <saml:NameID>admin@enterprise.com</saml:NameID>
            </saml:Subject>
          </saml:Assertion>
        </samlp:Response>
      `;

      await assert.rejects(
        async () => {
          await ssoService.handleSamlAcs({
            SAMLResponse: Buffer.from(forgedXml).toString('base64'),
            RelayState: stateId,
          });
        },
        (err: any) => {
          assert.strictEqual(err.status, 401);
          return true;
        },
      );
    });
  });

  describe('5. Password Authentication Guard for Null Password Hash (SSO Users)', () => {
    it('rejects password login for users provisioned with null password hash', async () => {
      const ssoEmail = `sso.only.${Date.now()}@example.com`;
      await authRepo.createUser({
        email: ssoEmail,
        passwordHash: null,
        name: 'SSO User',
      });

      await assert.rejects(
        async () => {
          await authService.login({
            email: ssoEmail,
            password: 'AnyPassword123!',
          });
        },
        (err: any) => {
          assert.strictEqual(err.status, 401);
          return true;
        },
      );
    });
  });
});
