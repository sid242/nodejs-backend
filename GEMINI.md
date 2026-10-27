# Gemini / Antigravity Agent Guidelines

See the complete repository guidelines and instructions in [AGENTS.md](file:///c:/Users/Siddharth%20Prajapati/Downloads/backend/node-scalable-foundation/AGENTS.md).

### Quick Summary

- **Type**: ESM Node.js + TypeScript backend (`"type": "module"`, Node >=24)
- **Path Aliases**: `@/*` mapping directly to `./src/*` across all imports
- **Frameworks**: Express, Drizzle ORM, BullMQ, Socket.IO, Pino
- **Layering**: 4-layer architecture (`modules/<name>/[name].routes.ts`, `[name].controller.ts`, `[name].service.ts`, `[name].repository.ts`, and `src/db/schema/`)
- **Responses**: Always use `AppResponse.ok()` / `AppResponse.created()` and `AppError` subclasses
- **Defensive Coding**: Always use optional chaining (`?.`) when accessing object properties or executing operations on arrays/collections (`items?.map(...)`, `data?.field`), pairing with nullish coalescing (`??`) for fallbacks
- **Permissions & RBAC**: Isolate platform staff operations (`requirePlatformAuth`) from customer tenant operations (`requireTenant`); expose dynamic context endpoints (`/tenants/:id/context`) for client-side permission-based UI rendering
- **Imports**: Clean extensionless imports (`import { db } from '@/config/db'`). Do NOT append `.js` or `.ts` to relative imports or `@/*` path aliases
- **Rules & Skills**: Full set of modular rules and runnable skills are available in `.agents/`
