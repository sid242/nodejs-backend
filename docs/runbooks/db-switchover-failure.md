# Runbook: Tenant Database Switchover Failure

## Severity: HIGH (P1 / P2)

### Trigger

A BullMQ `db-ops` switchover job failed, or a tenant database returned `TENANT_DB_UNAVAILABLE`, `TENANT_DB_OUTDATED`, or failed data checksum validation.

---

### Immediate Diagnostics

1. **Check Tenant Maintenance Status**:
   ```sql
   SELECT id, slug, "databaseMode", "dedicatedDbState", "schemaVersion"
   FROM tenants
   WHERE id = '<TENANT_ID>';
   ```
2. **Inspect BullMQ Job Logs**:
   Open Bull-Board at `/admin/queues` -> Queue `db-ops` -> Filter by `jobId: switchover:<tenantId>`. Check error stack and failure phase (`COPY_DATA`, `CHECKSUM_VERIFY`, `SWITCHOVER`, `DRAIN`).
3. **Verify Target Database Connectivity**:
   ```bash
   psql "<TARGET_DATABASE_URL>" -c "SELECT current_database(), current_user;"
   ```

---

### Remediation & Rollback Steps

1. **If Switchover Failed Mid-Copy (Before Final Cutover)**:
   - The primary database still holds the canonical live data.
   - Revert tenant routing to `SHARED` pooled mode:
     ```sql
     UPDATE tenants
     SET "databaseMode" = 'SHARED', "dedicatedDbState" = 'FAILED'
     WHERE id = '<TENANT_ID>';
     ```
   - Invalidate tenant routing cache in Redis:
     ```bash
     redis-cli PUBLISH tenant:cache:invalidate '<TENANT_ID>'
     ```
   - Clean up partially transferred tables on target dedicated DB.

2. **If Target Database Failed Schema Consistency Check (`TENANT_DB_OUTDATED`)**:
   - Run fleet schema upgrade against the dedicated tenant database:
     ```bash
     npm run db:migrate:all
     ```
   - Confirm current schema version matches latest migration tag in `drizzle/meta/_journal.json`.

3. **Verify Restoration**:
   - Send test read/write request to tenant context:
     ```bash
     curl -H "Authorization: Bearer <ADMIN_TOKEN>" \
          -H "x-tenant-id: <TENANT_SLUG>" \
          http://localhost:3000/api/v1/tenants/current
     ```
   - Verify HTTP status is 200 OK without errors.
