import crypto from 'node:crypto';
import { sql } from 'drizzle-orm';
import type { NextFunction, Request, Response } from 'express';

import type { Database } from '@/config/db';
import { env } from '@/config/env';
import { logger } from '@/config/logger';
import { redis } from '@/config/redis';
import { getLatestSchemaTag, isSchemaVersionCurrent } from '@/db/schema-version';
import { runWithTenantDb } from '@/db/tenancy/context';
import { getTenantDb } from '@/db/tenancy/tenant-db';
import { AppError } from '@/lib/errors';
import { resolveLocale } from '@/lib/i18n';
import { setRequestLocale } from '@/lib/request-context';
import { SUPPORT_SCOPE_PRESETS } from '@/middleware/support';
import * as platformRepo from '@/modules/platform/platform.repository';
import { resolveUserPermissions, SYSTEM_ROLES } from '@/modules/rbac/rbac.service';
import { ssoRepo } from '@/modules/sso/sso.repository';
import * as tenantsRepo from '@/modules/tenants/tenants.repository';
import * as usersRepo from '@/modules/users/users.repository';

export function isRlsPilotEnabled(
  tenant?: { databaseMode?: string; metadata?: any },
  req?: Request,
): boolean {
  const mode = tenant?.databaseMode ?? (req?.tenant as any)?.databaseMode;
  // Dedicated database mode is already isolated at the database instance level
  if (mode === 'dedicated') {
    return false;
  }

  // 1. Global toggle via environment variable
  if (env.RLS_ENFORCEMENT_PILOT) {
    return true;
  }

  // 2. Per-tenant metadata flag (canary rollout)
  const meta = tenant?.metadata ?? (req?.tenant as any)?.metadata;
  if (meta && typeof meta === 'object') {
    if (meta.enforceRls === true || meta.rlsPilot === true || meta.enableRlsTransaction === true) {
      return true;
    }
  }

  // 3. Request-level canary header (for pilot verification)
  const pilotHeader = req?.headers?.['x-rls-pilot'] || req?.headers?.['x-enforce-rls'];
  if (pilotHeader === 'true' || pilotHeader === '1') {
    return true;
  }

  return false;
}

function safeCompareSecrets(input: string, expected?: string): boolean {
  if (!expected || !input) return false;
  try {
    const hashA = crypto.createHash('sha256').update(input).digest();
    const hashB = crypto.createHash('sha256').update(expected).digest();
    return crypto.timingSafeEqual(hashA, hashB);
  } catch {
    return false;
  }
}

export function hasValidBffSecret(req: Request): boolean {
  const secretHeader = req.headers?.['x-bff-secret'];
  const raw = Array.isArray(secretHeader) ? secretHeader[0] : secretHeader;
  if (!raw || typeof raw !== 'string') return false;

  // Accept active secret or previous secret during key rollover
  if (safeCompareSecrets(raw, env.BFF_SHARED_SECRET)) {
    return true;
  }

  if (env.BFF_SHARED_SECRET_PREVIOUS && safeCompareSecrets(raw, env.BFF_SHARED_SECRET_PREVIOUS)) {
    return true;
  }

  return false;
}

export async function resolveTenantContext(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  if (req.isSupportSession && req.tenant) {
    return next();
  }

  if (!req.user && !req.staff) {
    return next();
  }

  // 1. Identify tenant from accepted sources in strict order:
  // (a) x-tenant-id ONLY when carrying valid x-bff-secret header
  // (b) route param :tenantId
  // (c) token claim / single-tenant auto-fallback
  let tenantIdentifier: string | undefined;

  const rawHeader = req.headers?.['x-tenant-id'];
  const headerTenantId = Array.isArray(rawHeader) ? rawHeader[0] : rawHeader;

  if (headerTenantId && hasValidBffSecret(req)) {
    tenantIdentifier = headerTenantId;
  }

  if (!tenantIdentifier && typeof req.params?.tenantId === 'string') {
    tenantIdentifier = req.params.tenantId;
  }

  if (!tenantIdentifier && (req.user as any)?.tenantId) {
    tenantIdentifier = (req.user as any).tenantId;
  }

  // If omitted and user is authenticated, auto-resolve if user has exactly one active tenant
  if (!tenantIdentifier && req.user?.id) {
    try {
      const userTenants = await tenantsRepo.findUserTenants(req.user.id);
      if (userTenants?.length === 1 && userTenants?.[0]?.id) {
        tenantIdentifier = userTenants[0].id;
      }
    } catch {
      /* ignore lookup failure */
    }
  }

  if (!tenantIdentifier) {
    return next();
  }

  try {
    // 2. Fetch tenant by UUID or by slug
    let tenant = await tenantsRepo.findTenantById(tenantIdentifier);
    if (!tenant) {
      tenant = await tenantsRepo.findTenantBySlug(tenantIdentifier);
    }

    if (!tenant || tenant.deletedAt) {
      return next(AppError.notFound('Tenant organization not found'));
    }

    if (tenant.status !== 'ACTIVE' && tenant.status !== 'TRIALING') {
      return next(AppError.forbidden(`Tenant is currently ${tenant.status.toLowerCase()}`));
    }

    // Maintenance window check: during database switchover / migrations, block mutation writes
    const isMaintenance = await redis.get(`tenant:${tenant.id}:maintenance`);
    if (isMaintenance && !['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
      return next(
        AppError.serviceUnavailable(
          'Tenant organization is undergoing database maintenance. Write operations are temporarily disabled.',
          { code: 'TENANT_MAINTENANCE', retryAfter: 30 },
        ),
      );
    }

    // Schema version check for dedicated database tenants
    if (tenant.databaseMode === 'dedicated' && !isSchemaVersionCurrent(tenant.schemaVersion)) {
      logger.error(
        {
          tenantId: tenant.id,
          tenantSchemaVersion: tenant.schemaVersion,
          latestSchemaTag: getLatestSchemaTag(),
        },
        'Dedicated tenant database is outdated and requires schema migration',
      );
      return next(
        AppError.serviceUnavailable(
          'Tenant database is running on an outdated schema and requires platform migration.',
          {
            code: 'TENANT_DB_OUTDATED',
            requiredVersion: getLatestSchemaTag(),
            currentVersion: tenant.schemaVersion,
          },
        ),
      );
    }

    // 3. Check for an active, audited support delegation session
    // Strict caller binding: only honor support session if caller is authenticated as platform staff
    // and the support session belongs to that specific staff member.
    const supportSessionHeader = req.headers['x-support-session-id'];
    const supportSessionId = Array.isArray(supportSessionHeader)
      ? supportSessionHeader[0]
      : supportSessionHeader;

    let activeSupportSession = null;
    if (supportSessionId && req.staff?.id) {
      const session = await platformRepo.findSupportSessionById(supportSessionId);
      if (
        session &&
        session.status === 'ACTIVE' &&
        session.tenantId === tenant.id &&
        session.staffId === req.staff.id &&
        new Date(session.expiresAt) > new Date()
      ) {
        activeSupportSession = session;
        req.supportSession = {
          id: session.id,
          sessionId: session.id,
          staffId: session.staffId,
          tenantId: session.tenantId,
          mode: session.mode as any,
          scope: session.scope as any,
          targetUserId: session.targetUserId,
          targetMemberId: session.targetMemberId,
          reason: session.reason,
          expiresAt: session.expiresAt,
        };
        req.isImpersonated = true;

        if (session.targetUserId) {
          const targetUser = await usersRepo.findById(session.targetUserId);
          if (targetUser) {
            req.impersonator = {
              userId: req.user?.id ?? req.staff?.id ?? session.staffId,
              role: 'SUPPORT_STAFF',
              reason: session.reason,
              sessionId: session.id,
            };
            req.user = {
              id: targetUser.id,
              status: targetUser.status,
            };
          }
        }
      }
    }

    // 4. Verify user membership in tenant (Strict isolation: no blanket platform staff bypass)
    let member = null;
    if (req.user?.id) {
      member = await tenantsRepo.findTenantMember(tenant.id, req.user.id);
    }

    if (!member && !activeSupportSession) {
      return next(
        AppError.forbidden(
          'You are not a member of this tenant. Support staff require an active, audited support session.',
        ),
      );
    }

    if (member && member.status !== 'ACTIVE') {
      return next(
        AppError.forbidden(`Your membership in this tenant is ${member.status.toLowerCase()}`),
      );
    }

    // 4b. Mandatory SSO enforcement check for existing user sessions
    if (member && req.user?.id) {
      const ssoConfig = await ssoRepo.findConfigByTenantId(tenant.id);
      if (ssoConfig?.status === 'ACTIVE' && ssoConfig?.enforceSso) {
        const resolved = await resolveUserPermissions(tenant.id, req.user.id);
        const isOwner = resolved.roles.some((r) => r.toUpperCase() === SYSTEM_ROLES.OWNER);

        if (member.ssoBypass && isOwner) {
          // Break-glass owner allowed
        } else {
          const enforcedAt = ssoConfig.updatedAt ? new Date(ssoConfig.updatedAt).getTime() : 0;
          const now = Date.now();
          const isPastGracePeriod = now - enforcedAt > 24 * 60 * 60 * 1000;
          const tokenIat = (req.tokenIat ?? 0) * 1000;
          const authMethod = req.authMethod || req.user?.authMethod || 'PASSWORD';

          if (authMethod === 'PASSWORD' || (tokenIat > 0 && tokenIat < enforcedAt)) {
            if (isPastGracePeriod) {
              return next(
                new AppError(
                  403,
                  'Single Sign-On is required for this workspace. Please re-authenticate via SSO.',
                  'SSO_REQUIRED',
                  {
                    ssoRequired: true,
                    ssoLoginUrl: `/api/v1/auth/sso/initiate?tenantId=${tenant.id}`,
                    tenantId: tenant.id,
                    tenantSlug: tenant.slug,
                  },
                ),
              );
            }
          }
        }
      }
    }

    // 5. Resolve permissions
    let effectivePermissions: string[] = [];
    let roles: string[] = [];
    let roleIds: string[] = [];
    let groupIds: string[] = [];
    let groupSlugs: string[] = [];

    if (activeSupportSession) {
      // Under audited support delegation, staff access is granted with specific support scope
      roles = ['SUPPORT_STAFF'];
      roleIds = [];
      const scopeKey =
        (activeSupportSession.scope as keyof typeof SUPPORT_SCOPE_PRESETS) || 'READ_ONLY';
      const preset = SUPPORT_SCOPE_PRESETS[scopeKey] ?? SUPPORT_SCOPE_PRESETS.READ_ONLY;
      effectivePermissions = [...preset];
    } else if (member && req.user?.id) {
      const resolved = await resolveUserPermissions(tenant.id, req.user.id);
      roles = resolved.roles;
      roleIds = resolved.roleIds ?? [];
      groupIds = resolved.groupIds ?? [];
      groupSlugs = resolved.groupSlugs ?? [];
      effectivePermissions = roles.includes(SYSTEM_ROLES.OWNER) ? ['*'] : resolved.permissions;
    }

    req.tenant = {
      id: tenant.id,
      name: tenant.name,
      slug: tenant.slug,
      status: tenant.status,
      plan: tenant.plan,
      databaseMode: (tenant as any).databaseMode ?? 'shared',
      metadata: (tenant as any).metadata,
    };

    req.db = await getTenantDb({
      id: tenant.id,
      databaseMode: (tenant as any).databaseMode ?? 'shared',
      databaseKey: (tenant as any).databaseKey,
      databaseSecretRef: (tenant as any).databaseSecretRef,
      metadata: (tenant as any).metadata,
    });

    if (member) {
      req.membership = {
        id: member.id,
        status: member.status,
        roles,
        roleIds,
        groupIds,
        groupSlugs,
        departmentId: member.departmentId ?? member.department ?? null,
        regionId: member.regionId ?? member.location ?? null,
      };
    }

    req.permissions = effectivePermissions;

    const resolvedLocale = resolveLocale({
      header: (req.headers['x-locale'] as string | undefined) || undefined,
      userLocale: (req.user as { locale?: string } | undefined)?.locale,
      tenantLocale: (tenant as { locale?: string } | undefined)?.locale,
      acceptLanguage: (req.headers['accept-language'] as string | undefined) || undefined,
    });
    setRequestLocale(resolvedLocale);

    if (isRlsPilotEnabled(req.tenant, req)) {
      return req.db
        .transaction(async (tx) => {
          await tx.execute(sql`SET LOCAL ROLE tenant_app_role`);
          await tx.execute(sql`SELECT set_config('app.tenant_id', ${tenant.id}, true)`);

          return new Promise<void>((resolve, reject) => {
            let settled = false;
            const done = () => {
              if (!settled) {
                settled = true;
                resolve();
              }
            };

            if (typeof res?.once === 'function') {
              res.once('finish', done);
              res.once('close', done);
              res.once('error', (err) => {
                if (!settled) {
                  settled = true;
                  reject(err);
                }
              });
            }

            runWithTenantDb(
              {
                tenantId: tenant.id,
                db: tx as unknown as Database,
                tx,
                databaseMode: req.tenant?.databaseMode ?? 'shared',
              },
              () => {
                next();
                if (typeof res?.once !== 'function') {
                  done();
                }
              },
            );
          });
        })
        .catch((err) => {
          if (!res.headersSent) {
            next(err);
          } else {
            logger.error({ err, tenantId: tenant.id }, 'Error in RLS pilot transaction');
          }
        });
    }

    return runWithTenantDb(
      {
        tenantId: tenant.id,
        db: req.db,
        databaseMode: (tenant as any).databaseMode ?? 'shared',
      },
      () => next(),
    );
  } catch (error) {
    next(error);
  }
}

export async function requireTenant(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  if (req.isSupportSession && req.tenant) {
    const requested = req.params?.tenantId;
    if (requested && requested !== req.tenant.id && requested !== req.tenant.slug) {
      return next(AppError.forbidden('Support session is scoped to another workspace'));
    }
    if (!req.db) {
      req.db = await getTenantDb({
        id: req.tenant.id,
        databaseMode: req.tenant.databaseMode ?? 'shared',
      });
    }

    if (isRlsPilotEnabled(req.tenant, req)) {
      return req.db
        .transaction(async (tx) => {
          await tx.execute(sql`SET LOCAL ROLE tenant_app_role`);
          await tx.execute(sql`SELECT set_config('app.tenant_id', ${req.tenant!.id}, true)`);

          return new Promise<void>((resolve, reject) => {
            let settled = false;
            const done = () => {
              if (!settled) {
                settled = true;
                resolve();
              }
            };

            if (typeof res?.once === 'function') {
              res.once('finish', done);
              res.once('close', done);
              res.once('error', (err) => {
                if (!settled) {
                  settled = true;
                  reject(err);
                }
              });
            }

            runWithTenantDb(
              {
                tenantId: req.tenant!.id,
                db: tx as unknown as Database,
                tx,
                databaseMode: req.tenant?.databaseMode ?? 'shared',
              },
              () => {
                next();
                if (typeof res?.once !== 'function') {
                  done();
                }
              },
            );
          });
        })
        .catch((err) => {
          if (!res.headersSent) {
            next(err);
          } else {
            logger.error({ err, tenantId: req.tenant?.id }, 'Error in RLS pilot transaction');
          }
        });
    }

    return runWithTenantDb(
      {
        tenantId: req.tenant.id,
        db: req.db,
        databaseMode: req.tenant.databaseMode ?? 'shared',
      },
      () => next(),
    );
  }

  if (!req.user && !req.staff && !req.isSupportSession) {
    return next(AppError.unauthorized('Authentication required to access tenant resources'));
  }

  await resolveTenantContext(req, res, (err) => {
    if (err) return next(err);
    if (!req.tenant) {
      return next(
        new AppError(
          400,
          'Tenant identifier required (provide x-tenant-id header or tenantId parameter)',
          'TENANT_REQUIRED',
        ),
      );
    }
    next();
  });
}
