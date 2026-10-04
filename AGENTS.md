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

## Testing Guidelines

Use Vitest files named `*.test.ts` or `*.test.tsx`. Run focused suites with `pnpm --filter @rover/runtime test` or `pnpm --filter @rover/app test`. Cover changed behavior, including failure paths and event/state transitions. No numeric coverage threshold is configured. Run relevant checks before submitting; sidecar changes also require smoke tests.

## Commit & Pull Request Guidelines

Recent commits commonly use `[需求] [2] …`, `[修复] [2] …`, `[重构] [2] …`, and `[文档] [2] …`; Conventional Commits also appear. Match the surrounding history and describe the concrete change. PRs should explain behavior, link relevant tickets, list validation, and include screenshots for UI changes. Update domain documentation or ADRs when changing architectural contracts.
