import { NextFunction, Request, Response } from 'express';

import { logger } from '@/config/logger';
import { AppError } from '@/lib/errors';
import * as platformRepo from '@/modules/platform/platform.repository';

import { pbacService } from './pbac.service';
import { ActorContext, PolicyEvaluationContext } from './pbac.types';

export interface RequirePolicyOptions {
  resource: string;
  action: string;
  getTargetResource?: (
    req: Request,
  ) => Promise<Record<string, unknown> | null> | Record<string, unknown> | null;
}

/**
 * Express middleware that enforces Policy-Based Access Control (PBAC).
 *
 * For single-record operations (read by ID, update, delete):
 *   Pass `getTargetResource: (req) => fetchResource(req.params.id)` to evaluate
 *   record-level conditions (e.g. `resource.assignedMemberId == actor.memberId`).
 *
 * For multi-record operations (list queries):
 *   Omit `getTargetResource`. The middleware populates `req.actorContext`. The controller/service
 *   then compiles a SQL WHERE clause via `pbacService.compileQueryScope(...)` for database-level scoping.
 */
export function requirePolicy(options: RequirePolicyOptions) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!req.tenant) {
        throw AppError.unauthorized('Tenant context is required for policy evaluation');
      }

      // Built-in OWNER role bypasses fine-grained PBAC
      if (req.membership?.roles?.includes('OWNER')) {
        return next();
      }

      // Platform support sessions: require FULL_ADMIN for confidential records and write audit log
      if (req.isSupportSession) {
        if (options.getTargetResource) {
          const targetResource = await options.getTargetResource(req);
          if (
            targetResource &&
            Boolean((targetResource as Record<string, unknown>).isConfidential)
          ) {
            if (req.supportSession?.scope !== 'FULL_ADMIN') {
              throw AppError.forbidden(
                'Confidential records cannot be accessed via standard support sessions',
              );
            }
          }
        }

        // Log support session access for audit trail
        await platformRepo
          .logPlatformAction({
            actorStaffId: req.supportSession?.staffId ?? req.staff?.id ?? 'support',
            action: `support.${options.resource}.${options.action}`,
            targetType: options.resource,
            tenantId: req.tenant.id,
            supportSessionId: req.supportSession?.id,
            metadata: {
              resource: options.resource,
              action: options.action,
              reason: req.supportSession?.reason,
            },
          })
          .catch(() => {});

        return next();
      }

      const actorContext: ActorContext = {
        userId: req.user?.id ?? '',
        memberId: req.membership?.id,
        roleKeys: req.membership?.roles ?? [],
        departmentId: req.membership?.departmentId ?? null,
        regionId: req.membership?.regionId ?? null,
      };

      req.actorContext = actorContext;

      if (options.getTargetResource) {
        const targetResource = await options.getTargetResource(req);
        if (!targetResource) {
          throw AppError.notFound(`${options.resource} not found`);
        }

        const evalContext: PolicyEvaluationContext = {
          actor: actorContext,
          resource: targetResource,
          env: {
            currentTime: new Date(),
            ip: req.ip,
          },
        };

        const result = await pbacService.evaluateAccess(
          req.tenant.id,
          req.membership?.roleIds ?? [],
          options.resource,
          options.action,
          evalContext,
        );

        if (!result.allowed) {
          logger.warn(
            {
              tenantId: req.tenant.id,
              userId: req.user?.id,
              memberId: actorContext.memberId,
              resource: options.resource,
              action: options.action,
              traces: result.traces,
              requestId: (req as unknown as { id?: string }).id,
            },
            'PBAC access denied by policy',
          );

          // Never leak policy traces or internal rules to clients
          throw AppError.forbidden('Access denied by workspace policy');
        }
      }

      return next();
    } catch (err) {
      return next(err);
    }
  };
}
