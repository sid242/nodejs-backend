import { Database } from '@/config/db';
import { Lead, leads } from '@/db/schema/crm/leads';
import { AppError } from '@/lib/errors';
import { pbacService } from '@/modules/pbac/pbac.service';
import { ActorContext } from '@/modules/pbac/pbac.types';

import { CreateLeadDto, ListLeadsQueryDto, UpdateLeadDto } from './leads.dto';
import { leadsRepo } from './leads.repository';

export class LeadsService {
  async listLeads(
    tenantId: string,
    filters: ListLeadsQueryDto,
    actorContext?: ActorContext,
    roleIds?: string[],
    isOwnerOrSupport: boolean = false,
    targetDb?: Database,
  ): Promise<{ items: Lead[]; total: number; page: number; limit: number }> {
    let pbacScopeClause = undefined;

    // Apply fine-grained PBAC scope compilation for non-owner actors
    if (!isOwnerOrSupport && actorContext && roleIds && roleIds.length > 0) {
      const compiledScope = await pbacService.compileQueryScope(
        tenantId,
        roleIds,
        'leads',
        'read',
        leads as any,
        actorContext,
      );

      // If actor has unconditional deny or no allows match
      if (compiledScope.hasDenyAll) {
        return {
          items: [],
          total: 0,
          page: filters?.page ?? 1,
          limit: filters?.limit ?? 20,
        };
      }

      pbacScopeClause = compiledScope.sqlClause;
    }

    return leadsRepo.listLeads(tenantId, filters, pbacScopeClause, targetDb);
  }

  async getLeadById(tenantId: string, leadId: string, targetDb?: Database): Promise<Lead> {
    const lead = await leadsRepo.findLeadById(tenantId, leadId, targetDb);
    if (!lead) {
      throw AppError.notFound('Lead not found');
    }
    return lead;
  }

  async createLead(
    tenantId: string,
    data: CreateLeadDto,
    userId?: string,
    targetDb?: Database,
  ): Promise<Lead> {
    return leadsRepo.createLead(tenantId, data, userId, targetDb);
  }

  async updateLead(
    tenantId: string,
    leadId: string,
    data: UpdateLeadDto,
    userId?: string,
    targetDb?: Database,
  ): Promise<Lead> {
    await this.getLeadById(tenantId, leadId, targetDb);

    const updated = await leadsRepo.updateLead(tenantId, leadId, data, userId, targetDb);
    if (!updated) {
      throw AppError.notFound('Lead not found');
    }
    return updated;
  }

  async deleteLead(tenantId: string, leadId: string, targetDb?: Database): Promise<void> {
    await this.getLeadById(tenantId, leadId, targetDb);

    const deleted = await leadsRepo.deleteLead(tenantId, leadId, targetDb);
    if (!deleted) {
      throw AppError.notFound('Lead not found');
    }
  }
}

export const leadsService = new LeadsService();
