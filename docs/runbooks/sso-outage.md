# Runbook: Enterprise SSO & Identity Provider Outage

## Severity: HIGH (P1)

### Trigger

Alerts indicating spikes in 401/403 errors on `/api/v1/sso/saml/callback` or `/api/v1/sso/oidc/callback`, or tenant employees locked out due to IdP downtime / certificate expiration.

---

### Immediate Diagnostics

1. **Check SSO Enforcement & Provider Configuration**:
   ```sql
   SELECT id, "providerType", status, "enforceSso", "allowedDomains", "idpEntityId", "idpSsoUrl"
   FROM tenant_sso_configs
   WHERE "tenantId" = '<TENANT_ID>';
   ```
2. **Review IdP Certificate Validity**:
   - Check if IdP X.509 certificate has expired or rotated without notice:
     ```bash
     openssl x509 -in <CERT_FILE> -noout -dates
     ```
3. **Inspect CloudWatch SSO Logs**:
   Filter `/ecs/app-api` for `logger: sso` and `event: SSO_CALLBACK_FAILED`. Check if the failure reason is clock skew, invalid signature, or missing nameID.

---

### Remediation & Break-Glass Procedures

1. **Break-Glass Password Access for Tenant Owner**:
   - Tenant `OWNER` users with `ssoBypass: true` can log in using their primary credentials even while SSO is enforced:
     ```sql
     UPDATE tenant_members
     SET "ssoBypass" = true
     WHERE "tenantId" = '<TENANT_ID>' AND "role" = 'OWNER' AND "userId" = '<OWNER_USER_ID>';
     ```
   - This event is recorded to the compliance audit log as `SSO.BREAK_GLASS_BYPASS`.

2. **Temporary Emergency Disabling of SSO Enforcement**:
   - If the identity provider has prolonged downtime (e.g., global Okta or Azure AD outage):
     ```sql
     UPDATE tenant_sso_configs
     SET "enforceSso" = false
     WHERE "tenantId" = '<TENANT_ID>';
     ```
   - Notify tenant members that password fallback / magic-link authentication is temporarily accessible.

3. **Renew IdP Metadata & Re-Enable**:
   - When the IdP certificate or endpoints are restored:
     - Update `tenant_sso_configs` with the new certificate or OIDC discovery document.
     - Execute test connection verification via `POST /api/v1/tenants/:id/sso/test`.
     - Re-enable `enforceSso = true`.
