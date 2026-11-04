import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';

import { inArray } from 'drizzle-orm';

import { closeDb, db } from '@/config/db';
import { closeRedisClients } from '@/config/redis';
import { users } from '@/db/schema/index';
import * as accessService from '@/modules/audit/access.service';
import { redactSensitiveData } from '@/modules/audit/audit.redactor';
import * as auditService from '@/modules/audit/audit.service';
import * as authRepo from '@/modules/auth/auth.repository';
import * as billingRepo from '@/modules/billing/billing.repository';
import * as groupsService from '@/modules/groups/groups.service';
import * as rbacService from '@/modules/rbac/rbac.service';
import * as tenantsRepo from '@/modules/tenants/tenants.repository';

after(async () => {
  await Promise.allSettled([closeRedisClients(), closeDb()]);
  setTimeout(() => process.exit(0), 200).unref();
});

describe('Phase 09: Enterprise Audit Logging, Retention & Effective Access Simulator', () => {
  let freeTenant: any;
  let enterpriseTenant: any;
  let adminUser: any;
  let targetUser: any;
  let customRole: any;
  let devOpsGroup: any;
  let enterprisePlan: any;
  let freePlan: any;

  before(async () => {
    // 1. Ensure Plans
    freePlan = await billingRepo.findPlanByKey('FREE');
    if (!freePlan) {
      freePlan = await billingRepo.createPlan({
        name: 'Free Plan',
        key: 'FREE',
        limits: { maxMembers: 5, maxStorageBytes: 1024 * 1024 * 1024, maxCustomRoles: 0 },
        currency: 'USD',
        priceMonthlyMinor: 0,
        priceYearlyMinor: 0,
        isActive: true,
      });
    }

    enterprisePlan = await billingRepo.findPlanByKey('ENTERPRISE');
    if (!enterprisePlan) {
      enterprisePlan = await billingRepo.createPlan({
        name: 'Enterprise Plan',
        key: 'ENTERPRISE',
        limits: { maxMembers: 500, maxStorageBytes: 500 * 1024 * 1024 * 1024, maxCustomRoles: 50 },
        currency: 'USD',
        priceMonthlyMinor: 99900,
        priceYearlyMinor: 999000,
        isActive: true,
      });
    }

    // 2. Create Test Users
    const timestamp = Date.now();
    adminUser = await authRepo.createUser({
      email: `audit-admin-${timestamp}@example.com`,
      passwordHash: 'dummy_hash',
      name: 'Audit Administrator',
    });

    targetUser = await authRepo.createUser({
      email: `audit-target-${timestamp}@example.com`,
      passwordHash: 'dummy_hash',
      name: 'Audit Target Member',
    });

    // Ensure users have ACTIVE status in DB
    await db.update(users).set({ status: 'ACTIVE' }).where(inArray(users.id, [adminUser.id, targetUser.id]));

    // 3. Create Workspaces
    enterpriseTenant = await tenantsRepo.createTenant({
      name: `Enterprise Compliance Corp ${timestamp}`,
      slug: `enterprise-compliance-${timestamp}`,
      plan: 'ENTERPRISE',
      status: 'ACTIVE',
    });

    // Seed Enterprise Subscription
    await billingRepo.createSubscription({
      tenantId: enterpriseTenant.id,
      planId: enterprisePlan.id,
      status: 'ACTIVE',
      billingInterval: 'MONTHLY',
      currentPeriodStart: new Date(),
      currentPeriodEnd: new Date(Date.now() + 30 * 86400000),
    });

    freeTenant = await tenantsRepo.createTenant({
      name: `Free Workspace ${timestamp}`,
      slug: `free-workspace-${timestamp}`,
      plan: 'FREE',
      status: 'ACTIVE',
    });

    // 4. Add Memberships
    await tenantsRepo.addTenantMember({
      tenantId: enterpriseTenant.id,
      userId: adminUser.id,
      status: 'ACTIVE',
    });

    await tenantsRepo.addTenantMember({
      tenantId: enterpriseTenant.id,
      userId: targetUser.id,
      status: 'ACTIVE',
    });

    await tenantsRepo.addTenantMember({
      tenantId: freeTenant.id,
      userId: adminUser.id,
      status: 'ACTIVE',
    });

    // 5. Create Custom Role & Assign Permission
    customRole = await rbacService.createCustomTenantRole(enterpriseTenant.id, {
      name: `DevOps Engineer ${timestamp}`,
      code: `DEVOPS_${timestamp}`,
      description: 'Manages cloud files and audit inspection',
      permissions: ['files:read', 'files:write', 'audit:read'],
    });

    // 6. Create User Group and assign customRole to group
    devOpsGroup = await groupsService.createTenantGroup(enterpriseTenant.id, adminUser.id, {
      name: `DevOps Group ${timestamp}`,
      description: 'Engineering infrastructure team',
    });

    await groupsService.bindTenantGroupRole(enterpriseTenant.id, devOpsGroup.id, adminUser.id, {
      roleId: customRole.id,
    });

    // Add targetUser to devOpsGroup
    await groupsService.addTenantGroupMembers(enterpriseTenant.id, devOpsGroup.id, adminUser.id, {
      userIds: [targetUser.id],
    });
  });

  describe('1. Sensitive Data Redaction & Append-Only Safety', () => {
    it('redacts passwords, tokens, API keys, and secrets recursively', () => {
      const raw = {
        username: 'alice',
        password: 'SuperSecretPassword123!',
        nested: {
          apiKey: 'key_live_999999999',
          refreshToken: 'refresh_tok_123',
          safeConfig: 'enabled',
        },
        items: [
          { token: 'scim_token_abc', name: 'Okta' },
          { id: 1, publicLabel: 'visible' },
        ],
      };

      const sanitized = redactSensitiveData(raw);

      assert.strictEqual(sanitized.username, 'alice');
      assert.strictEqual(sanitized.password, '[REDACTED]');
      assert.strictEqual(sanitized.nested.apiKey, '[REDACTED]');
      assert.strictEqual(sanitized.nested.refreshToken, '[REDACTED]');
      assert.strictEqual(sanitized.nested.safeConfig, 'enabled');
      assert.strictEqual(sanitized.items[0]?.token, '[REDACTED]');
      assert.strictEqual(sanitized.items[0]?.name, 'Okta');
      assert.strictEqual(sanitized.items[1]?.publicLabel, 'visible');
    });

    it('records append-only audit event with server timestamp, dual actors, and sanitized diffs', async () => {
      await auditService.logSecurityEvent({
        tenantId: enterpriseTenant.id,
        actorUserId: adminUser.id,
        effectiveUserId: targetUser.id,
        action: 'member.role_assigned',
        source: 'DIRECT',
        result: 'SUCCESS',
        resourceType: 'TenantMember',
        resourceId: targetUser.id,
        requestId: 'req_test_12345',
        correlationId: 'corr_test_67890',
        metadataBefore: { role: 'VIEWER', secretToken: 'topsecret' },
        metadataAfter: { role: 'ADMIN', secretToken: 'newsecret' },
      });

      const trail = await auditService.getAuditTrail({
        tenantId: enterpriseTenant.id,
        action: 'member.role_assigned',
      });

      assert.ok(trail.items.length >= 1);
      const entry = trail.items[0]!;
      assert.strictEqual(entry.actorUserId, adminUser.id);
      assert.strictEqual(entry.effectiveUserId, targetUser.id);
      assert.strictEqual(entry.source, 'DIRECT');
      assert.strictEqual(entry.result, 'SUCCESS');
      assert.strictEqual(entry.requestId, 'req_test_12345');
      assert.strictEqual(entry.correlationId, 'corr_test_67890');
      assert.strictEqual((entry.metadataBefore as any)?.secretToken, '[REDACTED]');
      assert.strictEqual((entry.metadataAfter as any)?.secretToken, '[REDACTED]');
      assert.strictEqual((entry.metadataBefore as any)?.role, 'VIEWER');
      assert.strictEqual((entry.metadataAfter as any)?.role, 'ADMIN');
      assert.ok(entry.createdAt instanceof Date);
    });
  });

  describe('2. Retention Policies & Compliance Export', () => {
    it('returns default retention policy for tenant', async () => {
      const policy = await auditService.getTenantAuditPolicy(enterpriseTenant.id);
      assert.ok(policy.retentionDays >= 30);
      assert.strictEqual(policy.complianceFramework, 'SOC2');
    });

    it('allows updating retention policy within plan limits', async () => {
      const updated = await auditService.updateTenantAuditPolicy(enterpriseTenant.id, adminUser.id, {
        retentionDays: 180,
        complianceFramework: 'HIPAA',
      });

      assert.strictEqual(updated.retentionDays, 180);
      assert.strictEqual(updated.complianceFramework, 'HIPAA');
    });

    it('denies compliance export for FREE workspace (entitlement audit.export)', async () => {
      await assert.rejects(
        async () => {
          await auditService.exportAuditLogs(freeTenant.id, adminUser.id, {});
        },
        (err: any) => {
          assert.strictEqual(err.status, 403);
          return true;
        },
      );
    });

    it('generates CSV and JSON compliance export on ENTERPRISE workspace and records export audit log', async () => {
      // CSV export
      const csv = await auditService.exportAuditLogs(enterpriseTenant.id, adminUser.id, {}, 'csv');
      assert.strictEqual(csv.mimeType, 'text/csv; charset=utf-8');
      assert.ok(csv.content.includes('timestamp,id,tenantId,action,result,source'));
      assert.ok(csv.content.includes('member.role_assigned'));

      // JSON export
      const json = await auditService.exportAuditLogs(enterpriseTenant.id, adminUser.id, {}, 'json');
      assert.strictEqual(json.mimeType, 'application/json');
      const parsed = JSON.parse(json.content);
      assert.ok(Array.isArray(parsed));

      // Verify export event was itself audited
      const exportLogs = await auditService.getAuditTrail({
        tenantId: enterpriseTenant.id,
        action: 'audit.logs_exported',
      });
      assert.ok(exportLogs.items.length >= 1);
      assert.strictEqual(exportLogs.items[0]!.actorUserId, adminUser.id);
    });
  });

  describe('3. Effective Access Introspection & Provenance', () => {
    it('correctly attributes permissions inherited via User Groups vs Direct Roles', async () => {
      const access = await accessService.getEffectiveAccess(enterpriseTenant.id, targetUser.id);

      assert.strictEqual(access.isEffectiveActive, true);
      assert.strictEqual(access.overallDenialReason, null);

      // Verify DevOps Group is recognized
      const groupFound = access.groups.find((g) => g.id === devOpsGroup.id);
      assert.ok(groupFound, 'User should belong to DevOps Group');

      // Verify group-derived role is in effectiveRoles
      assert.ok(access.effectiveRoles.includes(customRole.name));

      // Verify effective permissions include customRole's permissions
      assert.ok(access.effectivePermissions.includes('files:read'));
      assert.ok(access.effectivePermissions.includes('audit:read'));

      // Verify provenance contains GROUP attribution
      const filesReadProv = access.permissionsProvenance.find((p) => p.key === 'files:read');
      assert.ok(filesReadProv);
      assert.strictEqual(filesReadProv.isAllowed, true);
      const groupSource = filesReadProv.sources.find((s) => s.source === 'GROUP');
      assert.ok(groupSource, 'Provenance source should indicate GROUP');
      assert.strictEqual(groupSource?.groupId, devOpsGroup.id);
    });

    it('explains overall denial reason when workspace membership is suspended', async () => {
      // Temporarily suspend targetUser's membership
      const members = await tenantsRepo.findTenantMembers(enterpriseTenant.id);
      const targetMember = members.find((m) => m.userId === targetUser.id);
      assert.ok(targetMember);

      await tenantsRepo.updateTenantMemberStatus(targetMember.id, 'SUSPENDED');

      const access = await accessService.getEffectiveAccess(enterpriseTenant.id, targetUser.id);
      assert.strictEqual(access.isEffectiveActive, false);
      assert.ok(access.overallDenialReason?.includes('SUSPENDED'));

      // Restore membership to ACTIVE
      await tenantsRepo.updateTenantMemberStatus(targetMember.id, 'ACTIVE');
    });
  });

  describe('4. Zero-Mutation Access Simulator', () => {
    it('simulates access and returns allowed=true with step-by-step trace and matching roles', async () => {
      const sim = await accessService.simulateAccess(enterpriseTenant.id, {
        userId: targetUser.id,
        permission: 'files:read',
      });

      assert.strictEqual(sim.allowed, true);
      assert.ok(sim.reason.includes('DevOps Engineer'));
      assert.ok(sim.evaluationTrace.length >= 5);
      assert.ok(sim.evaluationTrace.some((t) => t.includes('[DECISION: ALLOW]')));
      assert.ok(sim.matchedRoles.includes(customRole.name));
      assert.ok(sim.matchedGroups.includes(devOpsGroup.name));
    });

    it('simulates access for an ungranted permission and returns allowed=false with clean explanation', async () => {
      const sim = await accessService.simulateAccess(enterpriseTenant.id, {
        userId: targetUser.id,
        permission: 'tenants:delete',
      });

      assert.strictEqual(sim.allowed, false);
      assert.ok(sim.reason.includes('lacks permission'));
      assert.ok(sim.evaluationTrace.some((t) => t.includes('[DENY]')));
      assert.strictEqual(sim.matchedRoles.length, 0);
    });

    it('simulates access on suspended membership and returns allowed=false without mutating database', async () => {
      // Find member and suspend
      const members = await tenantsRepo.findTenantMembers(enterpriseTenant.id);
      const targetMember = members.find((m) => m.userId === targetUser.id)!;
      await tenantsRepo.updateTenantMemberStatus(targetMember.id, 'SUSPENDED');

      const sim = await accessService.simulateAccess(enterpriseTenant.id, {
        userId: targetUser.id,
        permission: 'files:read',
      });

      assert.strictEqual(sim.allowed, false);
      assert.ok(sim.reason.includes('SUSPENDED'));

      // Restore membership
      await tenantsRepo.updateTenantMemberStatus(targetMember.id, 'ACTIVE');
    });
  });
});
