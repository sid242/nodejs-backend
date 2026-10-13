import bcrypt from 'bcryptjs';
import { eq } from 'drizzle-orm';
import { db, closeDb } from '@/config/db.js';
import { closeRedisClients } from '@/config/redis.js';
import { users } from '@/db/schema/index.js';
import { seedDefaultRbac } from '@/modules/rbac/rbac.service.js';
import { logger } from '@/config/logger.js';

async function seed(): Promise<void> {
  const adminEmail = (process.env.ADMIN_EMAIL ?? 'admin@example.com').toLowerCase().trim();
  const adminPassword = process.env.ADMIN_PASSWORD ?? 'Admin@123456';
  const adminName = process.env.ADMIN_NAME ?? 'System Administrator';

  logger.info('--- Starting Database Seeder ---');

  // 1. Seed Dynamic RBAC Permissions & System Roles
  logger.info('Seeding dynamic RBAC permissions and roles...');
  await seedDefaultRbac();
  logger.info('RBAC permissions and system roles seeded successfully.');

  // 2. Create or Promote System Administrator
  const [existingUser] = await db.select().from(users).where(eq(users.email, adminEmail)).limit(1);

  if (existingUser) {
    if (
      existingUser.role !== 'ADMIN' ||
      existingUser.status !== 'ACTIVE' ||
      !existingUser.emailVerifiedAt
    ) {
      await db
        .update(users)
        .set({
          role: 'ADMIN',
          status: 'ACTIVE',
          emailVerifiedAt: existingUser.emailVerifiedAt ?? new Date(),
        })
        .where(eq(users.id, existingUser.id));
      logger.info({ email: adminEmail }, 'Existing user promoted to global ADMIN.');
    } else {
      logger.info({ email: adminEmail }, 'Admin user already exists and is active.');
    }
  } else {
    const passwordHash = await bcrypt.hash(adminPassword, 12);
    const [createdAdmin] = await db
      .insert(users)
      .values({
        email: adminEmail,
        passwordHash,
        name: adminName,
        role: 'ADMIN',
        status: 'ACTIVE',
        emailVerifiedAt: new Date(),
      })
      .returning();

    if (!createdAdmin) {
      throw new Error('Failed to create admin record');
    }

    logger.info(
      {
        id: createdAdmin.id,
        email: createdAdmin.email,
        name: createdAdmin.name,
        role: createdAdmin.role,
      },
      'Global System Administrator created successfully.',
    );
  }

  logger.info('--- Seeding completed successfully ---');
}

try {
  await seed();
} catch (error) {
  logger.error({ err: error }, 'Database seeding failed');
  process.exitCode = 1;
} finally {
  await closeRedisClients();
  await closeDb();
}
