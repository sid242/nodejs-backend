# Runbook: Emergency Token & Session Revocation

## Severity: CRITICAL (P0 / P1)

### Trigger

A security breach, lost device, unauthorized credential leak, or sudden dismissal of a high-privilege tenant administrator or platform operator.

---

### Immediate Revocation Procedures

1. **User Global Session Revocation (All Replicas & Devices)**:
   - When a user's tokens must be invalidated immediately across all clusters without waiting for 15-minute JWT expiration:
     ```sql
     -- Increment user's tokenVersion to invalidate all existing access tokens
     UPDATE users
     SET "tokenVersion" = "tokenVersion" + 1
     WHERE id = '<USER_ID>';
     ```
   - Invalidate all active Redis refresh token records:
     ```bash
     redis-cli EVAL "local keys = redis.call('keys', 'refresh:<USER_ID>:*') for i=1,#keys do redis.call('del', keys[i]) end" 0
     ```
   - Force WebSocket disconnect via Redis emitter:
     ```typescript
     import { emitToUser } from '@/sockets/emitter';

     emitToUser('<USER_ID>', 'session:revoked', { reason: 'SECURITY_REVOCATION' });
     ```

2. **SCIM Token Immediate Revocation**:
   - Invalidate a compromised SCIM bearer token:
     ```sql
     DELETE FROM tenant_scim_tokens
     WHERE id = '<TOKEN_ID>' OR "tenantId" = '<TENANT_ID>';
     ```
   - Invalidate token cache in Redis:
     ```bash
     redis-cli DEL "scim:token:<HASH>"
     ```

3. **Platform Support Session Revocation**:
   - Immediately conclude an active delegated support session:
     ```sql
     UPDATE platform_support_sessions
     SET status = 'REVOKED', "endedAt" = NOW()
     WHERE id = '<SESSION_ID>';
     ```
   - Delete support session cookie state:
     ```bash
     redis-cli DEL "support:session:<SESSION_ID>"
     ```

4. **Audit Verification**:
   - Query compliance audit logs to inspect all actions executed during the incident window:
     ```sql
     SELECT id, action, resource, "ipAddress", "createdAt"
     FROM audit_logs
     WHERE "actorId" = '<USER_ID>'
     ORDER BY "createdAt" DESC;
     ```
