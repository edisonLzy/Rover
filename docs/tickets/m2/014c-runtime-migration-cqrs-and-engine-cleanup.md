# 014c: Transport 路由切换、CQRS 查询剥离与老旧 Engine/Handler 下线清理

**Status**: TODO  
**Blocked By**: 014b  
**Blocks**: 016, 017  

## Context & Goal

依据 [ADR-0018](../../adr/0018-multi-source-input-steer-and-follow-up-interaction.md) 与 [ADR-0019](../../adr/0019-agent-runtime-callbacks-and-decoupled-lifecycle.md)，将 `@rover/runtime` 的传输层路由（tRPC / WebSocket）全面切换至新重构的 `AgentRuntime` 与 Callbacks 架构，按照 CQRS 原则剥离纯只读查询方法，并物理删除已废弃的旧版 `RoverTurnEngine` 与 `AgentEventHandler`，彻底解除对前端 016 与 017 的阻塞。

## Specification & Invariants

1. **单例与工厂装配 (`getDefaultAgentRuntime`)**：
   - 在 `packages/runtime/src/agent/index.ts` 导出 `getDefaultAgentRuntime()`；
   - 自动组装 `ModelRegistry`、`BuiltinSkillService`、`TurnPersistenceCallbacks` 与 `WebSocketBroadcastCallbacks`。

2. **tRPC 路由全面对接 (`packages/runtime/src/transport/router.ts`)**：
   - `turns.start`：调用 `agentRuntime.prompt()`，前置启动回合；
   - `turns.cancel`：调用 `agentRuntime.abortPrompt()` 中断当前执行；
   - `turns.steer`：调用 `agentRuntime.steer()` 进行插话纠偏（契合 ADR-0018 原生队列）；
   - `turns.followUp`：调用 `agentRuntime.followUp()` 进行排队追加（契合 ADR-0018 原生队列）；
   - `turns.clearAllQueues`：调用 `agentRuntime.clearAllQueues()`；
   - **CQRS 剥离**：
     - `turns.get` 移去 Engine 包装，改为直接调用 `getRoverTurn(db, id)` 与 `getTurnEntries(db, id)`。

3. **测试迁移与全面验证**：
   - 迁移现有的 `turns.test.ts`、`handler.test.ts` 与 `engine_tools.test.ts`，使其全面运行在新的 `AgentRuntime` 架构之上；
   - 确保全量测试绿灯通过。

4. **老旧代码下线清理**：
   - 物理删除 `packages/runtime/src/agent/engine.ts`；
   - 物理删除 `packages/runtime/src/agent/handler.ts`；
   - 清理所有无用导入与死代码。

## Affected Components & Files

- `packages/runtime/src/transport/router.ts`
- `packages/runtime/src/agent/index.ts`
- `packages/runtime/src/expose.ts`
- `packages/runtime/src/__tests__/turns.test.ts`
- 物理删除：`packages/runtime/src/agent/engine.ts`
- 物理删除：`packages/runtime/src/agent/handler.ts`

## Acceptance Criteria

- [ ] tRPC `turns.*` 路由全面跑通，前端能正常发起回合、插话（steer）、排队（followUp）以及取消。
- [ ] `turns.get` 直接由 storage 提供数据，不再依赖运行时实例。
- [ ] 物理删除旧有 `engine.ts` 与 `handler.ts` 后，项目编译零类型报错（`pnpm typecheck` 绿灯）。
- [ ] 既有测试套件与新增单测全量通过（`pnpm test` 绿灯）。

## Verification Plan

```bash
pnpm typecheck
pnpm --filter @rover/runtime test
```
