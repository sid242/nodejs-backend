import { logger } from '@/config/logger';
import { AppError } from '@/lib/errors';
import { logSecurityEvent } from '@/modules/audit/audit.service';

import type {
  AddTicketMessageDto,
  CreateFeedbackDto,
  CreateTicketDto,
  UpdateTicketDto,
} from './support.dto';
import * as supportRepo from './support.repository';

// ─── Tenant Tickets ──────────────────────────────────────────────────────────

export async function createTicket(
  tenantId: string,
  userId: string,
  userName: string,
  data: CreateTicketDto,
) {
  const ticketRef = supportRepo.generateTicketRef();
  logger.info({ tenantId, userId, ticketRef, category: data.category }, 'Creating support ticket');

  const ticket = await supportRepo.createTicket({
    tenantId,
    userId,
    ticketRef,
    subject: data.subject,
    description: data.description,
    priority: data.priority,
    category: data.category,
    metadata: data.metadata,
  });

  if (!ticket) {
    throw AppError.internal('Failed to create support ticket');
  }

  // Add initial message into thread
  await supportRepo.createTicketMessage({
    ticketId: ticket.id,
    tenantId,
    senderType: 'USER',
    senderId: userId,
    senderName: userName,
    message: data.description,
  });

  await logSecurityEvent({
    tenantId,
    userId,
    action: 'support_ticket.created',
    resourceType: 'support_ticket',
    resourceId: ticket.id,
    metadata: { ticketRef, category: data.category, priority: data.priority },
  });

  return ticket;
}

export async function getTicketDetails(tenantId: string, ticketId: string) {
  const ticket = await supportRepo.getTicketById(tenantId, ticketId);
  if (!ticket) {
    throw AppError.notFound('Support ticket not found');
  }

  const messages = await supportRepo.listTicketMessages(tenantId, ticketId);
  return { ticket, messages };
}

export async function listTenantTickets(tenantId: string, status?: string) {
  return supportRepo.listTenantTickets(tenantId, status);
}

export async function addTicketMessage(
  tenantId: string,
  ticketId: string,
  sender: { id: string; name?: string; type: 'USER' | 'STAFF' },
  data: AddTicketMessageDto,
) {
  const ticket = await supportRepo.getTicketById(tenantId, ticketId);
  if (!ticket) {
    throw AppError.notFound('Support ticket not found');
  }

  if (ticket.status === 'CLOSED') {
    throw AppError.badRequest('Cannot reply to a closed support ticket');
  }

  const message = await supportRepo.createTicketMessage({
    ticketId,
    tenantId,
    senderType: sender.type,
    senderId: sender.id,
    senderName: sender.name,
    message: data.message,
    attachments: data.attachments,
  });

  // If ticket was pending and user replies, move to open
  if (ticket.status === 'PENDING' && sender.type === 'USER') {
    await supportRepo.updateTicket(tenantId, ticketId, { status: 'OPEN' });
  }

  return message;
}

export async function updateTicket(tenantId: string, ticketId: string, data: UpdateTicketDto) {
  const ticket = await supportRepo.getTicketById(tenantId, ticketId);
  if (!ticket) {
    throw AppError.notFound('Support ticket not found');
  }

  return supportRepo.updateTicket(tenantId, ticketId, data);
}

// ─── Platform Support Queue ──────────────────────────────────────────────────

export async function listAllPlatformTickets(status?: string) {
  return supportRepo.listAllPlatformTickets(status);
}

// ─── Feedback ────────────────────────────────────────────────────────────────

export async function submitFeedback(
  data: CreateFeedbackDto,
  context?: { tenantId?: string; userId?: string },
) {
  logger.info({ rating: data.rating, category: data.category }, 'User feedback received');
  return supportRepo.createFeedbackItem({
    tenantId: context?.tenantId,
    userId: context?.userId,
    rating: data.rating,
    category: data.category,
    comment: data.comment,
    metadata: data.metadata,
  });
}

export async function listFeedback(limit?: number) {
  return supportRepo.listFeedbackItems(limit);
}
