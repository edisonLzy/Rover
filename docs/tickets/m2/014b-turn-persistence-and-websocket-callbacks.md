# 014b: Turn 消息先行持久化与 WebSocket 广播 Callbacks

**Status**: DONE  
**Blocked By**: 014a  
**Blocks**: 014c

## Context & Goal

依据 [ADR-0014](../../adr/0014-linear-rover-entries-and-compaction.md)、[ADR-0017](../../adr/0017-unified-runtime-websocket-event-bus.md) 与 [ADR-0019](../../adr/0019-agent-runtime-callbacks-and-decoupled-lifecycle.md)，将原 `AgentEventHandler` 中的 SQLite 写入与 WebSocket 广播逻辑拆分为两个符合 `AgentRuntimeEventCallbacks` 标准规范的独立实现类，实现存储与网络传输的完全解耦。

## Specification & Invariants

1. **`TurnPersistenceCallbacks`（存储层实现）**：
   - 位于 `packages/runtime/src/agent/callbacks/persistence.ts`；
   - 依赖注入 `RoverDatabase`；
   - `onTurnStart(context)`：
     - 在数据库事务内原子创建 `rover_turn (status='running')` 并写入首条 user 类型的 `rover_entry`；
   - `onMessageEnd(context, message)`：
     - 严格遵循 ADR-0014 WAL（先行落盘）原则，完整的 `assistant` 或 `toolResult` 消息生成后立即调用 `appendMessageEntry`；
     - 使用 `WeakSet<object>` 进行已持久化消息防重校验；
   - `onTurnEnd(context, result)`：
     - 更新 `rover_turn` 终态（`status = result.status`, `error = result.error`, `completedAt = Date.now()`）；
   - 上下文预算检查：在回合执行前集成既有的 `assessContextBudget`。

2. **`WebSocketBroadcastCallbacks`（网络层实现）**：
   - 位于 `packages/runtime/src/agent/callbacks/broadcast.ts`；
   - 依赖注入既有的 `WebSocketManager`；
   - 保持与既有前端协议（ADR-0017）100% 兼容：
     - `onTurnStart` ➔ 广播 `turn.started`；
     - `onTurnStepStart` ➔ 广播 `turn.step_started`；
     - `onMessageDelta` ➔ 广播 `turn.delta`（包含 `textDelta` 或 `thinkingDelta`、`accumulated`、`isThinking`）；
     - `onToolExecutionStart` ➔ 广播 `turn.tool_call`；
     - `onToolExecutionEnd` ➔ 广播 `turn.tool_result`；
     - `onTurnEnd` ➔ 广播 `turn.end`（包含 `latencyMs`、`status`、`error`）；
     - 同步记入 `runtime_event` 表以保留事件序号 `eventSeq`。

3. **独立可测试性**：
   - 编写集成测试，挂载两个 Callbacks 到 `AgentRuntime`，验证从用户输入到落库及广播的全生命周期闭环。

## Affected Components & Directory Structure

```text
packages/runtime/
├── src/
│   ├── __tests__/
│   │   └── + [New] runtime_callbacks.test.ts      # 持久化与广播 Callbacks 的集成测试
│   └── agent/
│       ├── * [Modified] runtime.ts                # 完善异常捕获、提前中断识别与 Callbacks 分发
│       └── callbacks/
│           ├── + [New] persistence.ts             # Turn 消息先行持久化实现类
│           └── + [New] broadcast.ts               # WebSocket 广播实现类
```

## Acceptance Criteria

- [x] `TurnPersistenceCallbacks` 在 `onTurnStart` 时正确创建 `rover_turn` 和 user entry，在 `onMessageEnd` 时追加 assistant/toolResult entry，在 `onTurnEnd` 时更新状态。
- [x] 若在模型调用中途模拟抛错，数据库中的 `rover_turn` 正确置为 `failed` 且记录了 `error`。
- [x] `WebSocketBroadcastCallbacks` 能够将事件按正确格式推送到已连接的 WebSocket 客户端。
- [x] 新的回调体系下，数据落库的格式与旧 `RoverTurnEngine` 完全兼容。

## Verification Plan

```bash
pnpm --filter @rover/runtime test packages/runtime/src/__tests__/runtime_callbacks.test.ts
```
