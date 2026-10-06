# 014: Runtime 支持 Steer、Follow-Up 与 Queue 状态同步契约

**Status**: TODO  
**Blocked By**: 005  
**Blocks**: 016, 017, 018  

## Context & Goal

依据 [ADR-0018](../../adr/0018-multi-source-input-steer-and-follow-up-interaction.md)，在 `@rover/runtime` 侧对齐 `@earendil-works/pi-agent-core` 原生的 `steeringQueue` 与 `followUpQueue` 机制，为前端暴露类型安全的 `steer`、`followUp` 与 `clearAllQueues` 接口，并通过 WebSocket 广播消费出队事件，确保前端待办 Pill 与底层 Agent 队列绝对同构。

## Specification & Invariants

1. **底层引擎对齐**：
   - 在 `RoverTurnEngine` 中暴露 `steer(turnId, promptDoc)`、`followUp(turnId, promptDoc)` 与 `clearAllQueues()` 方法；
   - 映射到当前活动 `Agent` 实例的 `agent.steer(message)`、`agent.followUp(message)` 与 `agent.clearAllQueues()`；
   - 若当前无活动 Agent（空闲态），`followUp` 与 `steer` 调用应给出明确错误或降级为普通 `startTurn`。
2. **tRPC 路由契约**：
   - 在 `packages/runtime/src/transport/router.ts` 中新增 mutation：
     - `turns.steer`: 接收 `{ turnId?: string, promptDoc: PromptDocumentV1 }`；
     - `turns.followUp`: 接收 `{ turnId?: string, promptDoc: PromptDocumentV1 }`；
     - `turns.clearAllQueues`: 接收 `{ turnId?: string }`。
3. **消费出队事件广播**：
   - 当 `pi-agent-core` 消费 `followUpQueue` 或 `steeringQueue` 时，其内部派发的 `{ type: "message_start", message }` 和 `{ type: "message_end", message }` 事件必须通过既有的 `WebSocketManager` 进行类型化广播；
   - 广播载荷需携带原始的 `UserMessage`（包含其 `timestamp`、`content` 与 `kind: "steering" | "follow-up"`），供前端作为精确出队（Eviction）的信号。
4. **历史写入不变式**：
   - `follow-up` 消息被消费启动新轮次后，按既有 ADR-0014 规范持久化到 `rover_entry`（作为新的用户消息输入）；
   - 排队中尚未被消费的 `follow-up` 不写入 `rover_entry`；
   - `steer` 消息在消费后记录入当前轮次的历史上下文。

## Affected Components & Files

- `packages/runtime/src/agent/engine.ts`：扩展 `RoverTurnEngine` 接口与 `Agent` 队列方法转发。
- `packages/runtime/src/transport/router.ts`：新增 `turns.steer`、`turns.followUp`、`turns.clearAllQueues` mutation。
- `packages/runtime/src/types/events.ts` 与 `expose.ts`：确保 `turn.message_start` / `turn.message_end` 契约完备导出。
- `packages/runtime/src/__tests__/turns.test.ts`：新增针对 steer、followUp 与 clearAllQueues 的单元与集成测试。

## Acceptance Criteria

- [ ] 活动回合中调用 `turns.followUp` 成功将消息注入 `pi-agent-core` 的 `followUpQueue`，不抛错且不提前终结当前回合。
- [ ] 活动回合中调用 `turns.steer` 成功将消息注入 `steeringQueue`，在下一个检查点前优先被模型读取。
- [ ] 调用 `turns.clearAllQueues` 成功清空所有排队消息。
- [ ] 当底层出队消费某一 follow-up 消息时，WebSocket 派发包含该消息 `timestamp` 的 `message_start` 事件。
- [ ] follow-up 消费执行完成后，按既有规范记录 `rover_entry`。

## Verification Plan

- 编写模拟长轮次生成测试，在生成中途调用 `followUp`，验证当前回合正常完成，随后紧接着触发第二轮且派发出队事件。
- 在工具执行中途调用 `steer`，验证 steering 消息在工具执行完毕后优先进入上下文。
- 执行 `pnpm --filter @rover/runtime test` 确保全量通过。

## Out of Scope

前端气泡渲染、输入栏按键绑定、剪贴板嗅探、SQLite 外部 Inbox 表持久化。
