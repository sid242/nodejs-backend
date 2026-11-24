import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { getTableName, is } from 'drizzle-orm';
import { PgTable } from 'drizzle-orm/pg-core';

import * as schema from '@/db/schema';
import { getLatestSchemaTag, isSchemaVersionCurrent } from '@/db/schema-version';
import { isTenantTable, PRIMARY_ONLY_TABLES, TENANT_TABLES } from '@/db/tenancy/tenant-tables';
import {
  approveTenantDatabaseOperationDto,
  executeTenantDatabaseOperationDto,
} from '@/modules/platform/platform.dto';
import { PLATFORM_PERMISSIONS } from '@/modules/platform/platform.permissions';

describe('04 Database Operations Control Plane & Migrations Suite', () => {
  describe('Tenant Tables Registry Completeness', () => {
    it('every schema PgTable is accounted for in either TENANT_TABLES or PRIMARY_ONLY_TABLES', () => {
      const tenantTableNames = new Set(TENANT_TABLES.map((t) => t.name));
      const primaryOnlyNames = new Set(PRIMARY_ONLY_TABLES);

      const unmappedTables: string[] = [];

      for (const [key, value] of Object.entries(schema)) {
        if (is(value, PgTable)) {
          const tableName = getTableName(value);
          const isMapped = tenantTableNames.has(tableName) || primaryOnlyNames.has(tableName);
          if (!isMapped) {
            unmappedTables.push(`${key} (${tableName})`);
          }
        }
      }

      assert.deepEqual(
        unmappedTables,
        [],
        `All tables in database schema must be accounted for in tenant-tables.ts. Missing: ${unmappedTables.join(', ')}`,
      );
    });

    it('every tenant-scoped table appears in topological dependency order', () => {
      const seen = new Set<string>();

      for (const entry of TENANT_TABLES) {
        if (entry.dependsOn && entry.dependsOn.length > 0) {
          for (const dep of entry.dependsOn) {
            assert.ok(
              seen.has(dep),
              `Table "${entry.name}" depends on "${dep}", but "${dep}" has not been registered prior in topological order.`,
            );
          }
        }
        seen.add(entry.name);
      }
    });

    it('isTenantTable correctly classifies tenant vs primary tables', () => {
      assert.equal(isTenantTable('TenantMember'), true);
      assert.equal(isTenantTable('File'), true);
      assert.equal(isTenantTable('AuditLog'), true);
      assert.equal(isTenantTable('Tenant'), false);
      assert.equal(isTenantTable('User'), false);
      assert.equal(isTenantTable('PlatformStaff'), false);
    });
  });

  describe('Schema Version Tracking', () => {
    it('reads the latest schema tag from drizzle journal correctly', () => {
      const latestTag = getLatestSchemaTag();
      assert.ok(typeof latestTag === 'string' && latestTag.length > 0);
      assert.match(latestTag, /^[0-9]{4}_/);
    });

    it('isSchemaVersionCurrent returns true for current tag and false for outdated tag', () => {
      const latestTag = getLatestSchemaTag();
      assert.equal(isSchemaVersionCurrent(latestTag), true);
      assert.equal(isSchemaVersionCurrent('0000_old_migration'), false);
      assert.equal(isSchemaVersionCurrent('1.0.0'), false);
      assert.equal(isSchemaVersionCurrent(null), false);
      assert.equal(isSchemaVersionCurrent(undefined), false);
    });
  });

  describe('Database Operation DTO & Permission Invariants', () => {
    it('accepts VERIFY action with operational reason', () => {
      const parsed = executeTenantDatabaseOperationDto.parse({
        action: 'VERIFY',
        reason: 'Verifying row counts after tenant migration',
      });
      assert.equal(parsed.action, 'VERIFY');
      assert.equal(parsed.reason, 'Verifying row counts after tenant migration');
    });

    it('enforces reason length minimum of 5 characters', () => {
      assert.throws(() => {
        executeTenantDatabaseOperationDto.parse({
          action: 'HEALTH_CHECK',
          reason: '123',
        });
      }, /Reason must be at least 5 characters/);
    });

    it('approves four-eyes operation with valid justification', () => {
      const parsed = approveTenantDatabaseOperationDto.parse({
        reason: 'Authorized four-eyes operator sign-off by lead engineer',
      });
      assert.equal(parsed.reason, 'Authorized four-eyes operator sign-off by lead engineer');
    });

    it('has canonical database:operate permission defined in platform catalog', () => {
      assert.equal(PLATFORM_PERMISSIONS.DATABASE_OPERATE, 'database:operate');
    });
  });
});
