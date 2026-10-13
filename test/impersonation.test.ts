import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import {
  issueImpersonationToken,
  verifyAccessToken,
  revokeImpersonationSession,
  isImpersonationSessionActive,
} from '../src/modules/auth/tokens.js';
import { requireAuth } from '../src/middleware/auth.js';
import { blockIfImpersonating } from '../src/middleware/impersonate-guard.js';
import { impersonateUserDto } from '../src/modules/auth/auth.dto.js';
import { closeRedisClients } from '../src/config/redis.js';
import { closeDb } from '../src/config/db.js';

after(async () => {
  await Promise.allSettled([closeRedisClients(), closeDb()]);
});

test('issueImpersonationToken issues short-lived token with dual-identity claims', async () => {
  const targetUser = { id: randomUUID(), role: 'USER' };
  const adminId = randomUUID();
  const sessionId = randomUUID();
  const reason = 'Support ticket #8472';

  const result = await issueImpersonationToken(
    targetUser,
    {
      userId: adminId,
      role: 'ADMIN',
      reason,
      sessionId,
    },
    20, // 20 minutes
  );

  assert.ok(result.accessToken);
  assert.equal(result.sessionId, sessionId);
  assert.equal(result.expiresInSeconds, 1200);

  const payload = verifyAccessToken(result.accessToken);
  assert.equal(payload.sub, targetUser.id);
  assert.equal(payload.role, 'USER');
  assert.ok((payload as any).impersonator);
  assert.equal((payload as any).impersonator.userId, adminId);
  assert.equal((payload as any).impersonator.role, 'ADMIN');
  assert.equal((payload as any).impersonator.reason, reason);
  assert.equal((payload as any).impersonator.sessionId, sessionId);
});

test('requireAuth middleware recognizes and extracts impersonator context', async () => {
  const targetUser = { id: randomUUID(), role: 'USER' };
  const adminId = randomUUID();
  const sessionId = randomUUID();
  const reason = 'Debugging patient record';

  const { accessToken } = await issueImpersonationToken(
    targetUser,
    {
      userId: adminId,
      role: 'ADMIN',
      reason,
      sessionId,
    },
    15,
  );

  const req: any = {
    headers: { authorization: `Bearer ${accessToken}` },
  };
  let calledNext = false;

  await requireAuth(req, {} as any, (err?: any) => {
    assert.ifError(err);
    calledNext = true;
  });

  assert.ok(calledNext);
  assert.equal(req.user.id, targetUser.id);
  assert.equal(req.user.role, 'USER');
  assert.equal(req.isImpersonated, true);
  assert.ok(req.impersonator);
  assert.equal(req.impersonator.userId, adminId);
  assert.equal(req.impersonator.reason, reason);
});

test('blockIfImpersonating middleware allows normal users but blocks impersonated sessions', () => {
  const guard = blockIfImpersonating('Password update');

  // Case 1: Normal authenticated user
  const normalReq: any = { isImpersonated: false };
  let normalCalled = false;
  guard(normalReq, {} as any, (err?: any) => {
    assert.ifError(err);
    normalCalled = true;
  });
  assert.ok(normalCalled);

  // Case 2: Impersonated user
  const impersonatedReq: any = { isImpersonated: true };
  let blockedErr: any = null;
  guard(impersonatedReq, {} as any, (err?: any) => {
    blockedErr = err;
  });
  assert.ok(blockedErr);
  assert.equal(blockedErr.status, 403);
  assert.ok(blockedErr.message.includes('Password update cannot be performed while impersonating'));
});

test('impersonateUserDto schema validates targetUserId, reason, and duration limits', () => {
  // Valid payload
  const valid = impersonateUserDto.safeParse({
    targetUserId: randomUUID(),
    reason: 'Investigating billing discrepancy',
    durationMinutes: 45,
  });
  assert.ok(valid.success);
  if (valid.success) {
    assert.equal(valid.data.durationMinutes, 45);
  }

  // Reason too short (< 5 chars)
  const invalidReason = impersonateUserDto.safeParse({
    targetUserId: randomUUID(),
    reason: 'fix',
  });
  assert.equal(invalidReason.success, false);

  // Invalid UUID
  const invalidUUID = impersonateUserDto.safeParse({
    targetUserId: 'not-a-uuid',
    reason: 'Valid reason here',
  });
  assert.equal(invalidUUID.success, false);

  // Default durationMinutes
  const defaultDuration = impersonateUserDto.safeParse({
    targetUserId: randomUUID(),
    reason: 'Valid reason for session',
  });
  assert.ok(defaultDuration.success);
  if (defaultDuration.success) {
    assert.equal(defaultDuration.data.durationMinutes, 30);
  }
});

test('isImpersonationSessionActive and revokeImpersonationSession handle session state gracefully', async () => {
  const sessionId = randomUUID();
  await revokeImpersonationSession(sessionId);
  const active = await isImpersonationSessionActive(sessionId);
  assert.equal(typeof active, 'boolean');
});

test('enrichAuditMetadata accurately injects dual-actor context for DPDP compliance', async () => {
  const { enrichAuditMetadata } = await import('../src/modules/audit/audit.service.js');

  const adminId = randomUUID();
  const sessionId = randomUUID();
  const baseMeta = { actionDetails: 'Patient chart reviewed' };

  // Case 1: Normal request without impersonator
  const normalResult = enrichAuditMetadata(baseMeta, undefined);
  assert.deepEqual(normalResult, baseMeta);

  // Case 2: Impersonated request
  const impersonatedResult = enrichAuditMetadata(baseMeta, {
    userId: adminId,
    role: 'ADMIN',
    reason: 'Investigating billing discrepancy',
    sessionId,
  });

  assert.equal(impersonatedResult?.actionDetails, 'Patient chart reviewed');
  assert.equal(impersonatedResult?.impersonatedBy, adminId);
  assert.equal(impersonatedResult?.impersonatorRole, 'ADMIN');
  assert.equal(impersonatedResult?.impersonationReason, 'Investigating billing discrepancy');
  assert.equal(impersonatedResult?.impersonationSessionId, sessionId);
});

test('chaining prevention blocks nested impersonation attempts', () => {
  const chainingGuard = blockIfImpersonating('Impersonation');

  const chainedReq: any = { isImpersonated: true };
  let error: any = null;
  chainingGuard(chainedReq, {} as any, (err?: any) => {
    error = err;
  });

  assert.ok(error);
  assert.equal(error.status, 403);
  assert.ok(error.message.includes('Impersonation cannot be performed while impersonating'));
});
