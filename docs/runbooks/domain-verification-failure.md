# Runbook: Custom Domain Verification & TLS Provisioning Failure

## Severity: MEDIUM (P2)

### Trigger

Alerts indicating `DOMAIN_VERIFICATION_FAILED` or Caddy On-Demand TLS handshake rejection on custom domain `portal.customer.com`.

---

### Immediate Diagnostics

1. **Verify DNS CNAME Propagation**:
   - Query DNS directly:
     ```bash
     dig +short CNAME portal.customer.com
     ```
   - Must resolve to `CUSTOM_DOMAIN_CNAME_TARGET` (e.g. `cname.example.com`).
2. **Inspect Tenant Domain Verification Record**:
   ```sql
   SELECT "customDomain", "customDomainVerified", "urlStyle", "status"
   FROM tenant_branding
   JOIN tenants ON tenants.id = tenant_branding."tenantId"
   WHERE "customDomain" = 'portal.customer.com';
   ```
3. **Check Caddy Allowed Domains Endpoint**:
   - Query internal API endpoint:
     ```bash
     curl -s "http://localhost:3000/internal/domains/allowed?domain=portal.customer.com"
     ```
   - If response is 404, verify that `tenant_branding.customDomainVerified = true` and tenant is active.

---

### Remediation Steps

1. **If DNS CNAME is Incorrectly Configured by Customer**:
   - Advise tenant administrator to add the following record in their DNS registrar:
     - **Host**: `portal` (or custom prefix)
     - **Type**: `CNAME`
     - **Target**: `cname.example.com`
     - **TTL**: `300` (5 minutes)
2. **Trigger On-Demand Verification**:
   - Execute verification endpoint:
     ```bash
     curl -X POST -H "Authorization: Bearer <TOKEN>" \
          http://localhost:3000/api/v1/tenants/<TENANT_ID>/branding/verify-domain
     ```
3. **Flush Invalidation in Redis**:
   ```bash
   redis-cli DEL "branding:resolve:portal.customer.com"
   ```
