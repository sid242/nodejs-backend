# Gemini / Antigravity Agent Guidelines

See the complete repository guidelines and instructions in [AGENTS.md](file:///c:/Users/Siddharth%20Prajapati/Downloads/backend/node-scalable-foundation/AGENTS.md).

### Quick Summary

- **Type**: ESM Node.js + TypeScript backend (`"type": "module"`, Node >=20.6)
- **Path Aliases**: `@/*` mapping directly to `./src/*` across all imports
- **Frameworks**: Express, Drizzle ORM, BullMQ, Socket.IO, Pino
- **Layering**: 4-layer architecture (`modules/<name>/[name].routes.ts`, `[name].controller.ts`, `[name].service.ts`, `[name].repository.ts`, and `src/db/schema/`)
- **Responses**: Always use `AppResponse.ok()` / `AppResponse.created()` and `AppError` subclasses
- **Rules & Skills**: Full set of modular rules and runnable skills are available in `.agents/`
