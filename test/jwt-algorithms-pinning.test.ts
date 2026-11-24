import assert from 'node:assert/strict';
import test from 'node:test';
import jwt from 'jsonwebtoken';

import { env } from '@/config/env';
import { issueSupportToken, verifyAccessToken, verifySupportToken } from '@/modules/auth/tokens';

test('verifyAccessToken accepts valid HS256 token and rejects algorithm none', () => {
  const validToken = jwt.sign(
    { sub: 'usr-123', typ: 'USER', email: 'user@example.com' },
    env.JWT_ACCESS_SECRET,
    { audience: 'customer-api', algorithm: 'HS256', expiresIn: '15m' },
  );

  const payload = verifyAccessToken(validToken);
  assert.equal(payload.sub, 'usr-123');

  // Algorithm 'none' attack payload
  const noneToken = jwt.sign(
    { sub: 'usr-hacker', typ: 'USER', email: 'hacker@example.com' },
    '',
    { audience: 'customer-api', algorithm: 'none' },
  );

  assert.throws(
    () => verifyAccessToken(noneToken),
    /invalid algorithm|jwt signature is required/i,
  );
});

test('verifySupportToken accepts valid HS256 token and rejects algorithm none', () => {
  const { token: validToken } = issueSupportToken({
    sess: 'sess-123',
    staffId: 'staff-456',
    tenantId: '11111111-1111-1111-1111-111111111111',
    mode: 'TENANT_SCOPED',
    scope: 'READ_ONLY',
  });

  const payload = verifySupportToken(validToken);
  assert.equal(payload.staffId, 'staff-456');

  // Algorithm 'none' attack payload
  const noneToken = jwt.sign(
    {
      typ: 'SUPPORT',
      sess: 'sess-fake',
      staffId: 'staff-evil',
      tenantId: '11111111-1111-1111-1111-111111111111',
      mode: 'TENANT_SCOPED',
      scope: 'FULL_ADMIN',
    },
    '',
    { audience: 'customer-api', algorithm: 'none' },
  );

  assert.throws(
    () => verifySupportToken(noneToken),
    /invalid algorithm|jwt signature is required/i,
  );
});

test('ESLint baseline configuration enforces no-explicit-any as error on non-baseline files', async () => {
  const { ESLint } = await import('eslint');
  const eslint = new ESLint();

  // Baseline legacy file is downgraded to warning (1)
  const baselineConfig = await eslint.calculateConfigForFile('src/db/migrate.ts');
  assert.equal(baselineConfig.rules?.['@typescript-eslint/no-explicit-any']?.[0], 1);

  // New/unlisted file enforces error (2)
  const strictConfig = await eslint.calculateConfigForFile('src/config/env.ts');
  assert.equal(strictConfig.rules?.['@typescript-eslint/no-explicit-any']?.[0], 2);
});
