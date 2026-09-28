# 004: 全局 History 与 Compaction 存储

**Status**: TODO  
**Blocked By**: 001  
**Blocks**: 005  

## Context & Goal
根据 [ADR-0001](file:///Users/zhiyu/Desktop/coding/Rover/docs/adr/0001-global-rover-history.md) 与 CONTEXT.md，Rover 是跨用户目标的桌面 Agent，不按项目划分历史会话，而是沿用一份全局持续的 Rover Agent history。为避免多轮对话超出模型的 Context Window 限制，需要在 SQLite `rover_message` 表之上建立历史持久化仓储与 Compaction（压缩摘要）机制，同时保留关键锚点信息。

## Specification & Invariants
1. **全局 History 持久化 (`rover_message`)**：
   - 字段：`id TEXT PRIMARY KEY, turn_id TEXT NOT NULL, role TEXT NOT NULL, content TEXT NOT NULL, token_estimate INTEGER, is_compacted INTEGER DEFAULT 0, created_at TEXT NOT NULL`；
   - 支持插入单轮消息（`user`, `assistant`, `tool`）并在同一事务中更新 `runtime_event`；
   - 提供按时间正序加载全部有效上下文的方法 `getEffectiveHistory(limitTokens)`。
2. **上下文估算与 Compaction 策略**：
   - 每次追加消息时累加 Token 估算量（基于字符启发式算法或专用 tokenizer）；
   - 当有效上下文超出安全阈值（如模型最大上下文的 70%）时触发 Compaction：
     - 将老旧回合的纯文本对话压缩为系统摘要条目（`role: "system", content: "..."`）；
     - **锚点保留不变式**：涉及 Task 派发事实、关键操作结论以及外部引用（如 Task ID、仓库路径）必须显式提取至摘要中作为 Anchor，不得随压缩丢失。
3. **隔离性约定**：
   - 待处理 Prompt 队列（尚未开启回合的输入）保存在 UI 内存，不得提前写入 `rover_message`；
   - 外部未确认的 Inbox 消息或原始 CLI 终端输出不得直接进入全局 History。

## Affected Components & Files
- `packages/runtime/src/storage/repositories/history.ts`
- `packages/runtime/src/agent/compaction.ts`
- `packages/runtime/src/storage/types.ts`
- `packages/runtime/src/__tests__/history.test.ts`

## Acceptance Criteria
- [ ] 跨回合顺序写入消息，能够正确读取并组装为完整的会话历史数组。
- [ ] 当模拟历史记录累计达到阈值时，自动触发压缩，将旧记录归约为带锚点的摘要消息。
- [ ] 压缩后的有效 Token 显著下降，且关键任务 ID 和仓库标识仍完整保存在最新有效上下文中。

## Verification Plan
```bash
pnpm --filter @rover/runtime test packages/runtime/src/__tests__/history.test.ts
```
