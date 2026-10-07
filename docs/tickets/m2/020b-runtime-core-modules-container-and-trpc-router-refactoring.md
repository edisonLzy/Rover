# 020b: Runtime 核心业务模块收敛、Container 组合根引入与 tRPC 路由聚合重构

**Status**: TODO  
**Blocked By**: 020a  
**Blocks**: 016, 017  

## Context & Goal

依据 [ADR-0020](../../adr/0020-modular-monolith-domain-refactoring-and-container.md)，在 [020a](./020a-runtime-infrastructure-and-isolated-modules-refactoring.md) 基础设施与独立模块迁移就绪的基础上，推进重构第二阶段（Two Tickets 方案之 Ticket B）：
收敛核心业务领域模块 `src/modules/tasks/` 与 `src/modules/agent/`，补全 `AgentService` 业务门面；引入轻量组合根 `src/container.ts` 并注入 tRPC `Context`；建立 `src/trpc/app-router.ts` 纯聚合器，彻底废弃并下线原 369 行的单体胖路由 `src/transport/router.ts`；对齐 `src/expose.ts` 与 `src/index.ts`，完成全链路验证。

---

## Affected Components & Directory Structure

```text
packages/runtime/src/
├── container.ts                            # + [New] 统一组合根 (createContainer)
│
├── modules/                                # 业务领域模块根目录
│   ├── tasks/                              # + [New] 完整任务管理模块
│   │   ├── index.ts                        # + [New] 模块门面导出
│   │   ├── service.ts                      # * [Moved] 原 tasks/service.ts
│   │   ├── router.ts                       # * [Moved/Modified] 改造为通过 ctx.container.tasks 调用的纯路由
│   │   ├── repository.ts                   # * [Moved] 原 storage/repositories/tasks*.ts
│   │   ├── projector.ts                    # * [Moved] 原 observe/projector.ts
│   │   ├── types.ts                        # * [Moved] 原 storage/types.ts 中的 Task 定义
│   │   └── __tests__/                      # + [New] 就近测试
│   │       ├── tasks.test.ts               # * [Moved] 原 __tests__/tasks.test.ts
│   │       └── projection.test.ts          # * [Moved] 原 __tests__/projection.test.ts
│   │
│   └── agent/                              # * [Moved/Modified] 原 agent/ 重构为模块化形式
│       ├── index.ts                        # * [Modified] 顶层 Facade 导出 (AgentService, HistoryRepo)
│       ├── service.ts                      # + [New] AgentService 业务领域服务类 (统一 startTurn/steer/getFeed)
│       ├── router.ts                       # + [New] agentRouter (承载 turns 与 history 路由)
│       ├── repository.ts                   # * [Moved] 原 storage/repositories/history.ts & storage/events.ts
│       ├── types.ts                        # * [Moved] 原 agent/types.ts
│       ├── runtime/                        # + [New] 执行回路核心子目录
│       │   ├── runtime.ts                  # * [Moved] 原 agent/runtime.ts
│       │   ├── factory.ts                  # * [Moved] 原 agent/factory.ts
│       │   ├── compaction.ts               # * [Moved] 原 agent/compaction.ts
│       │   ├── prompts.ts                  # * [Moved] 原 agent/prompts.ts
│       │   ├── callbacks/                  # * [Moved] 原 agent/callbacks/
│       │   └── index.ts                    # + [New] runtime 子模块导出
│       └── __tests__/                      # + [New] 就近测试
│           ├── agent_runtime.test.ts       # * [Moved] 原 __tests__/agent_runtime.test.ts
│           ├── runtime_callbacks.test.ts   # * [Moved] 原 __tests__/runtime_callbacks.test.ts
│           ├── turns.test.ts               # * [Moved] 原 __tests__/turns.test.ts
│           └── history.test.ts             # * [Moved] 原 __tests__/history.test.ts
│
├── trpc/                                   # + [New] tRPC 协议层 (对标 traceability/src/trpc)
│   ├── trpc.ts                             # * [Moved] 原 transport/trpc.ts
│   ├── context.ts                          # * [Moved/Modified] Context 注入 { container: Container }
│   └── app-router.ts                       # + [New] 顶层路由聚合器 (仅挂载各 modules 的 router)
│
├── transport/                              # * [Modified] 网络传输通道
│   ├── websocket.ts                        # * [Moved] 原 transport/websocket.ts
│   ├── server.ts                           # * [Moved/Modified] 接收 container 并启动服务
│   └── index.ts                            # * [Modified] 传输层导出
│
├── helper/ 或 shared/                      # + [New] 跨模块契约
│   ├── prompt.ts                           # * [Moved] 原 types/prompt.ts
│   └── events.ts                           # * [Moved] 原 types/events.ts
│
├── expose.ts                               # * [Modified] 维持纯类型导出向前 100% 兼容
└── index.ts                                # * [Modified] 使用 createContainer 启动 CLI 与 SEA 打包
```

---

## Specification & Invariants

1. **组合根 `src/container.ts` 构建**：
   - 导出 `interface Container` 与工厂函数 `createContainer(config: RuntimeConfig): Container`；
   - 统一初始化 `database`、`carrier`、`dispatcher`，并实例化 `TaskRepository`、`HistoryRepository`；
   - 实例化 `TaskService`、`SkillService`、`ModelService`、`AgentRuntime` 与 `AgentService`；
   - 彻底废除零散的 `getDefaultDatabase()` 与 `getDefaultAgentRuntime()`。
2. **`tasks` 模块收敛**：
   - 将原 `storage/repositories/tasks.ts` 和 `task-events.ts` 归位为 `src/modules/tasks/repository.ts`；
   - 将原 `observe/projector.ts` 归位为 `src/modules/tasks/projector.ts`；
   - `tasks/router.ts` 重写为纯过程路由，使用 `ctx.container.tasks`；
   - 就近迁移 `tasks.test.ts` 与 `projection.test.ts`。
3. **`agent` 模块收敛与 `AgentService` 落地**：
   - 建立 `src/modules/agent/service.ts`（`AgentService`），封装 `startTurn`, `steer`, `followUp`, `cancelTurn`, `getTurn`, `getFeed`, `getStats`；
   - 将原 `storage/repositories/history.ts` 移入 `src/modules/agent/repository.ts`；
   - 核心执行回路归入 `src/modules/agent/runtime/`；
   - 建立 `src/modules/agent/router.ts`，纯入参校验并委托给 `ctx.container.agent`；
   - 就近迁移 `agent_runtime.test.ts`, `runtime_callbacks.test.ts`, `turns.test.ts`, `history.test.ts`。
4. **顶层路由聚合器与下线单体路由**：
   - 建立 `src/trpc/app-router.ts`，聚合 `tasksRouter`, `agentRouter.turns`, `agentRouter.history`, `modelsRouter`, `skillsRouter` 以及终端动作过程；
   - 物理删除旧有单体路由 `src/transport/router.ts`；
   - 升级 `src/transport/server.ts`，使用 `createContainer`。
5. **根目录清理与契约对齐**：
   - 彻底删除已清空的旧顶层目录（`storage/`, `agent/`, `dispatch/`, `observe/`, `tasks/`, `types/`, `__tests__/`）；
   - 调整 `packages/runtime/src/expose.ts` 与 `src/index.ts` 导出，确保前端编译零感知，SEA 打包完全正常。

---

## Acceptance Criteria

- [ ] `src/container.ts` 正式成为唯一的依赖装配组合根，无散落单例。
- [ ] `modules/tasks/` 与 `modules/agent/` 完整成型，`AgentService` 全面接管回合与记忆逻辑。
- [ ] 原 369 行单体路由 `transport/router.ts` 被彻底物理下线，替换为 30 行以内的 `src/trpc/app-router.ts`。
- [ ] 旧顶层临时目录与扁平的 `src/__tests__/` 彻底清空并移除。
- [ ] `pnpm typecheck` 零类型报错。
- [ ] `pnpm test` 全量单测 100% 绿灯通过。
- [ ] `pnpm --filter @rover/runtime build:sea && pnpm --filter @rover/runtime smoke:sea` 独立可执行二进制构建验证通过。

---

## Verification Plan

```bash
pnpm typecheck
pnpm test
pnpm --filter @rover/runtime build:sea
pnpm --filter @rover/runtime smoke:sea
```
