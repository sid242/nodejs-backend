# PBAC Coverage and Architecture Documentation

## Overview
Policy-Based Access Control (PBAC) operates alongside role-based permission checks (RBAC) to enforce fine-grained, attribute-level authorization rules. While RBAC verifies whether a user holds high-level privileges (e.g. `leads:read`), PBAC dynamically inspects context:
- **Actor attributes**: `actor.userId`, `actor.memberId`, `actor.departmentId`, `actor.regionId`, `actor.roleKeys`
- **Resource attributes**: `resource.id`, `resource.departmentId`, `resource.regionId`, `resource.assignedMemberId`, `resource.isConfidential`, etc.
- **Environment attributes**: `env.currentTime`, `env.ip`

---

## Covered Modules

| Module | Route / Operation | PBAC Middleware / Service Enforcement | Scope Compilation (SQL) |
| :--- | :--- | :--- | :--- |
| **Leads (CRM)** | `GET /leads` | Default-deny enforcement via `compileQueryScope` in `leadsService.listLeads` | Yes (`leads` table columns filtered by policy tree) |
| **Leads (CRM)** | `POST /leads` | `requirePolicy({ resource: 'leads', action: 'create', getTargetResource: req => req.body })` | N/A (Evaluates proposed resource) |
| **Leads (CRM)** | `GET /leads/:id` | `requirePolicy({ resource: 'leads', action: 'read', getTargetResource: ... })` | N/A (Row-level evaluation) |
| **Leads (CRM)** | `PATCH /leads/:id` | `requirePolicy({ resource: 'leads', action: 'update' })` + Service-layer escalation protection checking both existing & merged state, plus `leads:reassign` and `leads:set_confidential` actions | N/A (Evaluates both pre- and post-mutation state) |
| **Leads (CRM)** | `DELETE /leads/:id` | `requirePolicy({ resource: 'leads', action: 'delete' })` | N/A (Row-level evaluation) |
| **Tenants** | `GET /tenants/:id` | `requirePolicy({ resource: 'tenants', action: 'read' })` | N/A |
| **Billing** | `GET /billing/*` | Guarded via RBAC `billing:read` and `billing:manage` + tenant membership boundary | Tenant scoped |
| **Policies** | `GET /policies/registry` | `requirePermission('roles:read')` exposes metadata registry for UI builders | N/A |
| **Policies** | `POST /policies/evaluate` | `requirePermission('roles:read')` dry-run evaluation endpoint | N/A |

---

## Security Invariants

1. **Default Deny**:
   - For all non-owner and non-support actors, list queries require active allow policies. If no roles or no matching allow policy exist, list returns empty (`{ items: [], total: 0 }`).
2. **Priority Tiers**:
   - Policies are grouped and evaluated in tiers sorted by `priority` descending.
   - Within a priority tier, `deny` overrides `allow`.
   - An `allow` in a higher priority tier overrides all policies in lower priority tiers.
3. **Escalation Protection**:
   - Updates must satisfy policies for both the current record state AND the proposed merged record state (`{ ...existing, ...patch }`).
   - Sensitive reassignments (`assignedMemberId`, `departmentId`, `regionId`, `isConfidential`) require explicit dedicated actions.
4. **Fail-Closed Compiler & Evaluator Parity**:
   - Unrecognized attributes or uncompilable operators compile to `1 = 0` SQL expression, preventing permission expansion.
   - Evaluator evaluates an object without valid condition branches (`all`, `any`, `none`, `attribute`) as `false`.
5. **Trace Sanitization**:
   - Evaluation traces (`traces`) containing policy names, IDs, and match reasons are never leaked in client 403 responses. Traces are logged server-side with `requestId`.
6. **Support Session Boundaries**:
   - Support staff sessions cannot access confidential records unless granted explicit `FULL_ADMIN` scope.
