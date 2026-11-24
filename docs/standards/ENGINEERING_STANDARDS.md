# Shared Engineering Standards — TypeScript, JavaScript and Code Design

These standards apply to both repositories unless a framework-specific document overrides them.

## 1. Guiding principles

- Prefer simple, explicit, readable code over clever abstractions.
- Optimize for correctness and changeability, not minimum line count.
- Keep functions focused and side effects visible.
- Validate untrusted data at system boundaries.
- Make illegal states difficult to represent.
- Use types to communicate domain meaning.
- Do not abstract code until there is a real reuse or complexity benefit.
- Avoid both giant files and excessive one-line wrapper files.
- Comments explain _why_, not restate _what_ the code does.

## 2. Control flow: choose the right construct

### Guard clauses for early exits

```ts
function getDisplayName(user: User | null): string {
  if (!user) return 'Unknown user';
  if (!user.isActive) return 'Inactive user';

  return `${user.firstName} ${user.lastName}`;
}
```

### `switch` for finite cases / discriminated unions

```ts
type PaymentState =
  { status: 'pending' } | { status: 'paid'; paidAt: Date } | { status: 'failed'; reason: string };

function getPaymentLabel(payment: PaymentState): string {
  switch (payment.status) {
    case 'pending':
      return 'Awaiting payment';
    case 'paid':
      return `Paid on ${payment.paidAt.toISOString()}`;
    case 'failed':
      return `Failed: ${payment.reason}`;
    default:
      return assertNever(payment);
  }
}

function assertNever(value: never): never {
  throw new Error(`Unhandled variant: ${JSON.stringify(value)}`);
}
```

Use exhaustive switches for important domain state machines. Avoid a switch with many repeated assignments if a lookup is clearer.

### Lookup object for static mappings

```ts
const statusLabels = {
  active: 'Active',
  pending: 'Pending',
  suspended: 'Suspended',
} as const satisfies Record<AccountStatus, string>;

const label = statusLabels[status];
```

Use `Record` when the key space is known and complete. Use `Map` when keys are dynamic or object identity matters. Do not use an object lookup when the logic is genuinely procedural.

### Avoid nested ternaries

Prefer named functions, guard clauses, or `switch` when branching becomes hard to scan.

## 3. Truthiness, optional chaining and fallback correctness

JavaScript falsy values include `false`, `0`, `-0`, `0n`, `''`, `null`, `undefined` and `NaN`.

### Use `??` when only null/undefined should trigger a fallback

```ts
const pageSize = input.pageSize ?? 25; // preserves 0; validate if 0 is invalid
```

### Use `||` only when every falsy value intentionally means absent

```ts
const searchLabel = userProvidedLabel || 'Untitled';
```

### Avoid truthiness when zero/false/empty string are valid

```ts
if (quantity !== undefined && quantity !== null) {
  // quantity may legitimately be 0
}
```

### Optional chaining is for genuinely optional paths

```ts
const city = profile.address?.city;
```

Do not write `response?.data?.items ?? []` if a missing `data` means an API contract violation. Validate the response and surface the error instead of silently converting malformed responses into empty success.

### Avoid unsafe defaulting

Bad:

```ts
const isEnabled = config.isEnabled || true;
```

Correct:

```ts
const isEnabled = config.isEnabled ?? true;
```

## 4. Types

- `strict: true`; progressively enable `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `noImplicitOverride`, `noFallthroughCasesInSwitch` and other suitable checks after assessing compatibility.
- No `any`, including generic escape hatches.
- Use `unknown` for untrusted values and narrow with Zod/type guards.
- Prefer discriminated unions over loosely related optional fields.
- Prefer `type` for unions/intersections and `interface` when extension/merging is intentionally useful; consistency matters more than dogma.
- Use `satisfies` to validate object shape while retaining literal inference.
- Use `as const` for immutable static configuration, not as a way to silence type errors.
- Avoid non-null assertions. Prove existence with guards or model the invariant.
- Avoid broad `as SomeType`; parse/validate at boundaries.
- Use branded/opaque types selectively for IDs that must not be mixed.
- Use generics when they preserve meaningful relationships, not to make signatures intimidating.
- Never use `Function`, `{}`, or `object` as lazy substitutes for a precise type.
- Avoid `Record<string, any>`; use `Record<string, unknown>` or a domain type.

## 5. Functions and naming

- Use verbs for functions: `createInvoice`, `resolveTenant`, `canUpdateLead`.
- Boolean names should read as predicates: `isActive`, `hasPermission`, `canEdit`.
- Avoid vague names: `data`, `item`, `result`, `handleThing`, `process`.
- Keep parameters few; use a named options object when there are several related options.
- Avoid functions with unrelated responsibilities or deeply nested control flow.
- Return early for invalid/precondition cases.
- Avoid boolean positional arguments; use an options object or explicit union.
- Do not mutate caller-owned objects unless mutation is the documented contract.
- Keep pure transformations pure; isolate IO at boundaries.
- Avoid unnecessary `async` when no await is required.
- Always await or deliberately return promises; do not leave floating promises.

## 6. Errors

- Never swallow errors silently.
- Catch only when you can recover, add context, translate the error, or perform cleanup.
- Preserve original causes: `new AppError(message, { cause })`.
- Do not expose SQL, stack traces, provider internals, secrets or raw exception messages to clients.
- Do not use exceptions for ordinary expected branching when a typed result is clearer.
- Define stable error codes for API contracts.
- Distinguish validation, authentication, authorization, not-found, conflict, rate-limit and unexpected errors.
- Log once at the appropriate boundary; avoid duplicate logging at every layer.

## 7. Async and concurrency

- Use `Promise.all` only when operations are independent and concurrency is safe.
- Use `Promise.allSettled` when partial failure is expected and must be handled.
- Bound concurrency for bulk work.
- Use `AbortSignal` for cancellable network/database-adjacent operations where supported.
- Avoid fire-and-forget tasks unless explicitly supervised and errors are observed.
- Add timeouts to external calls.
- Retry only transient errors; use bounded exponential backoff with jitter.
- Make retried mutations idempotent.

## 8. Objects, arrays and immutability

- Prefer `map`, `filter`, `some`, `every`, `find` for clear transformations.
- Use `reduce` only when it improves clarity; do not turn simple mapping into a dense reduce.
- Use `Object.hasOwn` for safe own-property checks.
- Use `Map`/`Set` for dynamic lookup/deduplication when appropriate.
- Avoid repeated linear searches inside loops; build a map/set for larger collections.
- Use immutable updates in React state.
- Avoid mutating shared module-level objects.
- Validate array index access when `noUncheckedIndexedAccess` is enabled.

## 9. Modules and boundaries

- Keep domain logic independent from transport/framework details.
- Separate validation schemas, domain types, application services, persistence and HTTP adapters.
- Avoid circular dependencies.
- Import from public module APIs rather than deep private paths.
- Avoid giant barrel files that create cycles or mix server/client modules.
- Mark server-only modules explicitly where supported.
- Avoid utility dumping grounds. Put helpers near their domain until genuinely shared.
- Do not create abstractions with only one trivial caller without a clear reason.

## 10. Comments and documentation

- Remove stale or misleading comments.
- Explain non-obvious invariants, security decisions and workarounds.
- Document exported public APIs and complex domain rules.
- Use ADRs for architectural decisions with meaningful trade-offs.
- Never leave commented-out code as a substitute for version control.

## 11. Security and privacy

- Treat all client input, headers, webhooks, files and external service data as untrusted.
- Never log passwords, tokens, cookies, authorization headers, payment secrets or sensitive PII.
- Use allowlists for dynamic SQL identifiers, file types and redirect destinations.
- Encode output appropriately; sanitize rich HTML at the rendering boundary.
- Enforce authorization server-side on every protected operation.
- Keep secrets in environment/secret management systems and validate configuration at startup.

## 12. Code review checklist

- Is the behavior obvious from the name and types?
- Are null, undefined, false, zero and empty string handled intentionally?
- Is input validated at the boundary?
- Are all promises and errors handled?
- Are authorization and tenant scope enforced at the correct layer?
- Is the code testable without mocking half the application?
- Is the abstraction justified?
- Does the code introduce hidden coupling or duplicate logic?
- Are logs safe and useful?
- Are tests proving behavior and edge cases?
