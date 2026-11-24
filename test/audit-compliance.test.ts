import assert from 'node:assert';
import { after, before, describe, it } from 'node:test';
import { sql } from 'drizzle-orm';

import { closeDb, db } from '@/config/db';
import { closeRedisClients } from '@/config/redis';
import {
  computeAuditRowHash,
  GENESIS_HASH,
  type CanonicalAuditData,
} from '@/modules/audit/audit.crypto';

let dbConnected = false;

before(async () => {
  try {
    await db.execute(sql`SELECT 1`);
    dbConnected = true;
  } catch {
    dbConnected = false;
  }
});

after(async () => {
  await Promise.allSettled([closeRedisClients(), closeDb()]);
  setTimeout(() => process.exit(0), 200).unref();
});

describe('File 08 — Audit Trail, Tamper Evidence & Compliance', () => {
  describe('1. Cryptographic Hash Chaining & Canonical Hashing', () => {
    const baseRow: CanonicalAuditData = {
      tenantId: '11111111-1111-1111-1111-111111111111',
      action: 'ROLES.ASSIGNED',
      actorUserId: '22222222-2222-2222-2222-222222222222',
      actorEmail: 'admin@acme.corp',
      actorType: 'USER',
      source: 'DIRECT',
      result: 'SUCCESS',
      entityType: 'AppRole',
      entityId: '33333333-3333-3333-3333-333333333333',
      createdAt: new Date('2026-11-17T12:00:00.000Z'),
    };

    it('generates consistent SHA-256 hash for identical canonical row data', () => {
      const hashA = computeAuditRowHash(GENESIS_HASH, baseRow);
      const hashB = computeAuditRowHash(GENESIS_HASH, baseRow);
      assert.strictEqual(hashA, hashB);
      assert.strictEqual(typeof hashA, 'string');
      assert.strictEqual(hashA.length, 64);
    });

    it('uses GENESIS_HASH when prevHash is null or empty', () => {
      const hashWithNull = computeAuditRowHash(null, baseRow);
      const hashWithGenesis = computeAuditRowHash(GENESIS_HASH, baseRow);
      const hashWithEmpty = computeAuditRowHash('', baseRow);
      assert.strictEqual(hashWithNull, hashWithGenesis);
      assert.strictEqual(hashWithEmpty, hashWithGenesis);
    });

    it('detects tampering in any canonical field: action, actor, timestamp or prevHash', () => {
      const originalHash = computeAuditRowHash(GENESIS_HASH, baseRow);

      // Alter action
      const tamperedAction = computeAuditRowHash(GENESIS_HASH, {
        ...baseRow,
        action: 'ROLES.DELETED',
      });
      assert.notStrictEqual(tamperedAction, originalHash);

      // Alter actorEmail
      const tamperedActor = computeAuditRowHash(GENESIS_HASH, {
        ...baseRow,
        actorEmail: 'imposter@evil.org',
      });
      assert.notStrictEqual(tamperedActor, originalHash);

      // Alter timestamp
      const tamperedTime = computeAuditRowHash(GENESIS_HASH, {
        ...baseRow,
        createdAt: new Date('2026-11-17T12:00:01.000Z'),
      });
      assert.notStrictEqual(tamperedTime, originalHash);

      // Alter predecessor hash
      const tamperedPrev = computeAuditRowHash(
        'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        baseRow,
      );
      assert.notStrictEqual(tamperedPrev, originalHash);
    });

    it('verifies sequential blockchain-like hash linking across multiple rows', () => {
      const row1Data: CanonicalAuditData = {
        ...baseRow,
        action: 'TENANT.CREATED',
        createdAt: new Date('2026-11-17T10:00:00.000Z'),
      };
      const row1Hash = computeAuditRowHash(GENESIS_HASH, row1Data);

      const row2Data: CanonicalAuditData = {
        ...baseRow,
        action: 'USER.INVITED',
        createdAt: new Date('2026-11-17T10:05:00.000Z'),
      };
      const row2Hash = computeAuditRowHash(row1Hash, row2Data);

      const row3Data: CanonicalAuditData = {
        ...baseRow,
        action: 'ROLES.ASSIGNED',
        createdAt: new Date('2026-11-17T10:10:00.000Z'),
      };
      const row3Hash = computeAuditRowHash(row2Hash, row3Data);

      // Valid sequence chaining
      assert.strictEqual(computeAuditRowHash(row1Hash, row2Data), row2Hash);
      assert.strictEqual(computeAuditRowHash(row2Hash, row3Data), row3Hash);

      // If an attacker deletes or alters row2, row3 fails verification
      const forgedRow2Hash = computeAuditRowHash(row1Hash, {
        ...row2Data,
        actorEmail: 'attacker@evil.org',
      });
      assert.notStrictEqual(
        computeAuditRowHash(forgedRow2Hash, row3Data),
        row3Hash,
        'Tampering with predecessor must invalidate successor hash',
      );
    });
  });

  describe('2. Live Database Chain Verification Functionality', () => {
    it('verifies empty or non-existent audit logs without error', async (t) => {
      if (!dbConnected) {
        t.skip('Database offline, skipping live query');
        return;
      }
      const { verifyAuditChain } = await import('@/modules/audit/audit.service');
      const result = await verifyAuditChain('00000000-0000-0000-0000-000000000000');
      assert.strictEqual(result.verified, true);
      assert.strictEqual(result.totalChecked, 0);
    });
  });
});
