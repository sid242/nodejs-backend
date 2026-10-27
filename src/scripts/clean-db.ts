import bcrypt from 'bcryptjs';
import { eq, inArray } from 'drizzle-orm';

import { closeDb, db } from '@/config/db.js';
import { cacheRedis, closeRedisClients } from '@/config/redis.js';
import {
  auditLogs,
  platformAuditLogs,
  platformRoles,
  platformStaff,
  platformSupportSessions,
  tenants,
  users,
} from '@/db/schema/index.js';

const DEMO_PASSWORD = 'Password@123456';

const KEEP_TENANT_SLUGS = ['acme-realty', 'nexus-estates'];

const KEEP_USER_EMAILS = [
  'sid.superadmin@yopmail.com',
  'owner@acme.com',
  'admin@acme.com',
  'manager@acme.com',
  'agent@acme.com',
  'viewer@acme.com',
  'owner@nexus.com',
  'admin@nexus.com',
  'manager@nexus.com',
  'agent@nexus.com',
  'viewer@nexus.com',
];

const TARGET_PLATFORM_STAFF = [
  {
    email: 'sid.superadmin@yopmail.com',
    displayName: 'Siddharth SuperAdmin',
    roleKey: 'SUPER_ADMIN',
  },
  {
    email: 'staff.support@yopmail.com',
    displayName: 'Support Staff',
    roleKey: 'SUPPORT_STAFF',
  },
  {
    email: 'staff.techops@yopmail.com',
    displayName: 'TechOps Staff',
    roleKey: 'TECHNICAL_SUPPORT',
  },
  {
    email: 'staff.billing@yopmail.com',
    displayName: 'Elena Billing',
    roleKey: 'BILLING_STAFF',
  },
  {
    email: 'staff.auditor@yopmail.com',
    displayName: 'Marcus Auditor',
    roleKey: 'READ_ONLY_AUDITOR',
  },
];

async function main() {
  console.log('--- 1. CLEANING UP JUNK TENANTS ---');
  const allTenants = await db.select().from(tenants);
  const junkTenants = allTenants.filter((t) => !KEEP_TENANT_SLUGS.includes(t.slug));
  console.log(`Found ${junkTenants.length} junk tenants out of ${allTenants.length} total.`);

  if (junkTenants.length > 0) {
    const junkIds = junkTenants.map((t) => t.id);
    await db.delete(auditLogs).where(inArray(auditLogs.tenantId, junkIds));
    await db.delete(tenants).where(inArray(tenants.id, junkIds));
    console.log(`✔ Successfully removed ${junkTenants.length} junk tenants.`);
  }

  console.log('\n--- 2. CLEANING UP JUNK USERS ---');
  const allUsers = await db.select().from(users);
  const junkUsers = allUsers.filter((u) => !KEEP_USER_EMAILS.includes(u.email));
  console.log(`Found ${junkUsers.length} junk users out of ${allUsers.length} total.`);

  if (junkUsers.length > 0) {
    const junkUserIds = junkUsers.map((u) => u.id);
    await db.delete(auditLogs).where(inArray(auditLogs.userId, junkUserIds));
    await db.delete(users).where(inArray(users.id, junkUserIds));
    console.log(`✔ Successfully removed ${junkUsers.length} junk users.`);
  }

  console.log('\n--- 3. REORGANIZING PLATFORM STAFF ROLES ---');
  const roles = await db.select().from(platformRoles);
  const roleMap = new Map(roles.map((r) => [r.key, r]));

  const staffEmailsToKeep = TARGET_PLATFORM_STAFF.map((s) => s.email);
  const allStaff = await db.select().from(platformStaff);
  const junkStaff = allStaff.filter((s) => !staffEmailsToKeep.includes(s.email));

  if (junkStaff.length > 0) {
    const junkStaffIds = junkStaff.map((s) => s.id);
    await db
      .delete(platformSupportSessions)
      .where(inArray(platformSupportSessions.staffId, junkStaffIds));
    await db.delete(platformAuditLogs).where(inArray(platformAuditLogs.actorStaffId, junkStaffIds));
    await db.delete(platformStaff).where(inArray(platformStaff.id, junkStaffIds));
    console.log(`✔ Removed ${junkStaff.length} operator test staff accounts.`);
  }

  const passwordHash = await bcrypt.hash(DEMO_PASSWORD, 12);

  for (const staffDef of TARGET_PLATFORM_STAFF) {
    const targetRole = roleMap.get(staffDef.roleKey);
    if (!targetRole) {
      console.warn(`Role ${staffDef.roleKey} not found!`);
      continue;
    }

    const [existing] = await db
      .select()
      .from(platformStaff)
      .where(eq(platformStaff.email, staffDef.email))
      .limit(1);

    if (existing) {
      await db
        .update(platformStaff)
        .set({
          displayName: staffDef.displayName,
          roleId: targetRole.id,
          status: 'ACTIVE',
        })
        .where(eq(platformStaff.id, existing.id));
      console.log(
        `✔ Updated "${staffDef.displayName}" <${staffDef.email}> -> ${staffDef.roleKey} (${targetRole.name})`,
      );
    } else {
      await db.insert(platformStaff).values({
        email: staffDef.email,
        displayName: staffDef.displayName,
        passwordHash,
        roleId: targetRole.id,
        status: 'ACTIVE',
      });
      console.log(
        `✔ Created "${staffDef.displayName}" <${staffDef.email}> -> ${staffDef.roleKey} (${targetRole.name})`,
      );
    }
  }

  console.log('\n--- 4. CLEARING REDIS CACHES ---');
  try {
    const stream = cacheRedis.scanStream({ match: 'cache:*', count: 200 });
    for await (const keys of stream) {
      if (keys.length) await cacheRedis.unlink(keys);
    }
    console.log('✔ Redis caches cleared.');
  } catch (err) {
    console.warn('Redis clear warning:', err);
  }

  console.log('\n=== FINAL DATABASE STATE SUMMARY ===');
  const finalTenants = await db.select().from(tenants);
  console.log(`\nActive Tenants (${finalTenants.length}):`);
  finalTenants.forEach((t) =>
    console.log(`  - [${t.slug}] "${t.name}" (Plan: ${t.plan}, Status: ${t.status})`),
  );

  const finalUsers = await db.select().from(users);
  console.log(`\nActive Users (${finalUsers.length}):`);
  finalUsers.forEach((u) =>
    console.log(`  - <${u.email}> "${u.name}" (Role: ${u.role}, Status: ${u.status})`),
  );

  const finalStaff = await db.select().from(platformStaff);
  console.log(`\nPlatform Staff (${finalStaff.length}):`);
  finalStaff.forEach((s) => {
    const r = roles.find((x) => x.id === s.roleId);
    console.log(`  - <${s.email}> "${s.displayName}" -> Role: ${r?.key} ("${r?.name}")`);
  });

  await closeRedisClients();
  await closeDb();
  process.exit(0);
}

main().catch((err) => {
  console.error('Fatal error during cleanup:', err);
  process.exit(1);
});
