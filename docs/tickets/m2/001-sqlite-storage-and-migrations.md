# 001: SQLite 存储层与版本迁移机制

**Status**: TODO  
**Blocked By**: None (*Frontier*)  
**Blocks**: 004, 005, 006, 007, 008, 009  

## Context & Goal
Rover 是单用户本地桌面 Agent，Node Runtime 是本地 SQLite 唯一写入者。为支持 Rover 全局 history、Task/Session 事务、Hook 事件投影以及 WebSocket 断点重放，需要在 `@rover/runtime` 中引入稳定的 SQLite 数据库底座，配置 WAL 模式、外键约束、迁移版本管理与统一的 `runtime_event` 事务事件账本。

## Specification & Invariants
1. **依赖与环境**：
   - 使用 `better-sqlite3`（需确保 Node SEA 与跨架构构建兼容）。
   - 数据文件存储于 macOS 用户的 Application Support 目录（例如 `~/Library/Application Support/Rover/rover.db`），支持通过环境变量重写以用于自动化测试。
2. **连接配置与并发控制**：
   - 启用 `PRAGMA journal_mode = WAL;`
   - 启用 `PRAGMA foreign_keys = ON;`
   - 启用 `PRAGMA busy_timeout = 5000;`
3. **版本迁移机制 (Migrations)**：
   - 维护 `schema_migrations` 表（`version INTEGER PRIMARY KEY, applied_at TEXT`）。
   - 提供迁移执行器，按数字版本号递增执行原子 DDL/DML。
4. **统一事件序列表 (`runtime_event`)**：
   - 表结构：`event_seq INTEGER PRIMARY KEY AUTOINCREMENT, event_type TEXT NOT NULL, payload TEXT NOT NULL, created_at TEXT NOT NULL`。
   - 所有持久领域变更必须与对应的 `runtime_event` 在同一个 SQLite 事务中提交。
5. **初始化核心表 DDL**（预备空表与索引，字段详见 TRD 第 6 节）：
   - `rover_message`
   - `dispatch_attempt`
   - `session_ref`
   - `task`
   - `task_event`
   - `task_summary`
   - `activity`
   - `skill_install`

## Affected Components & Files
- `packages/runtime/package.json`
- `packages/runtime/src/storage/db.ts`
- `packages/runtime/src/storage/migrator.ts`
- `packages/runtime/src/storage/migrations/001_initial_schema.sql` (or ts)
- `packages/runtime/src/storage/events.ts`
- `packages/runtime/src/storage/types.ts`
- `packages/runtime/src/__tests__/storage.test.ts`

## Acceptance Criteria
- [ ] 在内存及本地临时目录中能成功初始化 SQLite 数据库并应用迁移脚本。
- [ ] 验证 WAL 模式与外键约束正常生效（违反外键抛出 SQLite 错误）。
- [ ] 提供统一事务包装工具 `db.transaction()`，确保领域数据写入与 `runtime_event` 递增在同一事务内完成。
- [ ] 自动化测试覆盖迁移幂等性（重复运行不报错）、并发事务超时重试与 `runtime_event` 单调递增性。

## Verification Plan
```bash
pnpm --filter @rover/runtime test packages/runtime/src/__tests__/storage.test.ts
```
