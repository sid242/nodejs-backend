import { and, desc, eq } from 'drizzle-orm';

import { db } from '@/config/db';
import * as schema from '@/db/schema';
import { tenantDb } from '@/db/tenancy/context';

export function generateTicketRef(): string {
  const time = Date.now().toString(36).toUpperCase();
  const rand = Math.floor(100 + Math.random() * 900);
  return `TICK-${time}-${rand}`;
}

export async function createTicket(data: {
  tenantId: string;
  userId: string;
  ticketRef: string;
  subject: string;
  description: string;
  priority: string;
  category: string;
  metadata?: Record<string, unknown>;
}) {
  const [ticket] = await tenantDb()
    .insert(schema.supportTickets)
    .values({
      tenantId: data.tenantId,
      userId: data.userId,
      ticketRef: data.ticketRef,
      subject: data.subject,
      description: data.description,
      priority: data.priority,
      category: data.category,
      metadata: data.metadata ?? {},
      status: 'OPEN',
    })
    .returning();

  return ticket;
}

export async function getTicketById(tenantId: string, ticketId: string) {
  const [ticket] = await tenantDb()
    .select()
    .from(schema.supportTickets)
    .where(
      and(eq(schema.supportTickets.tenantId, tenantId), eq(schema.supportTickets.id, ticketId)),
    )
    .limit(1);

  return ticket;
}

export async function listTenantTickets(tenantId: string, status?: string) {
  const conditions = [eq(schema.supportTickets.tenantId, tenantId)];
  if (status) conditions.push(eq(schema.supportTickets.status, status));

  return tenantDb()
    .select()
    .from(schema.supportTickets)
    .where(and(...conditions))
    .orderBy(desc(schema.supportTickets.createdAt))
    .limit(100);
}

export async function listAllPlatformTickets(status?: string) {
  const conditions = [];
  if (status) conditions.push(eq(schema.supportTickets.status, status));

  return db
    .select()
    .from(schema.supportTickets)
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(desc(schema.supportTickets.createdAt))
    .limit(100);
}

export async function updateTicket(
  tenantId: string,
  ticketId: string,
  data: {
    status?: string;
    priority?: string;
    assigneeStaffId?: string | null;
  },
) {
  const [updated] = await tenantDb()
    .update(schema.supportTickets)
    .set({
      ...data,
      resolvedAt: data.status === 'RESOLVED' ? new Date() : undefined,
      updatedAt: new Date(),
    })
    .where(
      and(eq(schema.supportTickets.tenantId, tenantId), eq(schema.supportTickets.id, ticketId)),
    )
    .returning();

  return updated;
}

export async function createTicketMessage(data: {
  ticketId: string;
  tenantId: string;
  senderType: 'USER' | 'STAFF' | 'SYSTEM';
  senderId: string;
  senderName?: string;
  message: string;
  attachments?: Record<string, unknown>[];
  isInternal?: boolean;
}) {
  const [msg] = await tenantDb()
    .insert(schema.supportTicketMessages)
    .values({
      ticketId: data.ticketId,
      tenantId: data.tenantId,
      senderType: data.senderType,
      senderId: data.senderId,
      senderName: data.senderName ?? null,
      message: data.message,
      attachments: data.attachments ?? [],
      isInternal: data.isInternal ?? false,
    })
    .returning();

  return msg;
}

export async function listTicketMessages(tenantId: string, ticketId: string) {
  return tenantDb()
    .select()
    .from(schema.supportTicketMessages)
    .where(
      and(
        eq(schema.supportTicketMessages.tenantId, tenantId),
        eq(schema.supportTicketMessages.ticketId, ticketId),
      ),
    )
    .orderBy(schema.supportTicketMessages.createdAt);
}

export async function createFeedbackItem(data: {
  tenantId?: string | null;
  userId?: string | null;
  rating: number;
  category: string;
  comment: string;
  metadata?: Record<string, unknown>;
}) {
  const [item] = await db
    .insert(schema.feedbackItems)
    .values({
      tenantId: data.tenantId ?? null,
      userId: data.userId ?? null,
      rating: data.rating,
      category: data.category,
      comment: data.comment,
      metadata: data.metadata ?? {},
    })
    .returning();

  return item;
}

export async function listFeedbackItems(limit = 50) {
  return db
    .select()
    .from(schema.feedbackItems)
    .orderBy(desc(schema.feedbackItems.createdAt))
    .limit(limit);
}
