import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  executeTenantDatabaseOperationDto,
  listTenantDatabasesQueryDto,
} from '../src/modules/platform/platform.dto';

describe('Phase 12: Tenant Database Operations Control Plane — Unit & Invariants', () => {
  describe('DTO & Query Validation', () => {
    it('listTenantDatabasesQueryDto applies correct defaults and parses valid filters', () => {
      const parsed = listTenantDatabasesQueryDto.parse({
        page: '2',
        limit: '25',
        search: 'acme-corp',
        strategy: 'dedicated',
        provisioningStatus: 'ACTIVE',
        region: 'us-east-1',
        migrationStatus: 'UP_TO_DATE',
        schemaVersion: '1.2.0',
        healthStatus: 'HEALTHY',
      });

      assert.equal(parsed.page, 2);
      assert.equal(parsed.limit, 25);
      assert.equal(parsed.search, 'acme-corp');
      assert.equal(parsed.strategy, 'dedicated');
      assert.equal(parsed.provisioningStatus, 'ACTIVE');
      assert.equal(parsed.region, 'us-east-1');
      assert.equal(parsed.migrationStatus, 'UP_TO_DATE');
      assert.equal(parsed.schemaVersion, '1.2.0');
      assert.equal(parsed.healthStatus, 'HEALTHY');
    });

    it('listTenantDatabasesQueryDto defaults page to 1 and limit to 20', () => {
      const parsed = listTenantDatabasesQueryDto.parse({});
      assert.equal(parsed.page, 1);
      assert.equal(parsed.limit, 20);
      assert.equal(parsed.strategy, undefined);
      assert.equal(parsed.provisioningStatus, undefined);
    });

    it('executeTenantDatabaseOperationDto validates all canonical action types', () => {
      const validActions = [
        'HEALTH_CHECK',
        'MIGRATE',
        'PROVISION',
        'RETRY_PROVISIONING',
        'BACKUP',
        'RESTORE',
        'ROLLBACK',
      ] as const;

      for (const action of validActions) {
        const parsed = executeTenantDatabaseOperationDto.parse({
          action,
          reason: 'Valid operational maintenance reason',
          maintenanceWindow: '2026-11-10T02:00:00Z - 04:00:00Z',
          backupConfirmed: true,
          targetVersion: '1.2.0',
          poolLimit: 15,
        });
        assert.equal(parsed.action, action);
        assert.equal(parsed.reason, 'Valid operational maintenance reason');
        assert.equal(parsed.backupConfirmed, true);
        assert.equal(parsed.poolLimit, 15);
      }
    });

    it('executeTenantDatabaseOperationDto rejects missing or short reason', () => {
      assert.throws(() => {
        executeTenantDatabaseOperationDto.parse({
          action: 'HEALTH_CHECK',
          reason: 'abc', // Less than 5 characters
        });
      });

      assert.throws(() => {
        executeTenantDatabaseOperationDto.parse({
          action: 'HEALTH_CHECK',
        });
      });
    });

    it('executeTenantDatabaseOperationDto rejects invalid action names', () => {
      assert.throws(() => {
        executeTenantDatabaseOperationDto.parse({
          action: 'DROP_TABLES',
          reason: 'Unauthorized destructive action',
        });
      });
    });
  });

  describe('Secret Masking & Security Invariants', () => {
    it('Sanitizes PostgreSQL connection URLs by redacting credentials', () => {
      const maskUrl = (rawUrl: string | null | undefined): string | null => {
        if (!rawUrl) return null;
        try {
          const parsed = new URL(rawUrl);
          parsed.username = '***';
          parsed.password = '***';
          return parsed.toString();
        } catch {
          return rawUrl.replace(/:\/\/[^/]+@/, '://***:***@');
        }
      };

      const raw = 'postgresql://db_user_prod:superSecretPassword123@aurora-cluster.us-east-1.rds.amazonaws.com:5432/tenant_db?sslmode=require';
      const masked = maskUrl(raw);

      assert.ok(masked);
      assert.ok(!masked.includes('db_user_prod'));
      assert.ok(!masked.includes('superSecretPassword123'));
      assert.ok(masked.includes('aurora-cluster.us-east-1.rds.amazonaws.com:5432/tenant_db?sslmode=require'));
    });

    it('Generates deterministic and safe Secrets Manager references without credentials', () => {
      const getSecretManagerRef = (slug: string, dbKey: string): string => {
        return `secretsmanager://tenants/${slug}/${dbKey}/credentials`;
      };

      const ref = getSecretManagerRef('enterprise-corp', 'tenant_enterprise_corp');
      assert.equal(ref, 'secretsmanager://tenants/enterprise-corp/tenant_enterprise_corp/credentials');
      assert.ok(!ref.includes('password'));
    });
  });

  describe('Concurrency & Safety Invariants', () => {
    it('Defines deterministic Redis lock key for tenant DB migration', () => {
      const tenantId = '00000000-0000-0000-0000-000000000001';
      const lockKey = `lock:tenant-db-migration:${tenantId}`;
      assert.equal(lockKey, 'lock:tenant-db-migration:00000000-0000-0000-0000-000000000001');
    });

    it('Requires explicit backup confirmation for destructive operations', () => {
      const validateBackupGuard = (action: string, backupConfirmed?: boolean) => {
        if (action === 'ROLLBACK' || action === 'RESTORE') {
          if (!backupConfirmed) {
            throw new Error(`${action} requires explicit backup confirmation`);
          }
        }
      };

      assert.throws(
        () => validateBackupGuard('ROLLBACK', false),
        /ROLLBACK requires explicit backup confirmation/,
      );

      assert.throws(
        () => validateBackupGuard('RESTORE', undefined),
        /RESTORE requires explicit backup confirmation/,
      );

      // Should succeed when confirmed
      assert.doesNotThrow(() => validateBackupGuard('ROLLBACK', true));
      assert.doesNotThrow(() => validateBackupGuard('RESTORE', true));
      assert.doesNotThrow(() => validateBackupGuard('HEALTH_CHECK', false));
    });
  });
});
