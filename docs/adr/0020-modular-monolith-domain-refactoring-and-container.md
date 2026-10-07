# ADR-0020: Runtime 模块化单体领域架构重构与轻量容器装配规范

> 状态：已采纳 · 2026-10-07  
> 关联决策：[ADR-0014](./0014-linear-rover-entries-and-compaction.md)、[ADR-0017](./0017-unified-runtime-websocket-event-bus.md)、[ADR-0018](./0018-multi-source-input-steer-and-follow-up-interaction.md)、[ADR-0019](./0019-agent-runtime-callbacks-and-decoupled-lifecycle.md)  
> 需求关联：Rover MVP TRD (第 56-59 行及第 85 行)

---

## 背景与问题

伴随 Rover 核心能力的演进，`@rover/runtime` 经历了存储层建立、模型对接、Pi Agent 回合循环、以及近期 ADR-0019 针对 `AgentRuntime` 的纯领域解耦。然而，代码物理组织方式仍保留早期的平铺混合形态，随着系统复杂度上升，暴露出四大架构坏味道：

1. **单体胖路由恶化（Fat Router）**：
   `packages/runtime/src/transport/router.ts` 已膨胀至近 370 行，杂糅了健康检查、模型管理、技能读取、终端交互、回合调度（start/steer/followUp）以及历史只读查询，严重违反单一职责原则。
2. **缺乏清晰的基础设施分层与职责倒置**：
   底层操作系统进程（GNU screen、macOS Terminal.app）与遥测日志抓取（Spool、文件 Hook）散落在顶层 `dispatch/` 和 `observe/`，导致系统底层技术能力与业务领域能力边界模糊。
3. **隐式全局单例与分散装配（Scattered Singletons）**：
   各模块各自在文件顶层调用 `getDefaultDatabase()`、`getDefaultAgentRuntime()` 等全局单例，缺乏明确的生命周期装配入口（Composition Root），模块间时序耦合严重且难以进行纯净的依赖隔离测试。
4. **测试文件扁平堆积（Lack of Co-location）**：
   根目录 `src/__tests__/` 堆放了全部 20 个测试套件，导致业务源码与单元测试脱节，修改业务时无法就近查阅与维护测试。

---

## 架构决策

借鉴成熟系统（`/Users/evan/Desktop/coding/traceability/server`）经过实战验证的**模块化单体（Modular Monolith）与垂直领域切片**架构，结合 Rover 桌面伴随运行时的实际特征，做出以下架构重构决策：

```text
┌─────────────────────────────────────────────────────────────┐
│                      Tauri React UI                         │
└──────────────────────────────┬──────────────────────────────┘
                               │ (tRPC RPC / WebSocket)
┌──────────────────────────────▼──────────────────────────────┐
│                    Transport / Protocol Layer               │
│  - trpc/app-router.ts (仅聚合各个 Module 子路由，无具体业务)│
│  - transport/server.ts (HTTP / WebSocket 监听网关)          │
└──────────────────────────────┬──────────────────────────────┘
                               │ 注入 context.container
┌──────────────────────────────▼──────────────────────────────┐
│                  src/container.ts (组合根)                  │
│  - 纯 TypeScript 依赖袋 (POJO Container)，负责集中实例化    │
│  - 解决 Service 间依赖 (如 AgentService 依赖 SkillService)  │
└──────┬───────────────────────┼───────────────────────┬──────┘
       │ 持有                  │ 注入                  │ 注入
┌──────▼──────┐         ┌──────▼──────┐         ┌──────▼──────┐
│modules/tasks│         │modules/agent│         │modules/models│ ...
│ (Service +  │         │ (Service +  │         │ (Service +  │
│  Router)    │         │  Router)    │         │  Router)    │
└──────┬──────┘         └──────┬──────┘         └─────────────┘
       │ 依赖底层              │ 依赖底层
┌──────▼───────────────────────▼──────────────────────────────┐
│                     infrastructure/                         │
│  - database/ (SQLite 驱动、连接单例与 Migrations)           │
│  - dispatch/ (Screen 会话、Terminal 脚本、CLI 进程适配)      │
│  - observe/ (Spool 缓冲区、进程 Hook 监听、日志模式解析)    │
└─────────────────────────────────────────────────────────────┘
```

### 1. 严格划分 Infrastructure 与 Modules

- **`infrastructure/`（基础设施层）**：
  收拢所有**纯技术驱动、无对外业务 API Router**的系统底座能力：
  - `database/`：SQLite `better-sqlite3` 连接包装、单例与 DDL 迁移引擎；
  - `dispatch/`：操作系统级进程托管（GNU screen、macOS Terminal.app 控制、CLI 基础适配器）；
  - `observe/`：进程输出遥测捕获（Spool 缓冲区、外部 CLI 注入钩子与流式日志消费者）；
  - `logger.ts`：统一运行时日志输出。
- **`modules/`（业务领域模块）**：
  每个模块代表一个端到端完整闭环的产品能力，具备对前端暴露的 `router.ts` 和业务逻辑 `service.ts`：
  - `tasks/`：任务生命周期状态机、任务卡片与事件流；
  - `agent/`：Rover 回合生命周期、`AgentRuntime` 纯领域回路、上下文记忆与历史查询；
  - `models/`：大模型配置管理、连通性探测、Pi AI 配置导入；
  - `skills/`：技能发现、扫描与内容读取；
  - **保留 TRD 规划模块**：保留 `docs/architecture/Rover MVP TRD.md` 明确规划的空目录占位：
    - `ingress/`（Inbox 投递规范化、去重、提醒与用户处理入口）；
    - `scheduler/`（计划任务、运行记录、错过触发）；
    - `reporting/`（最近活动记录、Task 摘要检索）。

### 2. 模块内顶层文件规范（对标 Traceability Auth 模块）

每个 `modules/<domain>/` 目录内部，必须以标准的单职责文件作为最顶层入口：
- **`index.ts`**：模块门面（Facade），严格对外导出该模块公开的 Service、Repository 和契约类型；
- **`service.ts`**：业务领域服务类（如 `TaskService`、`AgentService`），封装所有业务规则与状态变更；
- **`router.ts`**：tRPC 过程路由，**职责严格限定为 Zod 输入校验与错误包装**，统一通过 `ctx.container.<module>.<method>()` 调用业务服务；
- **`repository.ts`**：数据持久化存取（按需，如 `tasks` 与 `agent`）；
- **`schema.ts` / `types.ts`**：内部数据校验规则与领域实体定义；
- **`service.test.ts` / `router.test.ts`**：紧邻放置的单元测试（Co-located Tests）；
- 内部复杂子系统以子目录承载（如 `modules/agent/runtime/`），子目录内配私有 `index.ts`。

### 3. 引入轻量 Container 组合根与 Context 依赖注入

为根除全局单例乱象并优雅解决 Service 间的相互引用：
1. 在 `src/container.ts` 中声明 `createContainer(config)`：
   - 实例化 Infrastructure（`database`、`dispatch`、`observe`）；
   - 实例化 Repositories 并按依赖拓扑注入各模块的 Services；
   - 冻结导出强类型不可变对象 `Container`。
2. tRPC `Context` 定义为 `{ token?: string, container: Container }`：
   - 所有子路由的 procedure 均无状态，直接解构 `({ ctx, input }) => ctx.container.<module>.<method>(input)`。

### 4. 边界隔离与零破坏性契约

- **禁止内部 Barrel 文件（Strict File Discipline）**：模块内部互相引用时，必须使用精确的相对路径（带 `.js` 后缀，如 `import { TaskService } from './service.js'`），严禁通过 `export *` 形成隐式黑盒；
- **前端零破坏**：`packages/runtime/src/expose.ts` 保持纯类型导出不变，tRPC 顶层 procedure 调用路径保持 100% 兼容；
- **SEA 打包兼容**：`packages/runtime/src/index.ts` 作为启动与打包入口，保持独立可执行文件构建脚本正常运作。

---

## 实施影响与后果 (Consequences)

### 正向影响 (Positive)
* **彻底根除胖路由**：顶层 `src/trpc/app-router.ts` 缩减为 30 行以内的纯聚合器；
* **测试自治度显著提升**：全部 20 个测试文件归入各模块内，实现测试就近组织（Co-location）；
* **依赖关系完全解耦**：形成清晰的单向依赖网（`transport` $\to$ `modules` $\to$ `infrastructure`），杜绝循环依赖；
* **生命周期完全受控**：消除隐式全局单例，进程启动参数集中经由 Container 流转。

### 负向与成本 (Negative & Trade-offs)
* 涉及大量既有源码文件的物理路径搬迁与 import 重写，需分为两张聚焦的 Tracer-Bullet Tickets 逐步推进，确保中间状态持续可编译且全量单测全绿。
