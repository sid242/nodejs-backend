import { NextFunction, Request, Response } from 'express';

import { AppError } from '@/lib/errors';

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

      // Built-in OWNER role or active platform support sessions bypass fine-grained PBAC
      if (req.membership?.roles?.includes('OWNER') || req.isSupportSession) {
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
          throw AppError.forbidden('Access denied by workspace policy', {
            resource: options.resource,
            action: options.action,
            traces: result.traces,
          });
        }
      }

      return next();
    } catch (err) {
      return next(err);
    }
  };
}
