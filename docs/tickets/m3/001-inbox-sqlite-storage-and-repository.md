# 001: Inbox SQLite 存储层与事件去重仓储

**Status**: DONE  
**Blocked By**: None (*Frontier*)  
**Blocks**: 003, 005  

## Context & Goal

根据 [ADR-0005](../../adr/0005-remote-inbox-outbox.md)、[ADR-0018](../../adr/0018-multi-source-input-steer-and-follow-up-interaction.md) 及 [Rover Inbox 投递协议 v1](../../architecture/Rover%20Inbox%20%E6%8A%95%E9%80%92%E5%8D%8F%E8%AE%AE%20v1.md)，外部投递至 Rover 的异步事件（如企业微信 @ 提问、监控告警）需在本地进行可靠持久化与状态流转。
本 Ticket 旨在为 `@rover/runtime` 引入版本化数据库迁移（`002_inbox_schema.sql`）以及 `InboxRepository` 仓储实现，提供原子入库、`sourceId + sourceEventId` 投递幂等消重、`sourceId + sourceMessageId` 高修订状态合并，以及未读计数与一键交办状态标记能力。

## Specification & Invariants

1. **Schema 迁移契约 (`002_inbox_schema.sql`)**：
   - **`inbox_event` (事件日志与幂等去重表)**：
     - `id TEXT PRIMARY KEY`
     - `source_id TEXT NOT NULL`
     - `source_event_id TEXT NOT NULL`
     - `received_at INTEGER NOT NULL`
     - `payload TEXT NOT NULL CHECK (json_valid(payload))`
     - `UNIQUE(source_id, source_event_id)`：唯一约束确保同一来源事件的至少一次投递幂等去重。
   - **`inbox_message` (消息业务投影表)**：
     - `id TEXT PRIMARY KEY`（生成格式为 `inbox_xxx`）
     - `source_id TEXT NOT NULL`
     - `source_message_id TEXT NOT NULL`
     - `revision INTEGER NOT NULL DEFAULT 1`
     - `kind TEXT NOT NULL`
     - `title TEXT NOT NULL`
     - `summary TEXT`
     - `url TEXT`
     - `status TEXT NOT NULL CHECK (status IN ('unread', 'read', 'delegated', 'resolved'))`
     - `task_id TEXT REFERENCES task(id) ON DELETE SET NULL`
     - `occurred_at INTEGER NOT NULL`
     - `created_at INTEGER NOT NULL`
     - `updated_at INTEGER NOT NULL`
     - `payload TEXT CHECK (payload IS NULL OR json_valid(payload))`
     - `UNIQUE(source_id, source_message_id)`：标识同一条业务消息。
2. **幂等性与修订合并规则**：
   - 若 `inbox_event` 中已存在 `(source_id, source_event_id)`，直接忽略并返回未变更；
   - 若对应业务消息已存在：
     - 当新事件的 `revision > 当前 revision`：更新标题、摘要、payload 及 `revision`；如果当前状态为 `'resolved'`，高修订不可倒退回 `'unread'`；
     - 当新事件的 `revision <= 当前 revision`：拒绝覆盖状态，保留现有消息。
3. **仓储操作方法**：
   - `ingestEvent(event: IncomingInboxEvent)`: 在单个 SQLite 事务中完成 event 记录与 message 投影更新；
   - `listMessages(options?: { status?: string; limit?: number })`: 查询列表，默认按 `occurred_at DESC` 排序；
   - `getUnreadCount()`: 查询 `status = 'unread'` 计数；
   - `markAsRead(ids: string[])`: 批量将 `unread` 推进为 `read`；
   - `markDelegated(id: string)`: 用户交办开启回合时将消息推进为 `delegated`（`task_id` 为空）；
   - `linkTask(id: string, taskId: string)`: Rover Agent 真正派发并创建任务后关联 `task_id`（受外键约束防护）。

## Affected Components & Directory Structure

```text
packages/runtime/
├── src/
│   ├── infrastructure/
│   │   └── database/
│   │       └── migrations/
│   │           ├── + [New] 002_inbox_schema.sql         # Inbox 核心表迁移 DDL
│   │           └── * [Modified] index.ts                # 注册 002 迁移脚本
│   ├── modules/
│   │   └── inbox/
│   │       ├── + [New] types.ts                         # 消息持久化实体契约
│   │       └── + [New] repository.ts                    # SQLite 仓储与事务实现
│   └── __tests__/
│       └── + [New] inbox_repository.test.ts             # 仓储与迁移单测
```

## Acceptance Criteria

- [x] SQLite 迁移 `002_inbox_schema.sql` 在内存和真实数据库中执行成功并更新 `schema_migrations`。
- [x] 同一 `source_id + source_event_id` 重复写入时幂等忽略，不产生重复记录。
- [x] 相同 `source_id + source_message_id` 的高修订版本能正确更新消息内容，低修订版本不覆盖。
- [x] `getUnreadCount` 准确统计未读条数；`markAsRead` 成功将状态转为 `read` 并减小未读数。
- [x] `markDelegated` 成功将状态推进至 `delegated`；`linkTask` 成功在受外键约束保护下回填 `task_id`。

## Verification Plan

```bash
pnpm --filter @rover/runtime test packages/runtime/src/__tests__/inbox_repository.test.ts
```
