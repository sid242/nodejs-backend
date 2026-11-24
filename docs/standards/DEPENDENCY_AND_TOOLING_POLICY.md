# Dependency Modernization, Static Analysis and CI Policy

## 1. Version policy

"Latest" means latest stable, supported and compatible version for the actual application—not blindly the highest version number.

For every package:

1. Read the exact installed version from the lockfile.
2. Check the latest stable release and release date.
3. Check Node engine requirements.
4. Check peer dependency compatibility.
5. Read official changelog and migration guide for major upgrades.
6. Check known vulnerabilities and deprecations.
7. Test in a dedicated branch.
8. Update lockfile using the repository's package manager.
9. Run tests, typecheck, lint and production build.
10. Record the decision and any intentionally pinned package.

Do not use `*`, floating tags, canary, nightly or prerelease packages for production without a written ADR.

## 2. Dependency inventory

Produce a table containing:

- Package.
- Direct/transitive.
- Lockfile-resolved version.
- Declared range.
- Latest compatible stable version.
- Node/runtime requirements.
- Vulnerability status.
- Deprecated API status.
- Breaking changes.
- Upgrade decision and evidence.

Review `npm audit`/equivalent output carefully; do not blindly apply `npm audit fix --force`.

## 3. Frontend compatibility groups

Audit as groups:

- Next.js + React + React DOM + eslint-config-next.
- TypeScript + ESLint + typescript-eslint.
- Tailwind CSS v4 + `@tailwindcss/postcss` + Prettier Tailwind plugin.
- shadcn/ui generated component source + selected Radix/Base UI primitives.
- TanStack Query + devtools.
- React Hook Form + resolver + Zod.
- Vitest + test environment + React Testing Library (if present).
- Axios + browser/server separation.

Do not upgrade a framework package independently when its peer dependencies constrain the supported range.

## 4. Backend compatibility groups

Audit as groups:

- Node runtime + TypeScript + tsx + tsup + module resolution.
- Express runtime + Express type definitions + middleware ecosystem.
- Drizzle ORM + drizzle-kit + postgres driver.
- Redis client + BullMQ + Socket.IO Redis adapter.
- AWS SDK packages as a coordinated family where applicable.
- Pino + pino-http + transports.
- Zod + OpenAPI generation integration.
- JWT libraries and cookie/session implementation.
- Sentry SDK + Node runtime.

### Known manifest review candidates

At the reviewed public manifest snapshot:

- Express is declared `^4.21.2`, while `@types/express` is declared `^5.0.6`. Verify actual resolved versions and align types/runtime intentionally.
- Both `jose` and `jsonwebtoken` are declared. Inspect actual use and standardize where possible.
- ESLint explicitly disables `@typescript-eslint/no-explicit-any`.
- Several dependencies have declared ranges that deserve a freshness/security check against the lockfile. These are not proof that the installed version is outdated.

## 5. TypeScript configuration baseline

Start with:

```json
{
  "compilerOptions": {
    "strict": true,
    "noImplicitOverride": true,
    "noFallthroughCasesInSwitch": true,
    "useUnknownInCatchVariables": true
  }
}
```

Evaluate separately before enabling:

- `noUncheckedIndexedAccess`
- `exactOptionalPropertyTypes`
- `noPropertyAccessFromIndexSignature`
- `verbatimModuleSyntax`
- `isolatedModules`
- `noEmit`

Do not copy this fragment over an existing tsconfig. Merge options based on the actual build/runtime configuration and fix errors incrementally.

## 6. ESLint policy

- Use flat config and framework-aware recommended rules.
- Enable `@typescript-eslint/no-explicit-any: error`.
- Enable `@typescript-eslint/no-floating-promises` where compatible.
- Enable `@typescript-eslint/no-misused-promises` where compatible.
- Enable `@typescript-eslint/consistent-type-imports`.
- Enable `@typescript-eslint/switch-exhaustiveness-check` for discriminated unions where appropriate.
- Consider `no-non-null-assertion` and `no-unnecessary-type-assertion`.
- Use React hooks rules and Next recommended rules in frontend.
- Use import-boundary restrictions for architectural layers.
- Avoid rule duplication/conflict with Prettier.
- Do not disable a rule globally to suppress legacy violations. Use staged warning baselines and reduce them to zero.

## 7. CI gates

Required checks should include:

- Frozen lockfile install.
- Format check.
- ESLint.
- TypeScript typecheck.
- Unit tests.
- Integration tests (with disposable services).
- Production build.
- Migration generation/check consistency.
- Dependency vulnerability scan.
- Secret scanning.
- License policy if required.
- Container build and image scan for backend release.

Use CI caching safely; never let cached artifacts hide missing generated files or stale types.

## 8. Pre-commit vs CI

Pre-commit hooks should be fast: formatting, lint-staged, commit message validation. CI is authoritative. A developer can bypass a local hook; protected branch rules must not bypass CI.

## 9. Upgrade cadence

- Review security advisories continuously/automatically.
- Review patch/minor updates regularly.
- Plan framework/ORM major upgrades deliberately.
- Re-run compatibility audit after Node LTS/current runtime changes.
- Record pinned versions and rationale.
