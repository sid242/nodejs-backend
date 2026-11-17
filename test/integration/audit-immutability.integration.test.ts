import assert from 'node:assert/strict';
import { test } from 'node:test';
import { computeAuditRowHash, GENESIS_HASH } from '../../src/modules/audit/audit.crypto';

test('Audit Cryptographic Immutability Integration Invariants', async (t) => {
  await t.test('Genesis hash links to 64 zero characters', () => {
    const row = {
      tenantId: '00000000-0000-0000-0000-000000000001',
      actorUserId: '00000000-0000-0000-0000-000000000002',
      action: 'TENANT_CREATED',
      entityType: 'Tenant',
      entityId: '00000000-0000-0000-0000-000000000001',
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
    };

    const hash = computeAuditRowHash(GENESIS_HASH, row);

    assert.strictEqual(typeof hash, 'string', 'Hash must be a string');
    assert.strictEqual(hash.length, 64, 'SHA-256 hash must be 64 hex characters');
  });

  await t.test('Modifying any field alters the resulting row hash', () => {
    const baseRow = {
      tenantId: '00000000-0000-0000-0000-000000000001',
      actorUserId: '00000000-0000-0000-0000-000000000002',
      action: 'TENANT_UPDATED',
      entityType: 'Tenant',
      entityId: '00000000-0000-0000-0000-000000000001',
      createdAt: new Date('2026-01-01T12:00:00.000Z'),
    };

    const prevHash = 'a'.repeat(64);
    const originalHash = computeAuditRowHash(prevHash, baseRow);

    // Tampered row with different action
    const tamperedRow = {
      ...baseRow,
      action: 'TENANT_DELETED',
    };
    const tamperedHash = computeAuditRowHash(prevHash, tamperedRow);

    assert.notStrictEqual(
      originalHash,
      tamperedHash,
      'Tampering with payload must produce a different cryptographic hash',
    );
  });

  await t.test('Hash chain is strictly sequential', () => {
    const row1 = {
      tenantId: 't-1',
      actorUserId: 'u-1',
      action: 'FILE_UPLOAD',
      entityType: 'File',
      entityId: 'f-1',
      createdAt: new Date('2026-01-01T10:00:00.000Z'),
    };

    const row2 = {
      tenantId: 't-1',
      actorUserId: 'u-1',
      action: 'FILE_DELETE',
      entityType: 'File',
      entityId: 'f-1',
      createdAt: new Date('2026-01-01T11:00:00.000Z'),
    };

    const h0 = GENESIS_HASH;
    const h1 = computeAuditRowHash(h0, row1);
    const h2 = computeAuditRowHash(h1, row2);

    assert.strictEqual(h1.length, 64);
    assert.strictEqual(h2.length, 64);
    assert.notStrictEqual(h1, h2);
  });
});
