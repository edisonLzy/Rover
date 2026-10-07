# 020a: Runtime 基础设施层下沉与独立业务模块 (Models/Skills) 解耦重构

**Status**: TODO  
**Blocked By**: 014c  
**Blocks**: 020b  

## Context & Goal

依据 [ADR-0020](../../adr/0020-modular-monolith-domain-refactoring-and-container.md)，启动 `@rover/runtime` 模块化单体重构的第一阶段（Two Tickets 方案之 Ticket A）：
将底层技术能力（数据库持久化驱动、GNU screen / macOS Terminal 进程托管、Spool / Hook 日志遥测）正式下沉归位为 `src/infrastructure/`；归整 `docs/architecture/Rover MVP TRD.md` 中规划的空模块占位；并对具备高独立性的 `models` 与 `skills` 业务模块实施解耦重构，独立拆出其 `Service` 与 `Router`，并将单测就近迁移。

---

## Affected Components & Directory Structure

```text
packages/runtime/src/
├── infrastructure/                         # + [New] 基础设施层
│   ├── database/                           # + [New] SQLite 连接与迁移基座
│   │   ├── client.ts                       # * [Moved] 原 storage/db.ts
│   │   ├── migrator.ts                     # * [Moved] 原 storage/migrator.ts
│   │   ├── migrations/                     # * [Moved] 原 storage/migrations/*
│   │   └── client.test.ts                  # * [Moved] 原 __tests__/storage.test.ts
│   ├── dispatch/                           # + [New] 操作系统进程与终端基建
│   │   ├── screen.ts                       # * [Moved] 原 dispatch/screen.ts
│   │   ├── terminal.ts                     # * [Moved] 原 dispatch/terminal.ts
│   │   ├── carrier.ts                      # * [Moved] 原 dispatch/carrier.ts
│   │   ├── dispatcher.ts                   # * [Moved] 原 dispatch/dispatcher.ts
│   │   ├── adapters/                       # + [New] 外部 CLI 适配器
│   │   │   ├── claude.ts                   # * [Moved] 原 dispatch/claude.ts
│   │   │   ├── codex.ts                    # * [Moved] 原 dispatch/codex.ts
│   │   │   └── opencode.ts                 # * [Moved] 原 dispatch/opencode.ts
│   │   ├── types.ts                        # * [Moved] 原 dispatch/types.ts
│   │   └── __tests__/                      # + [New] 进程托管测试
│   │       ├── screen.test.ts              # * [Moved] 原 __tests__/screen.test.ts
│   │       ├── terminal.test.ts            # * [Moved] 原 __tests__/terminal.test.ts
│   │       ├── carrier.test.ts             # * [Moved] 原 __tests__/carrier.test.ts
│   │       ├── dispatch.test.ts            # * [Moved] 原 __tests__/dispatch.test.ts
│   │       └── dispatch_flow.test.ts       # * [Moved] 原 __tests__/dispatch_flow.test.ts
│   ├── observe/                            # + [New] 进程输出遥测与日志捕获基建
│   │   ├── spool.ts                        # * [Moved] 原 observe/spool.ts
│   │   ├── consumer.ts                     # * [Moved] 原 observe/consumer.ts
│   │   ├── hook-config.ts                  # * [Moved] 原 observe/hook-config.ts
│   │   ├── adapters/                       # + [New] 日志解析器
│   │   │   ├── claude.ts                   # * [Moved] 原 observe/claude.ts
│   │   │   ├── codex.ts                    # * [Moved] 原 observe/codex.ts
│   │   │   ├── opencode.ts                 # * [Moved] 原 observe/opencode.ts
│   │   │   └── constants.ts                # * [Moved] 原 observe/constants.ts
│   │   ├── types.ts                        # * [Moved] 原 observe/types.ts
│   │   └── __tests__/                      # + [New] 遥测底层测试
│   │       ├── spool.test.ts               # * [Moved] 原 __tests__/spool.test.ts
│   │       └── hook-config.test.ts         # * [Moved] 原 __tests__/hook-config.test.ts
│   └── logger.ts                           # + [New] 基础日志设施
│
├── modules/                                # + [New] 业务领域模块根目录
│   ├── models/                             # + [New] 独立模型管理模块
│   │   ├── index.ts                        # * [Moved/Modified] 原 models/index.ts
│   │   ├── service.ts                      # + [New] ModelService 业务领域服务类
│   │   ├── router.ts                       # + [New] modelsRouter (从 transport/router.ts 抽离)
│   │   ├── registry.ts                     # * [Moved] 原 models/registry.ts
│   │   ├── schema.ts                       # * [Moved] 原 models/config.ts
│   │   ├── types.ts                        # * [Moved] 原 models/types.ts
│   │   └── __tests__/                      # + [New] 就近测试
│   │       └── models.test.ts              # * [Moved] 原 __tests__/models.test.ts
│   ├── skills/                             # + [New] 独立技能管理模块
│   │   ├── index.ts                        # + [New] 技能模块统一导出
│   │   ├── service.ts                      # * [Moved] 原 agent/skills/skill-service.ts
│   │   ├── router.ts                       # + [New] skillsRouter (从 transport/router.ts 抽离)
│   │   ├── tool.ts                         # * [Moved] 原 agent/tools/skill.ts
│   │   ├── types.ts                        # + [New] 技能契约类型
│   │   └── __tests__/                      # + [New] 就近测试
│   │       └── skills.test.ts              # * [Moved] 原 __tests__/skills.test.ts
│   ├── ingress/                            # * [Moved] 原 ingress/ (.gitkeep 规划占位)
│   ├── scheduler/                          # * [Moved] 原 scheduler/ (.gitkeep 规划占位)
│   └── reporting/                          # * [Moved] 原 reporting/ (.gitkeep 规划占位)
```

---

## Specification & Invariants

1. **基础设施下沉与隔离**：
   - 建立 `src/infrastructure/database/`，移动 SQLite 连接包装与迁移器，更新其关联的单测。
   - 建立 `src/infrastructure/dispatch/` 与 `src/infrastructure/observe/`，移动所有底层进程与遥测解析逻辑，搬迁相关 7 个底层测试文件。
   - `infrastructure` 仅作为技术底座，严禁反向依赖上层 `modules/`。
2. **TRD 规划空目录归位**：
   - 将原顶层的 `ingress/`, `scheduler/`, `reporting/` 移入 `src/modules/` 下，严禁删除其 `.gitkeep` 占位。
3. **`models` 模块独立化重构**：
   - 建立 `src/modules/models/service.ts`，将原先零散的配置读写、连通测试、Pi 导入逻辑封装为 `ModelService` 类；
   - 建立 `src/modules/models/router.ts`，承载 `models.*` 路由，仅负责入参校验并委托给 `ModelService`；
   - 搬迁 `models.test.ts` 至模块内。
4. **`skills` 模块独立化重构**：
   - 建立 `src/modules/skills/`，将原藏在 `agent/skills/` 的逻辑提升为独立模块；
   - 建立 `src/modules/skills/service.ts` 与 `src/modules/skills/router.ts`；
   - 搬迁 `skills.test.ts` 至模块内。
5. **增量兼容保证**：
   - 更新既有导入路径，在此阶段 `packages/runtime/src/transport/router.ts` 直接挂载新建的 `modelsRouter` 与 `skillsRouter`，保证全系统 `pnpm test` 与 `pnpm typecheck` 持续全绿。

---

## Acceptance Criteria

- [ ] `src/infrastructure/`（`database`, `dispatch`, `observe`）全部建立，底层逻辑与单测就近迁移就绪。
- [ ] `ingress/`, `scheduler/`, `reporting/` 规范归入 `src/modules/`。
- [ ] `modules/models/` 拥有独立的 `service.ts`、`router.ts`、`index.ts`，测试迁移就近。
- [ ] `modules/skills/` 拥有独立的 `service.ts`、`router.ts`、`index.ts`，测试迁移就近。
- [ ] `pnpm typecheck` 零类型报错。
- [ ] `pnpm --filter @rover/runtime test` 19 个测试套件全绿通过。

---

## Verification Plan

```bash
pnpm typecheck
pnpm --filter @rover/runtime test
```
