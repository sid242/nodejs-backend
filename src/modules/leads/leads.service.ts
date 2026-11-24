import { eq } from 'drizzle-orm';
import type { PgColumn } from 'drizzle-orm/pg-core';

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
    isSupportSession: boolean = false,
    supportSessionScope?: string,
    targetDb?: Database,
  ): Promise<{ items: Lead[]; total: number; page: number; limit: number }> {
    let pbacScopeClause = undefined;

    // Apply fine-grained PBAC scope compilation for non-owner actors
    if (!isOwnerOrSupport) {
      // Default deny for non-owner actors without roles or context
      if (!actorContext || !roleIds || roleIds.length === 0) {
        return {
          items: [],
          total: 0,
          page: filters?.page ?? 1,
          limit: filters?.limit ?? 20,
        };
      }

      const compiledScope = await pbacService.compileQueryScope(
        tenantId,
        roleIds,
        'leads',
        'read',
        leads as unknown as Record<string, PgColumn>,
        actorContext,
      );

      // If actor has unconditional deny or no allows match
      if (
        compiledScope.hasDenyAll ||
        (!compiledScope.hasUnconditionalAllow && !compiledScope.sqlClause)
      ) {
        return {
          items: [],
          total: 0,
          page: filters?.page ?? 1,
          limit: filters?.limit ?? 20,
        };
      }

      pbacScopeClause = compiledScope.sqlClause;
    } else if (isSupportSession && supportSessionScope !== 'FULL_ADMIN') {
      // Support sessions without FULL_ADMIN cannot view confidential leads
      pbacScopeClause = eq(leads.isConfidential, false);
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
    actorContext?: ActorContext,
    roleIds?: string[],
    isOwnerOrSupport: boolean = false,
    targetDb?: Database,
  ): Promise<Lead> {
    const existing = await this.getLeadById(tenantId, leadId, targetDb);

    if (!isOwnerOrSupport && actorContext && roleIds) {
      // 1. Separate sensitive action checks
      const isReassigning =
        data.assignedMemberId !== undefined && data.assignedMemberId !== existing.assignedMemberId;
      const isChangingConfidential =
        data.isConfidential !== undefined && data.isConfidential !== existing.isConfidential;

      if (isReassigning) {
        const reassignEval = await pbacService.evaluateAccess(
          tenantId,
          roleIds,
          'leads',
          'reassign',
          {
            actor: actorContext,
            resource: existing as unknown as Record<string, unknown>,
            env: { currentTime: new Date() },
          },
        );
        if (!reassignEval.allowed) {
          throw AppError.forbidden('Access denied: not authorized to reassign lead', {
            action: 'leads:reassign',
          });
        }
      }

      if (isChangingConfidential) {
        const confEval = await pbacService.evaluateAccess(
          tenantId,
          roleIds,
          'leads',
          'set_confidential',
          {
            actor: actorContext,
            resource: existing as unknown as Record<string, unknown>,
            env: { currentTime: new Date() },
          },
        );
        if (!confEval.allowed) {
          throw AppError.forbidden(
            'Access denied: not authorized to change confidentiality of lead',
            {
              action: 'leads:set_confidential',
            },
          );
        }
      }

      // 2. Evaluate policy on merged proposed state (both existing and proposed must be allowed)
      const mergedProposed = {
        ...existing,
        ...data,
      };

      const proposedEval = await pbacService.evaluateAccess(tenantId, roleIds, 'leads', 'update', {
        actor: actorContext,
        resource: mergedProposed as unknown as Record<string, unknown>,
        env: { currentTime: new Date() },
      });

      if (!proposedEval.allowed) {
        throw AppError.forbidden('Access denied: proposed update violates workspace policy', {
          action: 'leads:update',
        });
      }
    }

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
