import bcrypt from 'bcryptjs';
import { eq, sql } from 'drizzle-orm';

import { closeDb, db } from '@/config/db.js';
import { logger } from '@/config/logger.js';
import { cacheRedis, closeRedisClients, redis } from '@/config/redis.js';
import {
  appModules,
  auditLogs,
  emailTemplates,
  platformAuditLogs,
  platformStaff,
  platformSupportSessions,
  tenantBrandings,
  tenantMemberRoles,
  tenantMembers,
  tenantModules,
  tenants,
  users,
} from '@/db/schema/index.js';
import { assignInitialSubscription, seedDefaultPlans } from '@/modules/plans/plans.service.js';
import * as platformRepo from '@/modules/platform/platform.repository.js';
import { seedPlatformDefaults } from '@/modules/platform/platform.service.js';
import { rbacRepo } from '@/modules/rbac/rbac.repository.js';
import { seedDefaultRbac } from '@/modules/rbac/rbac.service.js';

// Guard: Demo data must never run in production
if (process.env.NODE_ENV === 'production') {
  logger.error('CRITICAL: Refusing to seed demo credentials in production environment!');
  process.exit(1);
}

// ==========================================
// Demo Credentials Catalog (Exported for Documentation)
// Universal test password for all demo accounts: Password@123456
// ==========================================
export const DEMO_PASSWORD = 'Password@123456';

export const DEMO_CREDENTIALS = {
  platform: [
    {
      role: 'Super Administrator',
      roleKey: 'SUPER_ADMIN',
      email: 'sid.superadmin@yopmail.com',
      password: DEMO_PASSWORD,
      name: 'Siddharth SuperAdmin',
      url: '/platform/login',
    },
    {
      role: 'Customer Support Staff',
      roleKey: 'SUPPORT_STAFF',
      email: 'staff.support@yopmail.com',
      password: DEMO_PASSWORD,
      name: 'Support Staff',
      url: '/platform/login',
    },
    {
      role: 'Technical Operations Support',
      roleKey: 'TECHNICAL_SUPPORT',
      email: 'staff.techops@yopmail.com',
      password: DEMO_PASSWORD,
      name: 'TechOps Staff',
      url: '/platform/login',
    },
    {
      role: 'Billing & Finance Staff',
      roleKey: 'BILLING_STAFF',
      email: 'staff.billing@yopmail.com',
      password: DEMO_PASSWORD,
      name: 'Elena Billing',
      url: '/platform/login',
    },
    {
      role: 'Compliance & Security Auditor',
      roleKey: 'READ_ONLY_AUDITOR',
      email: 'staff.auditor@yopmail.com',
      password: DEMO_PASSWORD,
      name: 'Marcus Auditor',
      url: '/platform/login',
    },
  ],
  tenants: [
    {
      tenantName: 'Acme Realty Corp',
      tenantSlug: 'acme-realty',
      plan: 'PRO',
      databaseMode: 'shared',
      members: [
        {
          role: 'Tenant Owner',
          tenantRole: 'OWNER',
          email: 'owner@acme.com',
          password: DEMO_PASSWORD,
          name: 'Arthur Pendelton',
          url: '/login',
        },
        {
          role: 'Tenant Administrator',
          tenantRole: 'ADMIN',
          email: 'admin@acme.com',
          password: DEMO_PASSWORD,
          name: 'Beatrice Vance',
          url: '/login',
        },
        {
          role: 'Operations Manager',
          tenantRole: 'MANAGER',
          email: 'manager@acme.com',
          password: DEMO_PASSWORD,
          name: 'Charles Montgomery',
          url: '/login',
        },
        {
          role: 'Real Estate Agent',
          tenantRole: 'MEMBER',
          email: 'agent@acme.com',
          password: DEMO_PASSWORD,
          name: 'Diana Prince',
          url: '/login',
        },
        {
          role: 'Client / Auditor Viewer',
          tenantRole: 'VIEWER',
          email: 'viewer@acme.com',
          password: DEMO_PASSWORD,
          name: 'Edward Nygma',
          url: '/login',
        },
      ],
    },
    {
      tenantName: 'Nexus Estates Global',
      tenantSlug: 'nexus-estates',
      plan: 'ENTERPRISE',
      databaseMode: 'dedicated',
      members: [
        {
          role: 'Tenant Owner',
          tenantRole: 'OWNER',
          email: 'owner@nexus.com',
          password: DEMO_PASSWORD,
          name: 'Fiona Gallagher',
          url: '/login',
        },
        {
          role: 'Tenant Administrator',
          tenantRole: 'ADMIN',
          email: 'admin@nexus.com',
          password: DEMO_PASSWORD,
          name: 'George Clark',
          url: '/login',
        },
        {
          role: 'Senior Portfolio Manager',
          tenantRole: 'MANAGER',
          email: 'manager@nexus.com',
          password: DEMO_PASSWORD,
          name: 'Hannah Abbott',
          url: '/login',
        },
        {
          role: 'Commercial Broker',
          tenantRole: 'MEMBER',
          email: 'agent@nexus.com',
          password: DEMO_PASSWORD,
          name: 'Ian Malcolm',
          url: '/login',
        },
        {
          role: 'Investor Analyst',
          tenantRole: 'VIEWER',
          email: 'viewer@nexus.com',
          password: DEMO_PASSWORD,
          name: 'Julia Roberts',
          url: '/login',
        },
      ],
    },
  ],
};

export async function seedDemo(): Promise<void> {
  logger.info('====================================================');
  logger.info('       Starting SaaS Foundation Demo Seeder         ');
  logger.info('====================================================');

  // ----------------------------------------------------
  // 0. Clean and Wipe Old Data (Cascade Truncate)
  // ----------------------------------------------------
  logger.info('0. Wiping existing demo users, staff, and customer tenants...');
  await db.execute(sql`
    TRUNCATE TABLE 
      "PlatformSupportSession",
      "PlatformAuditLog",
      "PlatformUserGroupMember",
      "PlatformUserGroupRole",
      "PlatformUserGroup",
      "PlatformStaff",
      "Session",
      "VerificationToken",
      "AuditLog",
      "EmailTemplate",
      "File",
      "Subscription",
      "TenantMemberRole",
      "TenantMember",
      "TenantModule",
      "TenantBranding",
      "TenantEmailConfig",
      "Tenant",
      "User"
    CASCADE;
  `);

  try {
    await redis.flushdb();
    await cacheRedis.flushdb();
    logger.info('   ✔ Flushed state & cache Redis databases.');
  } catch {
    logger.warn('   ⚠ Could not flush Redis during seed (proceeding).');
  }
  logger.info('   ✔ Clean slate established.');

  // ----------------------------------------------------
  // 1. Seed Dynamic RBAC Permissions & System Roles
  // ----------------------------------------------------
  logger.info('1. Seeding customer tenant dynamic RBAC modules & roles...');
  await seedDefaultRbac();
  logger.info('   ✔ Customer tenant RBAC initialized.');

  // ----------------------------------------------------
  // 2. Seed Canonical Platform Permissions & System Roles
  // ----------------------------------------------------
  logger.info('2. Seeding platform canonical permissions & system roles...');
  await seedPlatformDefaults();
  logger.info('   ✔ Platform canonical catalogue initialized.');

  // ----------------------------------------------------
  // 3. Provision Platform Staff Accounts
  // ----------------------------------------------------
  logger.info('3. Provisioning platform staff accounts...');
  const staffIdMap = new Map<string, string>();

  for (const staffDef of DEMO_CREDENTIALS.platform) {
    const role = await platformRepo.findRoleByKey(staffDef.roleKey);
    if (!role) {
      logger.warn({ roleKey: staffDef.roleKey }, 'Platform role not found, skipping staff.');
      continue;
    }

    const existing = await platformRepo.findStaffByEmail(staffDef.email);
    const passwordHash = await bcrypt.hash(staffDef.password, 12);

    if (!existing) {
      const created = await platformRepo.createStaff({
        email: staffDef.email,
        displayName: staffDef.name,
        passwordHash,
        roleId: role.id,
        status: 'ACTIVE',
      });
      staffIdMap.set(staffDef.email, created.id);
      logger.info({ email: staffDef.email, role: staffDef.roleKey }, '   ✔ Created platform staff');
    } else {
      await db
        .update(platformStaff)
        .set({
          displayName: staffDef.name,
          passwordHash,
          roleId: role.id,
          status: 'ACTIVE',
        })
        .where(eq(platformStaff.id, existing.id));
      staffIdMap.set(staffDef.email, existing.id);
      logger.info(
        { email: staffDef.email, role: staffDef.roleKey },
        '   ✔ Synchronized platform staff',
      );
    }
  }

  // Provision superadmin into global users table as standard USER (no global ADMIN role)
  const superAdminEmail = 'sid.superadmin@yopmail.com';
  const [existingPlatformAdminUser] = await db
    .select()
    .from(users)
    .where(eq(users.email, superAdminEmail))
    .limit(1);
  const adminPasswordHash = await bcrypt.hash(DEMO_PASSWORD, 12);

  if (!existingPlatformAdminUser) {
    await db.insert(users).values({
      email: superAdminEmail,
      passwordHash: adminPasswordHash,
      name: 'Siddharth SuperAdmin',
      role: 'USER',
      status: 'ACTIVE',
      emailVerifiedAt: new Date(),
    });
    logger.info('   ✔ Provisioned user account for demo platform operator (role: USER).');
  } else {
    await db
      .update(users)
      .set({
        passwordHash: adminPasswordHash,
        status: 'ACTIVE',
        role: 'USER',
        emailVerifiedAt: existingPlatformAdminUser.emailVerifiedAt ?? new Date(),
      })
      .where(eq(users.id, existingPlatformAdminUser.id));
    logger.info('   ✔ Synchronized user account for demo platform operator.');
  }

  // ----------------------------------------------------
  // 4. Provision Customer Users & Tenants
  // ----------------------------------------------------
  logger.info('4. Provisioning customer organizations and memberships...');
  const allModules = await db.select({ id: appModules.id }).from(appModules);
  const systemRoles = await rbacRepo.findRolesByTenant(null);

  const tenantIdMap = new Map<string, string>();
  const userIdMap = new Map<string, string>();

  for (const tenantDef of DEMO_CREDENTIALS.tenants) {
    // 4a. Find or create tenant
    let [tenantRecord] = await db
      .select()
      .from(tenants)
      .where(eq(tenants.slug, tenantDef.tenantSlug))
      .limit(1);

    if (!tenantRecord) {
      const [created] = await db
        .insert(tenants)
        .values({
          name: tenantDef.tenantName,
          slug: tenantDef.tenantSlug,
          plan: tenantDef.plan,
          status: 'ACTIVE',
          databaseMode: tenantDef.databaseMode,
          databaseKey:
            tenantDef.databaseMode === 'dedicated'
              ? `dedicated-${tenantDef.tenantSlug}`
              : 'primary',
        })
        .returning();
      tenantRecord = created!;
      logger.info({ slug: tenantDef.tenantSlug }, '   ✔ Created customer tenant');
    } else {
      logger.info({ slug: tenantDef.tenantSlug }, '   ℹ Customer tenant already exists');
    }
    tenantIdMap.set(tenantDef.tenantSlug, tenantRecord.id);

    // 4b. Enable all app modules for tenant
    if (allModules.length > 0) {
      await db
        .insert(tenantModules)
        .values(
          allModules.map((m) => ({
            tenantId: tenantRecord.id,
            moduleId: m.id,
            isEnabled: true,
          })),
        )
        .onConflictDoNothing();
    }

    // 4c. Set default branding
    await db
      .insert(tenantBrandings)
      .values({
        tenantId: tenantRecord.id,
        companyName: tenantDef.tenantName,
        primaryColor: tenantDef.tenantSlug === 'acme-realty' ? '#E11D48' : '#2563EB',
      })
      .onConflictDoNothing();

    // 4d. Provision users and member roles (no global ADMIN role - all role: USER)
    for (const memberDef of tenantDef.members) {
      let [userRecord] = await db
        .select()
        .from(users)
        .where(eq(users.email, memberDef.email))
        .limit(1);

      const passwordHash = await bcrypt.hash(memberDef.password, 12);

      if (!userRecord) {
        const [createdUser] = await db
          .insert(users)
          .values({
            email: memberDef.email,
            passwordHash,
            name: memberDef.name,
            role: 'USER',
            status: 'ACTIVE',
            emailVerifiedAt: new Date(),
          })
          .returning();
        userRecord = createdUser!;
        logger.info({ email: memberDef.email }, '   ✔ Created customer user');
      } else {
        await db
          .update(users)
          .set({
            name: memberDef.name,
            passwordHash,
            status: 'ACTIVE',
            role: 'USER',
            emailVerifiedAt: userRecord.emailVerifiedAt ?? new Date(),
          })
          .where(eq(users.id, userRecord.id));
        logger.info({ email: memberDef.email }, '   ✔ Synchronized customer user');
      }
      userIdMap.set(memberDef.email, userRecord.id);

      // Add to tenant members
      let [memberRecord] = await db
        .select()
        .from(tenantMembers)
        .where(eq(tenantMembers.userId, userRecord.id))
        .limit(1);

      if (!memberRecord) {
        const [createdMember] = await db
          .insert(tenantMembers)
          .values({
            tenantId: tenantRecord.id,
            userId: userRecord.id,
            status: 'ACTIVE',
          })
          .returning();
        memberRecord = createdMember!;
      }

      // Assign tenant role (OWNER, ADMIN, MEMBER, VIEWER)
      const targetRole = systemRoles.find((r) => r.name === memberDef.tenantRole);
      if (targetRole && memberRecord) {
        await db
          .insert(tenantMemberRoles)
          .values({
            memberId: memberRecord.id,
            roleId: targetRole.id,
          })
          .onConflictDoNothing();
      }
    }
  }

  // ----------------------------------------------------
  // 5. Seed Active Support Delegation Session
  // ----------------------------------------------------
  logger.info('5. Seeding sample active audited support session...');
  const supportStaffId = staffIdMap.get('staff.support@yopmail.com');
  const acmeTenantId = tenantIdMap.get('acme-realty');

  if (supportStaffId && acmeTenantId) {
    const existingSession = await db
      .select()
      .from(platformSupportSessions)
      .where(eq(platformSupportSessions.tenantId, acmeTenantId))
      .limit(1);

    if (existingSession.length === 0) {
      await db.insert(platformSupportSessions).values({
        staffId: supportStaffId,
        tenantId: acmeTenantId,
        reason: 'TICKET-4892: Investigating customer report of PDF export timeout',
        status: 'ACTIVE',
        expiresAt: new Date(Date.now() + 2 * 60 * 60 * 1000), // 2 hours window
      });
      logger.info('   ✔ Active audited support session created for Acme Realty Corp.');
    } else {
      logger.info('   ℹ Support session already exists for Acme Realty Corp.');
    }
  }

  // ----------------------------------------------------
  // 6. Seed Platform Compliance Audit Trail
  // ----------------------------------------------------
  logger.info('6. Seeding platform compliance audit trail...');
  const superAdminId = staffIdMap.get('sid.superadmin@yopmail.com');

  if (superAdminId) {
    const existingLogs = await db.select().from(platformAuditLogs).limit(1);
    if (existingLogs.length === 0) {
      await db.insert(platformAuditLogs).values([
        {
          actorStaffId: superAdminId,
          action: 'platform_staff.created',
          targetType: 'staff',
          targetId: supportStaffId ?? null,
          metadata: { email: 'staff.support@yopmail.com', role: 'SUPPORT_STAFF' },
          ipAddress: '127.0.0.1',
          userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
        },
        {
          actorStaffId: superAdminId,
          action: 'platform_role.updated',
          targetType: 'role',
          targetId: 'TECHNICAL_SUPPORT',
          metadata: { changes: { permissions: ['system_health::read', 'tenant_support::start'] } },
          ipAddress: '127.0.0.1',
          userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
        },
        {
          actorStaffId: supportStaffId ?? superAdminId,
          action: 'tenant_support.started',
          targetType: 'tenant',
          targetId: acmeTenantId ?? null,
          tenantId: acmeTenantId ?? null,
          metadata: { ticket: 'TICKET-4892', durationMinutes: 120 },
          ipAddress: '192.168.1.42',
          userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)',
        },
        {
          actorStaffId: supportStaffId ?? superAdminId,
          action: 'platform_staff.login',
          targetType: 'staff',
          targetId: supportStaffId ?? null,
          metadata: { loginType: 'mfa_verified' },
          ipAddress: '192.168.1.42',
          userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)',
        },
      ]);
      logger.info('   ✔ Platform compliance audit records seeded.');
    }
  }

  // ----------------------------------------------------
  // 7. Seed Customer Tenant Audit Logs & Email Templates
  // ----------------------------------------------------
  logger.info('7. Seeding tenant activity and email templates...');
  const acmeOwnerId = userIdMap.get('owner@acme.com');

  if (acmeTenantId && acmeOwnerId) {
    // Audit logs for Acme
    const existingAudit = await db
      .select()
      .from(auditLogs)
      .where(eq(auditLogs.tenantId, acmeTenantId))
      .limit(1);
    if (existingAudit.length === 0) {
      await db.insert(auditLogs).values([
        {
          tenantId: acmeTenantId,
          userId: acmeOwnerId,
          action: 'TENANT.CREATED',
          entityType: 'tenant',
          entityId: acmeTenantId,
          metadata: { plan: 'PRO', name: 'Acme Realty Corp' },
          ipAddress: '127.0.0.1',
        },
        {
          tenantId: acmeTenantId,
          userId: acmeOwnerId,
          action: 'USER.LOGIN',
          entityType: 'user',
          entityId: acmeOwnerId,
          metadata: { authProvider: 'email_password' },
          ipAddress: '127.0.0.1',
        },
        {
          tenantId: acmeTenantId,
          userId: acmeOwnerId,
          action: 'SETTINGS.UPDATED',
          entityType: 'branding',
          entityId: acmeTenantId,
          metadata: { brandColor: '#E11D48' },
          ipAddress: '127.0.0.1',
        },
      ]);
      logger.info('   ✔ Customer tenant audit logs seeded.');
    }

    // Email templates for Acme
    const existingTemplates = await db
      .select()
      .from(emailTemplates)
      .where(eq(emailTemplates.tenantId, acmeTenantId))
      .limit(1);
    if (existingTemplates.length === 0) {
      const templatesToSeed = [
        {
          tenantId: acmeTenantId,
          name: 'Customer Welcome & Onboarding',
          slug: 'welcome-onboarding',
          subject: 'Welcome to {{companyName}}, {{userName}}!',
          category: 'TRANSACTIONAL' as const,
          status: 'PUBLISHED' as const,
          description: 'Automated email sent to new team members upon accepting an invitation.',
          htmlContent: `<!DOCTYPE html><html><body style="font-family: sans-serif; padding: 24px;"><h2>Welcome to {{companyName}}!</h2><p>Hi {{userName}},</p><p>Your workspace is ready. You can now access your dashboard, upload files, and collaborate with your team.</p><p><a href="{{dashboardUrl}}" style="background: #E11D48; color: white; padding: 10px 18px; border-radius: 6px; text-decoration: none;">Launch Dashboard</a></p></body></html>`,
          variables: ['companyName', 'userName', 'dashboardUrl'],
          createdById: acmeOwnerId,
        },
        {
          tenantId: acmeTenantId,
          name: 'Password Reset Notification',
          slug: 'password-reset-notice',
          subject: 'Reset your password for {{companyName}}',
          category: 'TRANSACTIONAL' as const,
          status: 'PUBLISHED' as const,
          description: 'Security notification containing a time-limited password reset link.',
          htmlContent: `<!DOCTYPE html><html><body style="font-family: sans-serif; padding: 24px;"><h2>Password Reset Request</h2><p>Hi {{userName}},</p><p>We received a request to reset your password. Click below to choose a new password within 15 minutes:</p><p><a href="{{resetUrl}}" style="background: #2563EB; color: white; padding: 10px 18px; border-radius: 6px; text-decoration: none;">Reset Password</a></p><p>If you didn't request this, please ignore this email.</p></body></html>`,
          variables: ['companyName', 'userName', 'resetUrl'],
          createdById: acmeOwnerId,
        },
        {
          tenantId: acmeTenantId,
          name: 'Monthly Activity Summary',
          slug: 'monthly-statement',
          subject: 'Your Monthly Report & Usage — {{monthName}}',
          category: 'NOTIFICATION' as const,
          status: 'PUBLISHED' as const,
          description:
            'Executive digest detailing workspace files, storage consumption, and active team members.',
          htmlContent: `<!DOCTYPE html><html><body style="font-family: sans-serif; padding: 24px;"><h2>Monthly Activity Digest</h2><p>Hi {{userName}},</p><p>Here is your summary for {{monthName}}:</p><ul><li>Total Files: {{fileCount}}</li><li>Active Members: {{memberCount}}</li><li>Storage Used: {{storageMb}} MB</li></ul></body></html>`,
          variables: [
            'companyName',
            'userName',
            'monthName',
            'fileCount',
            'memberCount',
            'storageMb',
          ],
          createdById: acmeOwnerId,
        },
      ];

      for (const tpl of templatesToSeed) {
        await db.insert(emailTemplates).values(tpl).onConflictDoNothing();
      }
      logger.info('   ✔ Customer tenant email templates seeded.');
    }

    // Seed default SaaS pricing plans and assign subscriptions
    await seedDefaultPlans();
    await assignInitialSubscription(acmeTenantId, 'GROWTH');
    const nexusTenantId = tenantIdMap.get('nexus-estates');
    if (nexusTenantId) {
      await assignInitialSubscription(nexusTenantId, 'ENTERPRISE');
    }
    logger.info('   ✔ SaaS plans, entitlements, and tenant subscriptions seeded.');
  }

  logger.info('====================================================');
  logger.info('       Demo Database Seeding Complete!              ');
  logger.info('====================================================');
}

// Auto-execute if invoked as a CLI script
if (process.argv[1]?.includes('demo') || process.argv[1]?.includes('seed')) {
  seedDemo()
    .then(async () => {
      await closeRedisClients();
      await closeDb();
      process.exit(0);
    })
    .catch(async (error) => {
      logger.error({ err: error }, 'Demo seeding failed');
      await closeRedisClients();
      await closeDb();
      process.exit(1);
    });
}
