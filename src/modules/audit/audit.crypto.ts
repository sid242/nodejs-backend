import crypto from 'node:crypto';

export interface CanonicalAuditData {
  tenantId?: string | null;
  action: string;
  actorUserId?: string | null;
  actorEmail?: string | null;
  actorType?: string | null;
  source?: string | null;
  result?: string | null;
  entityType?: string | null;
  entityId?: string | null;
  createdAt: Date | string;
}

export const GENESIS_HASH = '0000000000000000000000000000000000000000000000000000000000000000';

/**
 * Computes a tamper-evident SHA-256 hash chaining an audit log row to its predecessor.
 * If prevHash is null/empty, the constant GENESIS_HASH is used as root.
 */
export function computeAuditRowHash(
  prevHash: string | null | undefined,
  row: CanonicalAuditData,
): string {
  const effectivePrev = prevHash?.trim() || GENESIS_HASH;
  const canonicalString = [
    effectivePrev,
    row.tenantId ?? '',
    row.action,
    row.actorUserId ?? '',
    row.actorEmail ?? '',
    row.actorType ?? 'USER',
    row.source ?? 'DIRECT',
    row.result ?? 'SUCCESS',
    row.entityType ?? '',
    row.entityId ?? '',
    row.createdAt instanceof Date ? row.createdAt.toISOString() : String(row.createdAt),
  ].join('|');

  return crypto.createHash('sha256').update(canonicalString, 'utf8').digest('hex');
}
