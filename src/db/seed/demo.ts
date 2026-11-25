import { pathToFileURL } from 'node:url';
import bcrypt from 'bcryptjs';
import { and, eq, isNull, sql } from 'drizzle-orm';

import { closeDb, db } from '@/config/db';
import { logger } from '@/config/logger';
import { cacheRedis, closeRedisClients, redis } from '@/config/redis';
import {
  appModules,
  auditLogs,
  emailTemplates,
  groupPolicies,
  platformAuditLogs,
  platformRolePolicies,
  platformRoles,
  platformStaff,
  platformSupportSessions,
  policies,
  rolePolicies,
  tenantBrandings,
  tenantMemberRoles,
  tenantMembers,
  tenantModules,
  tenants,
  userGroupMembers,
  userGroupPlatformRoles,
  userGroupRoles,
  userGroups,
  users,
} from '@/db/schema/index';
import { assignInitialSubscription, seedDefaultPlans } from '@/modules/billing/billing.service';
import * as platformRepo from '@/modules/platform/platform.repository';
import { seedPlatformDefaults } from '@/modules/platform/platform.service';
import { rbacRepo } from '@/modules/rbac/rbac.repository';
import { seedDefaultRbac } from '@/modules/rbac/rbac.service';

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
  // Super Admin + 5 Staff Users (Total 6 Platform Staff)
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
      role: 'Customer Support Lead',
      roleKey: 'SUPPORT_STAFF',
      email: 'staff.support@yopmail.com',
      password: DEMO_PASSWORD,
      name: 'Support Staff Lead',
      url: '/platform/login',
    },
    {
      role: 'Customer Operations Specialist',
      roleKey: 'SUPPORT_STAFF',
      email: 'staff.operations@yopmail.com',
      password: DEMO_PASSWORD,
      name: 'Sarah Operations',
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
  // 6 Tenants with 5 Members each
  tenants: [
    {
      tenantName: 'Acme Realty Corp',
      tenantSlug: 'acme-realty',
      plan: 'PRO',
      databaseMode: 'shared',
      primaryColor: '#E11D48',
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
          role: 'Operations Lead',
          tenantRole: 'MEMBER',
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
          role: 'Auditor Viewer',
          tenantRole: 'VIEWER',
          email: 'viewer@acme.com',
          password: DEMO_PASSWORD,
          name: 'Edward Nygma',
          url: '/login',
        },
      ],
    },
    {
      tenantName: 'Nexus Global Technologies',
      tenantSlug: 'nexus-global',
      plan: 'ENTERPRISE',
      databaseMode: 'shared',
      primaryColor: '#2563EB',
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
          role: 'Solutions Architect',
          tenantRole: 'MEMBER',
          email: 'manager@nexus.com',
          password: DEMO_PASSWORD,
          name: 'Hannah Abbott',
          url: '/login',
        },
        {
          role: 'Cloud Engineer',
          tenantRole: 'MEMBER',
          email: 'engineer@nexus.com',
          password: DEMO_PASSWORD,
          name: 'Ian Malcolm',
          url: '/login',
        },
        {
          role: 'Enterprise Analyst',
          tenantRole: 'VIEWER',
          email: 'viewer@nexus.com',
          password: DEMO_PASSWORD,
          name: 'Julia Roberts',
          url: '/login',
        },
      ],
    },
    {
      tenantName: 'Apex Dynamics',
      tenantSlug: 'apex-dynamics',
      plan: 'FREE',
      databaseMode: 'shared',
      primaryColor: '#059669',
      members: [
        {
          role: 'Tenant Owner',
          tenantRole: 'OWNER',
          email: 'owner@apex.com',
          password: DEMO_PASSWORD,
          name: 'David Martinez',
          url: '/login',
        },
        {
          role: 'Tenant Administrator',
          tenantRole: 'ADMIN',
          email: 'admin@apex.com',
          password: DEMO_PASSWORD,
          name: 'Sarah Connor',
          url: '/login',
        },
        {
          role: 'Robotics Project Manager',
          tenantRole: 'MEMBER',
          email: 'manager@apex.com',
          password: DEMO_PASSWORD,
          name: 'Alex Murphy',
          url: '/login',
        },
        {
          role: 'Field Engineer',
          tenantRole: 'MEMBER',
          email: 'engineer@apex.com',
          password: DEMO_PASSWORD,
          name: 'Ellen Ripley',
          url: '/login',
        },
        {
          role: 'Research Observer',
          tenantRole: 'VIEWER',
          email: 'viewer@apex.com',
          password: DEMO_PASSWORD,
          name: 'Thomas Anderson',
          url: '/login',
        },
      ],
    },
    {
      tenantName: 'Starlight Ventures',
      tenantSlug: 'starlight-ventures',
      plan: 'PRO',
      databaseMode: 'shared',
      primaryColor: '#7C3AED',
      members: [
        {
          role: 'Tenant Owner',
          tenantRole: 'OWNER',
          email: 'owner@starlight.com',
          password: DEMO_PASSWORD,
          name: 'Stella Nova',
          url: '/login',
        },
        {
          role: 'Tenant Administrator',
          tenantRole: 'ADMIN',
          email: 'admin@starlight.com',
          password: DEMO_PASSWORD,
          name: 'Leo Sterling',
          url: '/login',
        },
        {
          role: 'Portfolio Manager',
          tenantRole: 'MEMBER',
          email: 'manager@starlight.com',
          password: DEMO_PASSWORD,
          name: 'Maya Lin',
          url: '/login',
        },
        {
          role: 'Investment Analyst',
          tenantRole: 'MEMBER',
          email: 'analyst@starlight.com',
          password: DEMO_PASSWORD,
          name: 'Jonah Hex',
          url: '/login',
        },
        {
          role: 'Limited Partner Auditor',
          tenantRole: 'VIEWER',
          email: 'viewer@starlight.com',
          password: DEMO_PASSWORD,
          name: 'Chloe Sullivan',
          url: '/login',
        },
      ],
    },
    {
      tenantName: 'Zenith Healthcare Labs',
      tenantSlug: 'zenith-health',
      plan: 'PRO',
      databaseMode: 'shared',
      primaryColor: '#0284C7',
      members: [
        {
          role: 'Tenant Owner',
          tenantRole: 'OWNER',
          email: 'owner@zenith.com',
          password: DEMO_PASSWORD,
          name: 'Dr. Victor Frankenstein',
          url: '/login',
        },
        {
          role: 'Tenant Administrator',
          tenantRole: 'ADMIN',
          email: 'admin@zenith.com',
          password: DEMO_PASSWORD,
          name: 'Dr. Beverly Crusher',
          url: '/login',
        },
        {
          role: 'Laboratory Director',
          tenantRole: 'MEMBER',
          email: 'manager@zenith.com',
          password: DEMO_PASSWORD,
          name: 'Dana Scully',
          url: '/login',
        },
        {
          role: 'Diagnostics Specialist',
          tenantRole: 'MEMBER',
          email: 'specialist@zenith.com',
          password: DEMO_PASSWORD,
          name: 'Gregory House',
          url: '/login',
        },
        {
          role: 'Compliance Observer',
          tenantRole: 'VIEWER',
          email: 'viewer@zenith.com',
          password: DEMO_PASSWORD,
          name: 'Leonard McCoy',
          url: '/login',
        },
      ],
    },
    {
      tenantName: 'Horizon Mediaworks',
      tenantSlug: 'horizon-media',
      plan: 'ENTERPRISE',
      databaseMode: 'shared',
      primaryColor: '#D97706',
      members: [
        {
          role: 'Tenant Owner',
          tenantRole: 'OWNER',
          email: 'owner@horizon.com',
          password: DEMO_PASSWORD,
          name: 'Olivia Wilde',
          url: '/login',
        },
        {
          role: 'Tenant Administrator',
          tenantRole: 'ADMIN',
          email: 'admin@horizon.com',
          password: DEMO_PASSWORD,
          name: 'Don Draper',
          url: '/login',
        },
        {
          role: 'Creative Director',
          tenantRole: 'MEMBER',
          email: 'manager@horizon.com',
          password: DEMO_PASSWORD,
          name: 'Peggy Olson',
          url: '/login',
        },
        {
          role: 'Digital Producer',
          tenantRole: 'MEMBER',
          email: 'creator@horizon.com',
          password: DEMO_PASSWORD,
          name: 'Peter Parker',
          url: '/login',
        },
        {
          role: 'Media Auditor',
          tenantRole: 'VIEWER',
          email: 'viewer@horizon.com',
          password: DEMO_PASSWORD,
          name: 'Clark Kent',
          url: '/login',
        },
      ],
    },
  ],
};

export async function seedDemo({ reset = true } = {}): Promise<void> {
  logger.info('====================================================');
  logger.info('       Starting Clean SaaS Foundation Demo Seeder   ');
  logger.info('====================================================');

  // ----------------------------------------------------
  if (reset) {
    // 0. Clean and Wipe Old Data (Cascade Truncate All Non-System Data)
    // ----------------------------------------------------
    logger.info('0. Wiping all existing demo data, residue tenants, and staff accounts...');
    await db.execute(sql`
    TRUNCATE TABLE 
      "PlatformSupportSession",
      "PlatformAuditLog",
      "PlatformRolePolicy",
      "UserGroupPlatformRole",
      "PlatformUserGroupMember",
      "PlatformUserGroupRole",
      "PlatformUserGroup",
      "PlatformStaff",
      "Session",
      "VerificationToken",
      "AuditLog",
      "OutboxEvent",
      "EmailTemplate",
      "File",
      "Payment",
      "Refund",
      "SubscriptionChange",
      "SubscriptionEvent",
      "Invoice",
      "Subscription",
      "TenantEntitlementOverride",
      "TenantUsageRecord",
      "TenantMemberRole",
      "TenantMember",
      "TenantModule",
      "TenantBranding",
      "TenantEmailConfig",
      "TenantAuditPolicy",
      "TenantInvitation",
      "tenant_sso_configs",
      "tenant_scim_tokens",
      "GroupPolicy",
      "RolePolicy",
      "Policy",
      "UserGroupMember",
      "UserGroupRole",
      "UserGroup",
      "Address",
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
  }

  // ----------------------------------------------------
  // 1. Seed Dynamic RBAC Permissions & System Roles
  // ----------------------------------------------------
  logger.info('1. Seeding customer tenant dynamic RBAC modules & roles...');
  await seedDefaultRbac();
  logger.info('   ✔ Customer tenant RBAC initialized.');

  // ----------------------------------------------------
  // 2. Seed Canonical Platform Permissions & System Roles (Single-Colon Standard)
  // ----------------------------------------------------
  logger.info('2. Seeding platform canonical permissions & system roles...');
  await seedPlatformDefaults();
  logger.info('   ✔ Platform canonical catalogue initialized.');

  // ----------------------------------------------------
  // 3. Provision Platform Staff Accounts (Super Admin + 5 Staff)
  // ----------------------------------------------------
  logger.info('3. Provisioning platform staff accounts (Super Admin + 5 Staff)...');
  const staffIdMap = new Map<string, string>();

  for (const staffDef of DEMO_CREDENTIALS.platform) {
    const role = await platformRepo.findRoleByKey(staffDef.roleKey);
    if (!role) {
      logger.warn({ roleKey: staffDef.roleKey }, 'Platform role not found, skipping staff.');
      continue;
    }

    const passwordHash = await bcrypt.hash(staffDef.password, 12);
    const created = await platformRepo.createStaff({
      email: staffDef.email,
      displayName: staffDef.name,
      passwordHash,
      roleId: role.id,
      status: 'ACTIVE',
    });
    staffIdMap.set(staffDef.email, created.id);
    logger.info({ email: staffDef.email, role: staffDef.roleKey }, '   ✔ Created platform staff');
  }

  // Provision superadmin into global users table as standard USER
  const superAdminEmail = 'sid.superadmin@yopmail.com';
  const adminPasswordHash = await bcrypt.hash(DEMO_PASSWORD, 12);

  await db.insert(users).values({
    email: superAdminEmail,
    passwordHash: adminPasswordHash,
    firstName: 'Siddharth',
    lastName: 'SuperAdmin',
    status: 'ACTIVE',
    emailVerifiedAt: new Date(),
  });
  logger.info('   ✔ Provisioned user account for platform operator.');

  // ----------------------------------------------------
  // 4. Provision Customer Users & 6 Clean Tenants
  // ----------------------------------------------------
  logger.info(
    '4. Provisioning customer organizations and memberships (6 Tenants, 5 Members each)...',
  );
  const allModules = await db.select({ id: appModules.id }).from(appModules);
  const systemRoles = await rbacRepo.findRolesByTenant(null);

  const tenantIdMap = new Map<string, string>();
  const userIdMap = new Map<string, string>();

  for (const tenantDef of DEMO_CREDENTIALS.tenants) {
    // 4a. Create tenant
    const [tenantRecord] = await db
      .insert(tenants)
      .values({
        name: tenantDef.tenantName,
        slug: tenantDef.tenantSlug,
        plan: tenantDef.plan,
        status: 'ACTIVE',
        databaseMode: tenantDef.databaseMode,
        databaseKey:
          tenantDef.databaseMode === 'dedicated' ? `dedicated-${tenantDef.tenantSlug}` : 'primary',
      })
      .returning();

    tenantIdMap.set(tenantDef.tenantSlug, tenantRecord!.id);
    logger.info(
      { slug: tenantDef.tenantSlug, plan: tenantDef.plan },
      '   ✔ Created customer tenant',
    );

    // 4b. Enable all app modules for tenant
    if (allModules.length > 0) {
      await db
        .insert(tenantModules)
        .values(
          allModules.map((m) => ({
            tenantId: tenantRecord!.id,
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
        tenantId: tenantRecord!.id,
        companyName: tenantDef.tenantName,
        primaryColor: tenantDef.primaryColor,
      })
      .onConflictDoNothing();

    // 4d. Provision users and member roles
    for (const memberDef of tenantDef.members) {
      let [userRecord] = await db
        .select()
        .from(users)
        .where(eq(users.email, memberDef.email))
        .limit(1);

      const passwordHash = await bcrypt.hash(memberDef.password, 12);

      if (!userRecord) {
        const parts = memberDef.name.trim().split(/\s+/);
        const [createdUser] = await db
          .insert(users)
          .values({
            email: memberDef.email,
            passwordHash,
            firstName: parts[0] ?? memberDef.name,
            lastName: parts.slice(1).join(' ') || 'User',
            status: 'ACTIVE',
            emailVerifiedAt: new Date(),
          })
          .returning();
        userRecord = createdUser!;
      }
      userIdMap.set(memberDef.email, userRecord.id);

      // Add to tenant members
      const [memberRecord] = await db
        .insert(tenantMembers)
        .values({
          tenantId: tenantRecord!.id,
          userId: userRecord.id,
          status: 'ACTIVE',
        })
        .returning();

      // Assign tenant role (OWNER, ADMIN, MEMBER, VIEWER)
      const targetRole = systemRoles.find((r) => r.name === memberDef.tenantRole);
      if (targetRole && memberRecord) {
        await db
          .insert(tenantMemberRoles)
          .values({
            memberId: memberRecord.id,
            roleId: targetRole.id,
            tenantId: tenantRecord!.id,
          })
          .onConflictDoNothing();
      }
    }
  }

  // ----------------------------------------------------
  // 5. Seed SaaS Pricing Plans & Assign Subscriptions
  // ----------------------------------------------------
  logger.info('5. Initializing pricing tiers and subscriptions...');
  await seedDefaultPlans();

  for (const tenantDef of DEMO_CREDENTIALS.tenants) {
    const tid = tenantIdMap.get(tenantDef.tenantSlug);
    if (tid) {
      await assignInitialSubscription(tid, tenantDef.plan);
    }
  }
  logger.info('   ✔ Subscriptions initialized for all 6 tenants.');

  // ----------------------------------------------------
  // 5b. Seed Basic Platform & Tenant PBAC Policies
  // ----------------------------------------------------
  logger.info('5b. Seeding starter PBAC policies and role bindings...');

  const platformRolesList = await db.select().from(platformRoles);
  const platformRoleByKey = new Map(platformRolesList.map((r) => [r.key, r.id]));
  const systemRoleByName = new Map(systemRoles.map((r) => [r.name, r.id]));

  const platformPoliciesSeed = [
    {
      name: 'Platform Billing High-Value Refund Guard',
      description: 'Explicitly denies automated billing refunds exceeding 5,000 minor-x100 units.',
      resource: 'billing',
      action: 'refund',
      effect: 'deny' as const,
      priority: 100,
      conditions: {
        attribute: 'resource.amountMinor',
        operator: '$gt',
        value: 500000,
      },
      roleKeys: ['BILLING_STAFF'],
    },
    {
      name: 'Platform Billing Standard Operations',
      description: 'Grants standard billing and subscription management to billing operators.',
      resource: 'billing',
      action: '*',
      effect: 'allow' as const,
      priority: 50,
      conditions: { always: true },
      roleKeys: ['BILLING_STAFF'],
    },
    {
      name: 'Platform Support Read-Only Tenant Inspection',
      description: 'Allows support and compliance staff to read workspace metadata.',
      resource: 'tenants',
      action: 'read',
      effect: 'allow' as const,
      priority: 50,
      conditions: { always: true },
      roleKeys: ['SUPPORT_STAFF', 'READ_ONLY_AUDITOR'],
    },
    {
      name: 'Platform Compliance Role & Policy Read',
      description: 'Allows read-only auditors to inspect platform roles and security policies.',
      resource: 'roles',
      action: 'read',
      effect: 'allow' as const,
      priority: 50,
      conditions: { always: true },
      roleKeys: ['READ_ONLY_AUDITOR'],
    },
  ];

  for (const def of platformPoliciesSeed) {
    let [policyRecord] = await db
      .select()
      .from(policies)
      .where(and(isNull(policies.tenantId), eq(policies.name, def.name)))
      .limit(1);

    if (!policyRecord) {
      [policyRecord] = await db
        .insert(policies)
        .values({
          tenantId: null,
          name: def.name,
          description: def.description,
          resource: def.resource,
          action: def.action,
          effect: def.effect,
          priority: def.priority,
          conditions: def.conditions,
          isActive: true,
        })
        .returning();
    }

    if (policyRecord) {
      for (const roleKey of def.roleKeys) {
        const roleId = platformRoleByKey.get(roleKey);
        if (roleId) {
          await db
            .insert(platformRolePolicies)
            .values({ roleId, policyId: policyRecord.id })
            .onConflictDoNothing();
        }
      }
    }
  }

  const tenantPoliciesSeed = [
    {
      name: 'Workspace Admin Full Access',
      description:
        'Allows tenant administrators to perform actions across all workspace resources.',
      resource: '*',
      action: '*',
      effect: 'allow' as const,
      priority: 80,
      conditions: { always: true },
      roleNames: ['ADMIN'],
    },
    {
      name: 'Protect Confidential Leads from Deletion',
      description: 'Prevents non-admin members from deleting leads marked as confidential.',
      resource: 'leads',
      action: 'delete',
      effect: 'deny' as const,
      priority: 100,
      conditions: {
        attribute: 'resource.isConfidential',
        operator: '$eq',
        value: true,
      },
      roleNames: ['MEMBER', 'VIEWER'],
    },
    {
      name: 'Standard Lead Read Access',
      description: 'Allows workspace members and viewers to read non-confidential leads.',
      resource: 'leads',
      action: 'read',
      effect: 'allow' as const,
      priority: 50,
      conditions: {
        attribute: 'resource.isConfidential',
        operator: '$ne',
        value: true,
      },
      roleNames: ['MEMBER', 'VIEWER'],
    },
    {
      name: 'Manage Assigned Leads',
      description: 'Allows members to update CRM leads assigned to their membership.',
      resource: 'leads',
      action: 'update',
      effect: 'allow' as const,
      priority: 50,
      conditions: {
        attribute: 'resource.assignedMemberId',
        operator: '$eq',
        value: 'actor.memberId',
      },
      roleNames: ['MEMBER'],
    },
    {
      name: 'Create Standard Leads',
      description: 'Allows members to create non-confidential CRM leads.',
      resource: 'leads',
      action: 'create',
      effect: 'allow' as const,
      priority: 40,
      conditions: {
        attribute: 'resource.isConfidential',
        operator: '$ne',
        value: true,
      },
      roleNames: ['MEMBER'],
    },
  ];

  for (const tenantDef of DEMO_CREDENTIALS.tenants) {
    const tid = tenantIdMap.get(tenantDef.tenantSlug);
    if (!tid) continue;

    for (const def of tenantPoliciesSeed) {
      let [policyRecord] = await db
        .select()
        .from(policies)
        .where(and(eq(policies.tenantId, tid), eq(policies.name, def.name)))
        .limit(1);

      if (!policyRecord) {
        [policyRecord] = await db
          .insert(policies)
          .values({
            tenantId: tid,
            name: def.name,
            description: def.description,
            resource: def.resource,
            action: def.action,
            effect: def.effect,
            priority: def.priority,
            conditions: def.conditions,
            isActive: true,
          })
          .returning();
      }

      if (policyRecord) {
        for (const roleName of def.roleNames) {
          const roleId = systemRoleByName.get(roleName);
          if (roleId) {
            await db
              .insert(rolePolicies)
              .values({ roleId, policyId: policyRecord.id, tenantId: tid })
              .onConflictDoNothing();
          }
        }
      }
    }
  }
  logger.info('   ✔ Starter PBAC policies seeded for platform and all tenants.');

  // ----------------------------------------------------
  // 5c. Seed Sample Platform & Tenant User Groups (with Roles & Policies)
  // ----------------------------------------------------
  logger.info('5c. Seeding sample platform and tenant user groups...');
  const auditorStaffId = staffIdMap.get('staff.auditor@yopmail.com');
  const readOnlyAuditorRoleId = platformRoleByKey.get('READ_ONLY_AUDITOR');
  const acmeIdForGroup = tenantIdMap.get('acme-realty');
  const acmeManagerId = userIdMap.get('manager@acme.com');
  const acmeAgentId = userIdMap.get('agent@acme.com');
  const memberRoleId = systemRoleByName.get('MEMBER');

  if (auditorStaffId && readOnlyAuditorRoleId) {
    let [platformGroup] = await db
      .select()
      .from(userGroups)
      .where(and(eq(userGroups.scope, 'PLATFORM'), eq(userGroups.slug, 'security-compliance-team')))
      .limit(1);

    if (!platformGroup) {
      [platformGroup] = await db
        .insert(userGroups)
        .values({
          name: 'Security & Compliance Team',
          slug: 'security-compliance-team',
          description:
            'Internal platform compliance cohort with read-only audit & policy oversight.',
          scope: 'PLATFORM',
          tenantId: null,
          status: 'ACTIVE',
          createdBy: auditorStaffId,
          updatedBy: auditorStaffId,
        })
        .returning();
    }

    if (platformGroup) {
      await db
        .insert(userGroupMembers)
        .values({
          groupId: platformGroup.id,
          staffId: auditorStaffId,
          addedBy: auditorStaffId,
        })
        .onConflictDoNothing();

      await db
        .insert(userGroupPlatformRoles)
        .values({
          groupId: platformGroup.id,
          roleId: readOnlyAuditorRoleId,
        })
        .onConflictDoNothing();

      const [platformSupportInspectPolicy] = await db
        .select()
        .from(policies)
        .where(
          and(
            isNull(policies.tenantId),
            eq(policies.name, 'Platform Compliance Role & Policy Read'),
          ),
        )
        .limit(1);

      if (platformSupportInspectPolicy) {
        await db
          .insert(groupPolicies)
          .values({
            groupId: platformGroup.id,
            policyId: platformSupportInspectPolicy.id,
            tenantId: null,
          })
          .onConflictDoNothing();
      }
    }
  }

  if (acmeIdForGroup && acmeManagerId && acmeAgentId && memberRoleId) {
    let [acmeGroup] = await db
      .select()
      .from(userGroups)
      .where(
        and(
          eq(userGroups.scope, 'TENANT'),
          eq(userGroups.tenantId, acmeIdForGroup),
          eq(userGroups.slug, 'sales-operations-squad'),
        ),
      )
      .limit(1);

    if (!acmeGroup) {
      [acmeGroup] = await db
        .insert(userGroups)
        .values({
          name: 'Sales Operations Squad',
          slug: 'sales-operations-squad',
          description: 'Regional CRM sales specialists collaborating on qualified customer leads.',
          scope: 'TENANT',
          tenantId: acmeIdForGroup,
          status: 'ACTIVE',
          createdBy: acmeManagerId,
          updatedBy: acmeManagerId,
        })
        .returning();
    }

    if (acmeGroup) {
      await db
        .insert(userGroupMembers)
        .values([
          {
            groupId: acmeGroup.id,
            userId: acmeManagerId,
            tenantId: acmeIdForGroup,
            addedBy: acmeManagerId,
          },
          {
            groupId: acmeGroup.id,
            userId: acmeAgentId,
            tenantId: acmeIdForGroup,
            addedBy: acmeManagerId,
          },
        ])
        .onConflictDoNothing();

      await db
        .insert(userGroupRoles)
        .values({
          groupId: acmeGroup.id,
          roleId: memberRoleId,
        })
        .onConflictDoNothing();

      const [leadUpdatePolicy] = await db
        .select()
        .from(policies)
        .where(
          and(eq(policies.tenantId, acmeIdForGroup), eq(policies.name, 'Manage Assigned Leads')),
        )
        .limit(1);

      if (leadUpdatePolicy) {
        await db
          .insert(groupPolicies)
          .values({
            groupId: acmeGroup.id,
            policyId: leadUpdatePolicy.id,
            tenantId: acmeIdForGroup,
          })
          .onConflictDoNothing();
      }
    }
  }
  logger.info('   ✔ Sample platform & tenant user groups seeded with roles and policies.');

  // ----------------------------------------------------
  // 6. Seed Active Audited Support Delegation Session
  // ----------------------------------------------------
  logger.info('6. Seeding sample active audited support session...');
  const supportStaffId = staffIdMap.get('staff.support@yopmail.com');
  const acmeTenantId = tenantIdMap.get('acme-realty');

  if (supportStaffId && acmeTenantId) {
    await db.insert(platformSupportSessions).values({
      staffId: supportStaffId,
      tenantId: acmeTenantId,
      reason: 'TICKET-4892: Customer reported PDF export latency investigation',
      status: 'ACTIVE',
      expiresAt: new Date(Date.now() + 2 * 60 * 60 * 1000), // 2 hours window
    });
    logger.info('   ✔ Active audited support session created for Acme Realty Corp.');
  }

  // ----------------------------------------------------
  // 7. Seed Platform Compliance Audit Trail
  // ----------------------------------------------------
  logger.info('7. Seeding platform compliance audit trail...');
  const superAdminId = staffIdMap.get('sid.superadmin@yopmail.com');

  if (superAdminId) {
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
        metadata: { changes: { permissions: ['system_health:read', 'tenant_support:start'] } },
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
    ]);
    logger.info('   ✔ Platform compliance audit records seeded.');
  }

  // ----------------------------------------------------
  // 8. Seed Customer Tenant Audit Logs & Email Templates
  // ----------------------------------------------------
  logger.info('8. Seeding tenant activity and email templates for Acme...');
  const acmeOwnerId = userIdMap.get('owner@acme.com');

  if (acmeTenantId && acmeOwnerId) {
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
    ]);

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
    ];

    for (const tpl of templatesToSeed) {
      await db.insert(emailTemplates).values(tpl).onConflictDoNothing();
    }
    logger.info('   ✔ Customer tenant email templates seeded.');
  }

  logger.info('====================================================');
  logger.info('       Demo Database Seeding Complete!              ');
  logger.info('====================================================');
}

// Auto-execute if invoked as a CLI script
if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
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
