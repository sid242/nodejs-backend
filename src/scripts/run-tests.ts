import { spawnSync } from 'node:child_process';

async function prepareGitHubActions(): Promise<void> {
  process.env.S3_BUCKET ??= 'app-ci-test';
  // Presigning tests use synthetic credentials and do not call S3.
  process.env.AWS_ACCESS_KEY_ID ??= 'local-ci';
  process.env.AWS_SECRET_ACCESS_KEY ??= 'local-ci-placeholder';
  process.env.AWS_EC2_METADATA_DISABLED ??= 'true';

  const { closeDb } = await import('@/config/db');
  const { closeRedisClients } = await import('@/config/redis');
  const { runFleetMigrations } = await import('@/db/migrate-all');
  const { seedDefaultPlans } = await import('@/modules/billing/billing.service');
  const { seedPlatformDefaults } = await import('@/modules/platform/platform.service');
  const { seedDefaultRbac } = await import('@/modules/rbac/rbac.service');
  const { closeQueues } = await import('@/queues/index');

  try {
    await runFleetMigrations();
    await seedDefaultRbac();
    await seedPlatformDefaults();
    await seedDefaultPlans();
  } finally {
    await Promise.allSettled([closeQueues(), closeDb(), closeRedisClients()]);
  }
}

if (process.env.GITHUB_ACTIONS === 'true' && process.env.NODE_ENV === 'test') {
  await prepareGitHubActions();
}

const result = spawnSync(
  process.execPath,
  [
    '--env-file-if-exists=.env',
    '--import',
    'tsx',
    '--test',
    '--test-force-exit',
    ...process.argv.slice(2),
  ],
  { stdio: 'inherit' },
);

if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
