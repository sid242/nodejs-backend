import bcrypt from 'bcryptjs';

import { closeDb } from '@/config/db.js';
import { env } from '@/config/env.js';
import { logger } from '@/config/logger.js';
import { closeRedisClients } from '@/config/redis.js';
import * as platformRepo from '@/modules/platform/platform.repository.js';
import { seedPlatformDefaults } from '@/modules/platform/platform.service.js';
import { seedDefaultRbac } from '@/modules/rbac/rbac.service.js';

export async function bootstrap(): Promise<void> {
  logger.info('====================================================');
  logger.info('         SaaS Platform Production Bootstrapper      ');
  logger.info('====================================================');

  // 1. Seed Dynamic RBAC and Canonical Platform Permissions & System Roles
  logger.info('1. Ensuring RBAC & Canonical Platform roles and permissions exist...');
  await seedDefaultRbac();
  await seedPlatformDefaults();
  logger.info('   ✔ Platform and tenant RBAC catalogues initialized.');

  // 2. Check if a Super Administrator already exists
  const existingSuperAdminCount = await platformRepo.countActiveSuperAdmins();
  if (existingSuperAdminCount > 0) {
    logger.info(
      `   ✔ Super Administrator already exists (${existingSuperAdminCount} active). Bootstrapping skipped.`,
    );
    return;
  }

  // 3. Resolve bootstrap credentials from environment variables
  const email =
    process.env.BOOTSTRAP_SUPERADMIN_EMAIL ||
    env.BOOTSTRAP_SUPERADMIN_EMAIL ||
    'superadmin@platform.local';
  const password =
    process.env.BOOTSTRAP_SUPERADMIN_PASSWORD ||
    env.BOOTSTRAP_SUPERADMIN_PASSWORD ||
    'Password@123456';

  const superAdminRole = await platformRepo.findRoleByKey('SUPER_ADMIN');
  if (!superAdminRole) {
    throw new Error('SUPER_ADMIN role not found after seeding platform defaults');
  }

  const passwordHash = await bcrypt.hash(password, 12);
  const created = await platformRepo.createStaff({
    email,
    displayName: 'Platform Super Administrator',
    passwordHash,
    roleId: superAdminRole.id,
    status: 'ACTIVE',
  });

  logger.info(
    { email: created.email, id: created.id },
    '   ✔ Successfully bootstrapped primary Super Administrator account.',
  );
}

// Auto-execute if invoked as a CLI script
if (process.argv[1]?.includes('bootstrap')) {
  bootstrap()
    .then(async () => {
      await closeDb();
      await closeRedisClients();
      logger.info('Bootstrap completed successfully.');
      process.exit(0);
    })
    .catch(async (error) => {
      logger.error({ err: error }, 'Bootstrap failed');
      await closeDb();
      await closeRedisClients();
      process.exit(1);
    });
}
