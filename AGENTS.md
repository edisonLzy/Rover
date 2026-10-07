# Repository Guidelines

## Project Structure & Module Organization

Rover is a pnpm/Turborepo workspace for a Tauri desktop app and a Node.js agent runtime.

- `packages/app/src/`: React UI; organize screen-specific code under `features/`, reusable components under `components/`, and cross-window preferences under `shared/`.
- `packages/app/src-tauri/`: Rust desktop integration, sidecar lifecycle, capabilities, and icons.
- `packages/app/resources/skills/`: bundled skills and their supporting assets; UI assets live in `packages/app/src/assets/`.
- `packages/runtime/src/`: agent execution, transport, observation, models, and SQLite storage. Public contracts are exported through `expose.ts`.
- Both packages keep tests in `src/__tests__/`. `docs/` contains architecture decisions, tickets, prototypes, and troubleshooting; `CONTEXT.md` defines domain terminology.

## Build, Test, and Development Commands

Use Node `24.21.0` from `.node-version`, pnpm `10.11.0`, and a Rust toolchain for desktop work.

- `pnpm install --frozen-lockfile`: install workspace dependencies.
- `pnpm dev`: run desktop development and the runtime TypeScript watcher.
- `pnpm dev:web`: run the Vite UI independently.
- `pnpm build`: build both TypeScript packages and the UI.
- `pnpm build:app`: build the runtime executable and Tauri release app.
- `pnpm typecheck`, `pnpm lint:check`, `pnpm format:check`: validate types, lint, and formatting; `pnpm format` applies formatting.
- `pnpm test`: run workspace Vitest suites.
- `cargo test --manifest-path packages/app/src-tauri/Cargo.toml`: run Rust tests.
- `pnpm build:sea && pnpm smoke:sea`: build and verify the standalone runtime sidecar.

## Coding Style & Naming Conventions

Use strict TypeScript and ESM imports with `.js` suffixes for local modules. Oxfmt enforces two-space indentation, single quotes, semicolons, ES5 trailing commas, and a 100-column width. Oxlint checks correctness. Use PascalCase for React components and types, camelCase for functions and variables, and `use…` for hooks. Follow neighboring module naming. Persist and synchronize cross-WebView state; module memory is separate per window.

## Module Architecture & File Discipline

- **Intentional Module Facades & Controlled Exports**: In modular domain architectures (such as `modules/<domain>/`), an `index.ts` file is encouraged as an explicit public facade that defines the minimal public contract of the module (prefer explicit named exports, e.g. `export { TaskService } from './service.js'`). External modules should consume the module through this facade rather than reaching into deep private internals. However, avoid indiscriminate barrel files that blindly re-export entire directories or child folders via `export *`, as this obscures dependencies, hinders tree-shaking, and causes circular references. Within a module, internal sibling files should import directly from specific module source files using exact relative paths with `.js` extensions (e.g. `import { Task } from './types.js'`).
- **No Exploratory or Scratch Files**: Do not generate exploratory test scripts, scratchpads, or barrier files directly inside the repository tree. All behavioral exploration and verification must be done via memory-based Vitest unit tests in `src/__tests__/` or temporary test fixtures that are cleaned up immediately.

## Ticket & Specification Guidelines

All tasks in `docs/tickets/` follow Matt Pocock's Tracer-Bullet Ticket methodology. When authoring or revising tickets:

- **Explicit Directory Tree & File Inventory**: Every ticket must include an explicit ASCII directory tree under an `Affected Components & Directory Structure` section.
- **Strict File Status Annotations**: Clearly label all affected files:
  - `+ [New]`: Planned new files with explicit file paths and single-responsibility descriptions.
  - `* [Modified]`: Existing files to be changed, specifying the scope of modification.
  - `- [Deleted/Moved]`: Files to be removed, deprecated, or relocated.
- **Strict Scope Boundaries**: Agents must never invent arbitrary file layouts or scaffold unapproved files outside the agreed-upon ticket directory tree.

## Testing Guidelines

Use Vitest files named `*.test.ts` or `*.test.tsx`. Run focused suites with `pnpm --filter @rover/runtime test` or `pnpm --filter @rover/app test`. Cover changed behavior, including failure paths and event/state transitions. No numeric coverage threshold is configured. Run relevant checks before submitting; sidecar changes also require smoke tests.

## Commit & Pull Request Guidelines

Recent commits commonly use `[需求] [2] …`, `[修复] [2] …`, `[重构] [2] …`, and `[文档] [2] …`; Conventional Commits also appear. Match the surrounding history and describe the concrete change. PRs should explain behavior, link relevant tickets, list validation, and include screenshots for UI changes. Update domain documentation or ADRs when changing architectural contracts.
