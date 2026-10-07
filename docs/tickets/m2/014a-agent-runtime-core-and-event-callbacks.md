# 014a: AgentRuntime 纯领域核心与 Event Callbacks 契约

**Status**: TODO  
**Blocked By**: 005  
**Blocks**: 014b  

## Context & Goal

依据 [ADR-0018](../../adr/0018-multi-source-input-steer-and-follow-up-interaction.md) 与 [ADR-0019](../../adr/0019-agent-runtime-callbacks-and-decoupled-lifecycle.md)，对原 `RoverTurnEngine` 进行架构解耦。本任务构建纯净的、无数据库与网络协议外部依赖的 `AgentRuntime` 领域模型，以及通用的 `AgentRuntimeEventCallbacks` 生命周期事件回调规范，原生对齐 `@earendil-works/pi-agent-core` 的输入分流与排队接力机制。

## Specification & Invariants

1. **生命周期回调接口 (`AgentRuntimeEventCallbacks`)**：
   - 位于 `packages/runtime/src/agent/runtime/types.ts`；
   - 包含可选方法：`onTurnStart`, `onTurnStepStart`, `onMessageDelta`, `onMessageEnd`, `onToolExecutionStart`, `onToolExecutionEnd`, `onTurnEnd`, `onError`；
   - 定义 `TurnContext` 规范（携带 `turnId`, `sessionId`, `userPrompt`, `model`, `startTime`）。

2. **核心运行时 (`AgentRuntime`) 纯领域实现**：
   - 位于 `packages/runtime/src/agent/runtime/agent-runtime.ts`；
   - 支持动态管理 Callbacks：`addEventCallbacks(callbacks): () => void`；
   - 安全触发分发：`triggerCallback(method, ...args): Promise<void>`，对单个 Callback 内部抛错进行容错隔离，不阻断核心 Agent 执行；
   - 维护长寿命或受控生命周期的内部 `Agent` 实例；
   - 原生支持三模态输入接口：
     - `prompt(input)`：常规输入，**在进入底层回路前主动触发 `onTurnStart(context)` 确保前置就绪**；
     - `steer(message)`：高优先级插话纠偏，直接注入底层 `agent.steer()`，不触发 `onTurnStart`；
     - `followUp(message)`：排队追问，直接注入底层 `agent.followUp()`；
     - `clearAllQueues()`：清空所有排队消息；
     - `abortPrompt()`：安全中断当前生成。
   - 监听底层 `agent.subscribe(event)` 并转换为类型化 Callbacks：
     - `turn_start` ➔ `onTurnStepStart`；
     - `message_update` ➔ `onMessageDelta`（提取 `text_delta` 与 `thinking_delta`，保留累计文本）；
     - `message_end` ➔ `onMessageEnd`（过滤出 assistant / toolResult 消息）；
     - `tool_execution_start` ➔ `onToolExecutionStart`；
     - `tool_execution_end` ➔ `onToolExecutionEnd`；
     - `agent_end` ➔ `onTurnEnd`（计算耗时与终态），若存在排队消息则通过 `scheduleQueuedContinue()` 自动出队推进。

3. **零外部副作用原则**：
   - `AgentRuntime` 的构造函数与执行链路中严禁引入 `better-sqlite3`、`Database` 实例或 `WebSocketManager`。

## Affected Components & Files

- `packages/runtime/src/agent/runtime/types.ts`：定义 Callbacks 与 Context 契约。
- `packages/runtime/src/agent/runtime/agent-runtime.ts`：实现核心 Runtime 逻辑。
- `packages/runtime/src/__tests__/agent_runtime.test.ts`：纯内存环境的单元测试。

## Acceptance Criteria

- [ ] 在无 SQLite 数据库和无 WebSocket 的纯内存环境下，能正常实例化 `AgentRuntime` 并注册 Mock Callbacks。
- [ ] 外部调用 `prompt()` 时，能精准在前置时机收到 `onTurnStart` 回调，且携带完整的 `TurnContext`。
- [ ] 驱动 Mock 模型时，按序收到 `onTurnStepStart`、`onMessageDelta`、`onMessageEnd`、`onTurnEnd`。
- [ ] 单个 Callback 故意抛出异常时，其余 Callback 正常执行，`AgentRuntime` 不崩溃。
- [ ] 支持 `steer` 与 `followUp` 队列调度，`clearAllQueues` 能清空未消费消息。

## Verification Plan

```bash
pnpm --filter @rover/runtime test packages/runtime/src/__tests__/agent_runtime.test.ts
```
