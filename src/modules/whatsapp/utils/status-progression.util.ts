import type { WhatsAppMessageInternalStatus } from '@/db/schema/enums';

const STATUS_RANK: Record<WhatsAppMessageInternalStatus, number> = {
  QUEUED: 10,
  ACCEPTED: 20,
  SENT: 30,
  DELIVERED: 40,
  READ: 50,
  FAILED: 99,
};

/**
 * Determines whether a new message delivery status can validly advance the current status.
 *
 * Rules:
 * - Status progression is strictly monotonic: QUEUED < ACCEPTED < SENT < DELIVERED < READ.
 * - Out-of-order events (e.g. late 'SENT' after 'DELIVERED' or 'READ') are rejected.
 * - 'READ' is fully terminal; no subsequent event can downgrade or change it.
 * - 'DELIVERED' can only transition to 'READ'.
 * - 'FAILED' is terminal for normal delivery, but can be superseded if a late 'DELIVERED'
 *   or 'READ' event arrives (handling Meta's transient retry/recovery behavior).
 * - 'FAILED' cannot be applied to already 'DELIVERED' or 'READ' messages.
 */
export function shouldUpdateMessageStatus(
  currentStatus: WhatsAppMessageInternalStatus,
  newStatus: WhatsAppMessageInternalStatus,
): boolean {
  if (currentStatus === newStatus) {
    return false;
  }

  // If already READ, nothing can downgrade or alter it
  if (currentStatus === 'READ') {
    return false;
  }

  // If already DELIVERED, only READ can advance it
  if (currentStatus === 'DELIVERED') {
    return newStatus === 'READ';
  }

  // If currently FAILED: only DELIVERED or READ can supersede it (Meta transient recovery)
  if (currentStatus === 'FAILED') {
    return newStatus === 'DELIVERED' || newStatus === 'READ';
  }

  // If new status is FAILED: allowed only from pre-delivery states (QUEUED, ACCEPTED, SENT)
  if (newStatus === 'FAILED') {
    return currentStatus === 'QUEUED' || currentStatus === 'ACCEPTED' || currentStatus === 'SENT';
  }

  // Standard forward progression
  const currentRank = STATUS_RANK[currentStatus] ?? 0;
  const newRank = STATUS_RANK[newStatus] ?? 0;

  return newRank > currentRank;
}
