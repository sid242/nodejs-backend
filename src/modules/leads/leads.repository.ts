import { and, desc, eq, ilike, or, sql, SQL } from 'drizzle-orm';

import { Database, db as defaultDb } from '@/config/db';
import { Lead, leads } from '@/db/schema/crm/leads';

import { CreateLeadDto, ListLeadsQueryDto, UpdateLeadDto } from './leads.dto';

export class LeadsRepository {
  async findLeadById(
    tenantId: string,
    leadId: string,
    targetDb: Database = defaultDb,
  ): Promise<Lead | null> {
    const [record] = await targetDb
      .select()
      .from(leads)
      .where(and(eq(leads.id, leadId), eq(leads.tenantId, tenantId)))
      .limit(1);

    return record ?? null;
  }

  async listLeads(
    tenantId: string,
    filters: ListLeadsQueryDto,
    pbacScopeClause?: SQL,
    targetDb: Database = defaultDb,
  ): Promise<{ items: Lead[]; total: number; page: number; limit: number }> {
    const conditions: SQL[] = [eq(leads.tenantId, tenantId)];

    // Apply PBAC database-level scope clause if present
    if (pbacScopeClause) {
      conditions.push(pbacScopeClause);
    }

    if (filters?.status) {
      conditions.push(eq(leads.status, filters.status));
    }
    if (filters?.departmentId) {
      conditions.push(eq(leads.departmentId, filters.departmentId));
    }
    if (filters?.regionId) {
      conditions.push(eq(leads.regionId, filters.regionId));
    }
    if (filters?.assignedMemberId) {
      conditions.push(eq(leads.assignedMemberId, filters.assignedMemberId));
    }
    if (filters?.search) {
      const pattern = `%${filters.search.trim()}%`;
      conditions.push(
        or(ilike(leads.name, pattern), ilike(leads.email, pattern), ilike(leads.company, pattern))!,
      );
    }

    const whereClause = and(...conditions);
    const limit = filters?.limit ?? 20;
    const page = filters?.page ?? 1;
    const offset = (page - 1) * limit;

    const [countResult] = await targetDb
      .select({ count: sql<number>`count(*)::int` })
      .from(leads)
      .where(whereClause);

    const total = countResult?.count ?? 0;

    const items = await targetDb
      .select()
      .from(leads)
      .where(whereClause)
      .orderBy(desc(leads.createdAt))
      .limit(limit)
      .offset(offset);

    return {
      items: items ?? [],
      total,
      page,
      limit,
    };
  }

  async createLead(
    tenantId: string,
    data: CreateLeadDto,
    createdByUserId?: string,
    targetDb: Database = defaultDb,
  ): Promise<Lead> {
    const [created] = await targetDb
      .insert(leads)
      .values({
        tenantId,
        name: data.name,
        email: data.email,
        phone: data.phone,
        company: data.company,
        status: data.status,
        value: data.value,
        departmentId: data.departmentId,
        regionId: data.regionId,
        assignedMemberId: data.assignedMemberId,
        isConfidential: data.isConfidential,
        notes: data.notes,
        createdBy: createdByUserId,
        updatedBy: createdByUserId,
      })
      .returning();

    if (!created) {
      throw new Error('Failed to create lead');
    }

    return created;
  }

  async updateLead(
    tenantId: string,
    leadId: string,
    data: UpdateLeadDto,
    updatedByUserId?: string,
    targetDb: Database = defaultDb,
  ): Promise<Lead | null> {
    const updateValues: Record<string, unknown> = {
      updatedBy: updatedByUserId,
      updatedAt: new Date(),
    };

    if (data.name !== undefined) updateValues.name = data.name;
    if (data.email !== undefined) updateValues.email = data.email;
    if (data.phone !== undefined) updateValues.phone = data.phone;
    if (data.company !== undefined) updateValues.company = data.company;
    if (data.status !== undefined) updateValues.status = data.status;
    if (data.value !== undefined) updateValues.value = data.value;
    if (data.departmentId !== undefined) updateValues.departmentId = data.departmentId;
    if (data.regionId !== undefined) updateValues.regionId = data.regionId;
    if (data.assignedMemberId !== undefined) updateValues.assignedMemberId = data.assignedMemberId;
    if (data.isConfidential !== undefined) updateValues.isConfidential = data.isConfidential;
    if (data.notes !== undefined) updateValues.notes = data.notes;

    const [updated] = await targetDb
      .update(leads)
      .set(updateValues)
      .where(and(eq(leads.id, leadId), eq(leads.tenantId, tenantId)))
      .returning();

    return updated ?? null;
  }

  async deleteLead(
    tenantId: string,
    leadId: string,
    targetDb: Database = defaultDb,
  ): Promise<boolean> {
    const [deleted] = await targetDb
      .delete(leads)
      .where(and(eq(leads.id, leadId), eq(leads.tenantId, tenantId)))
      .returning();

    return !!deleted;
  }
}

export const leadsRepo = new LeadsRepository();
