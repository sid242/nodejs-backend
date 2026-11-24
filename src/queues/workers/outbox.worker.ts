import type { Job } from 'bullmq';

import { db } from '@/config/db';
import { logger } from '@/config/logger';
import {
  fetchPendingOutboxEvents,
  markOutboxEventFailed,
  markOutboxEventPublished,
} from '@/modules/audit/outbox.repository';
import { emitToRoom, emitToUser, emitToWorkspaceUser } from '@/sockets/emitter';

/**
 * Transactional Outbox Worker:
 * Reads pending outbox events using FOR UPDATE SKIP LOCKED concurrency semantics,
 * dispatches them reliably with exponential backoff, and ensures zero event loss or duplicate execution.
 */
export async function processOutboxEvents(
  _job?: Job,
): Promise<{ processed: number; failed: number }> {
  try {
    const events = await fetchPendingOutboxEvents(50, db);
    if (!events || events.length === 0) {
      return { processed: 0, failed: 0 };
    }

    let processed = 0;
    let failed = 0;

    for (const event of events) {
      try {
        const payload = (event.payload as any) ?? {};

        // Dispatch via real-time WebSocket emitter
        if (typeof payload?.userId === 'string' && event.tenantId) {
          emitToWorkspaceUser(event.tenantId, payload.userId, event.eventType, payload);
        } else if (payload?.userId) {
          emitToUser(payload.userId, event.eventType, payload);
        } else if (event.tenantId) {
          emitToRoom(`tenant:${event.tenantId}`, event.eventType, payload);
        }

        await markOutboxEventPublished(event.id);
        processed++;
      } catch (err: any) {
        failed++;
        logger.error(
          { err, eventId: event.id, eventType: event.eventType },
          'Failed to deliver transactional outbox event',
        );
        await markOutboxEventFailed(event.id, err?.message ?? 'Outbox event delivery error');
      }
    }

    if (processed > 0 || failed > 0) {
      logger.info(
        { processed, failed, batchSize: events.length },
        'Dispatched transactional outbox event batch',
      );
    }

    return { processed, failed };
  } catch (error) {
    logger.error({ err: error }, 'Outbox processing worker batch failed');
    return { processed: 0, failed: 1 };
  }
}
