# AgentRuntime 架构解耦、事件回调契约 (Callbacks) 与 HITL 机制

> 状态：已采纳 · 2026-10-07
>
> 关联决策：[ADR-0014](./0014-linear-rover-entries-and-compaction.md)（线性 Entry 与 WAL 原则）、[ADR-0017](./0017-unified-runtime-websocket-event-bus.md)（统一 WS 事件总线）、[ADR-0018](./0018-multi-source-input-steer-and-follow-up-interaction.md)（Steer/Follow-Up 双模态与微徽章架）

## 背景与问题

Rover 作为常驻桌面宠物形态的 AI 助手，在从单轮问答演进为多模态连续交互（Steer 插话、Follow-Up 排队、HITL 人机协同）时，既有的 `RoverTurnEngine` 与 `AgentEventHandler` 架构暴露出严重的紧耦合与职责蔓延问题：

1. **执行引擎与外部副作用强耦合**：
   - `RoverTurnEngine` 既负责驱动 `@earendil-works/pi-agent-core` 的循环回路，又直接在构造函数中强依赖 SQLite `Database` 与 `WebSocketManager`；
   - `AgentEventHandler` 作为一个中间件，在处理底层 Agent 事件时，既做 SQLite WAL 先行落盘（`appendMessageEntry`、`updateRoverTurnStatus`），又直接调用 WebSocket 进行网络广播，职责不纯粹；
   - 导致无法在脱离数据库和网络环境的情况下对 Agent 执行逻辑进行轻量、高效的单元测试。

2. **单轮短命实例阻碍长寿命会话交互**：
   - 原引擎在每次 `executeTurn` 时临时 `new Agent(...)`，执行完毕后置空；
   - 这使得 [ADR-0018](./0018-multi-source-input-steer-and-follow-up-interaction.md) 规定的多输入源调度（用户在模型生成中途使用 `Cmd+Enter` 发送 Steer 转向纠偏，或按 `Enter` 发送 Follow-Up 排队）缺乏长期运行的宿主，队列同步困难。

3. **缺乏标准化 Human-in-the-loop (HITL) 挂起与恢复机制**：
   - 高危工具权限管控（Permission Approval）与 Agent 主动向用户提问（Ask User Question）缺乏基于 Promise 的异步挂起/唤醒状态机，无法支持工具调用前的安全拦截。

4. **违反 CQRS（命令与查询职责分离）原则**：
   - 原 `RoverTurnEngine` 暴露了诸如 `getTurnDetails`、`getDatabase()` 等纯只读数据查询方法，混淆了“控制执行”与“数据查询”的边界。

---

## 架构决策

借鉴成熟的 `divisor-agent` 架构经验，对 Rover 的 Agent 运行时进行彻底的分层解耦与重构：

```text
┌─────────────────────────────────────────────────────────────┐
│                      Tauri React UI                         │
└──────────────────────────────┬──────────────────────────────┘
                               │ (tRPC RPC 调用) / (WebSocket 流式事件)
┌──────────────────────────────▼──────────────────────────────┐
│                    Transport / Adapter Layer                │
│  - tRPC Router (turns.prompt, turns.steer, permissions.*)   │
│  - WebSocket Broadcaster (订阅 Runtime 事件并转发给前端)    │
└──────────────────────────────┬──────────────────────────────┘
                               │ 驱动命令与注册回调
┌──────────────────────────────▼──────────────────────────────┐
│                   Rover Agent Runtime (Core)                │
│  - 纯领域对象：持有 Pi Agent Core 实例                      │
│  - 状态管理：Prompt / Steer / Follow-Up 队列调度            │
│  - HITL Manager (PermissionService, AskQuestionService)     │
│  - 管理并安全派发：AgentRuntimeEventCallbacks               │
└──────────────┬──────────────────────────────┬───────────────┘
               │ 触发生命周期 Callbacks       │
┌──────────────▼──────────────┐ ┌─────────────▼───────────────┐
│   TurnPersistenceCallbacks  │ │ WebSocketBroadcastCallbacks │
│   (SQLite WAL 消息先行落盘)  │ │ (WebSocket 实时流式事件推送)│
│   - onTurnStart ➔ createTurn│ └─────────────────────────────┘
│   - onMessageEnd ➔ append   │
│   - onTurnEnd ➔ updateStatus│
└─────────────────────────────┘
```

### 1. 核心运行时领域抽象 (`AgentRuntime`)

* `AgentRuntime` 是一个**零外部数据库依赖、零网络协议依赖**的纯领域执行类；
* 维持长寿命或可控生命周期的 `Agent` 实例，原生支持：
  * `prompt(input)`：常规指令输入；
  * `steer(message)`：高优先级插话干预；
  * `followUp(message)`：排队接力追问；
  * `clearAllQueues()`：清空排队；
  * `abortPrompt()`：主动取消执行；
  * `scheduleQueuedContinue()`：在回合结束且存在排队时，自动无缝推进下一回合。

### 2. 生命周期事件回调规范 (`AgentRuntimeEventCallbacks`)

定义统一的生命周期回调接口，所有方法均为可选（Optional）：

```ts
export interface TurnContext {
  turnId: string;
  sessionId?: string;
  userPrompt?: PromptDocumentV1;
  model?: Model<any>;
  startTime: number;
}

export interface AgentRuntimeEventCallbacks {
  /** 回合开始（入口前置触发，确保 WAL 先行） */
  onTurnStart?(context: TurnContext): Promise<void> | void;
  /** 单步 Step 开始（大模型发起单次调用） */
  onTurnStepStart?(context: TurnContext): Promise<void> | void;
  /** 流式 Token 增量产生（区分普通文本与思考链增量） */
  onMessageDelta?(context: TurnContext, event: MessageDeltaEvent): Promise<void> | void;
  /** 完整单条消息生成完毕（assistant 或 toolResult 结算完毕，WAL 落盘核心点） */
  onMessageEnd?(context: TurnContext, message: AgentMessage): Promise<void> | void;
  /** 工具调用发起与结束 */
  onToolExecutionStart?(context: TurnContext, event: ToolCallEvent): Promise<void> | void;
  onToolExecutionEnd?(context: TurnContext, event: ToolResultEvent): Promise<void> | void;
  /** 回合终态决算（completed / cancelled / failed） */
  onTurnEnd?(context: TurnContext, result: TurnEndResult): Promise<void> | void;
  /** Human-in-the-loop 事件（权限审批 / 用户提问） */
  onPermissionRequested?(context: TurnContext, request: PermissionRequest): Promise<void> | void;
  onPermissionResolved?(context: TurnContext, resolution: PermissionResolution): Promise<void> | void;
  onAskUserQuestionRequested?(context: TurnContext, request: AskQuestionRequest): Promise<void> | void;
  onAskUserQuestionResolved?(context: TurnContext, result: AskQuestionResult): Promise<void> | void;
  /** 执行异常捕获 */
  onError?(context: TurnContext, error: Error): Promise<void> | void;
}
```

* `AgentRuntime` 负责管理 Callbacks：
  * `addEventCallbacks(callbacks)`：注册并返回清理函数；
  * `triggerCallback(name, ...args)`：遍历并安全执行各回调，隔离单个回调异常，不阻断核心回路。

### 3. `onTurnStart` 前置触发机制

* **时机规定**：`onTurnStart` **必须在 `AgentRuntime.prompt()` 入口处、入参校验完成、且正式向底层 `agent.prompt()` 发送请求之前前置主动触发**；
* **目的**：杜绝因底层网络错误或异常穿透导致数据库漏建回合的风险，从架构上绝对保证 ADR-0014 的 WAL（Write-Ahead Logging）先行落盘原则；
* **模态区分**：
  * 常规 Prompt 与 Follow-Up 出队：触发 `onTurnStart`；
  * Steer 插话：属于当前回合内的转向纠偏，不开启新回合，不触发 `onTurnStart`。

### 4. 拆分独立的标准化 Callbacks 实现

* **`TurnPersistenceCallbacks`（存储层）**：
  * 实现 `onTurnStart`：原子开启 SQLite 事务，创建 `rover_turn (status='running')` 并追加首条 `user` 类型的 `rover_entry`；
  * 实现 `onMessageEnd`：对完整的 `assistant` 或 `toolResult` 消息立即调用 `appendMessageEntry`，使用 `WeakSet` 确保幂等落盘；
  * 实现 `onTurnEnd`：更新 `rover_turn` 的终态（`completed` / `cancelled` / `failed`）、耗时与错误信息。
* **`WebSocketBroadcastCallbacks`（网络层）**：
  * 将各回调事件转换为符合 ADR-0017 规范的 WebSocket 广播载荷（`turn.started`, `turn.step_started`, `turn.delta`, `turn.tool_call`, `turn.tool_result`, `turn.end` 等）。

### 5. 抽象 Human-in-the-Loop (HITL) 体系

* 引入 `AbstractHumanInTheLoop<TKind, TPayload, TResult>`：
  * `request(payload)`：返回 Promise 并将 `{ resolve, reject }` 挂起在内存 `Map` 中，派发事件；
  * `resolve(requestId, result)`：外部接口（如 tRPC）提交确认后，取出挂起的 Promise 并恢复执行；
  * `cancelAll(reason)`：回合中断或销毁时批量 Reject 所有挂起请求，避免死锁或幽灵等待。
* 实现两类标准服务：
  * **`PermissionService`**：在 `pi-agent-core` 的 `beforeToolCall` 拦截高危工具，支持前缀记忆自动放行；
  * **`AskUserQuestionService`**：为 Agent 提供向用户发起单选/多选/确认提问的标准工具。

### 6. CQRS 剥离与旧模块物理淘汰

* 彻底移去 Runtime 内部的 `getTurnDetails`、`getDatabase()` 等只读查询方法，tRPC 中的只读路由（`turns.get` 等）直接面向 `storage` 模块查询；
* 淘汰并物理删除旧有的 `packages/runtime/src/agent/engine.ts` 与 `packages/runtime/src/agent/handler.ts`。

---

## 权衡与收益

- **单一职责与关注点分离**：Runtime 核心只有状态调度与 Agent 回路，不含任何 SQL 语句或 WebSocket 调用。
- **可测试性大幅跃升**：测试 Agent 逻辑无需启动内存数据库或 Mock 网络连接；测试持久化逻辑只需断言 Callbacks 行为。
- **与 ADR-0018 完美同构**：原生契约支持 `steer`、`followUp`，微徽章架出队与平滑接力天然闭环。
- **开箱即用的高阶交互**：HITL 机制直接解决了高危操作权限审核与人机澄清提问的底层难题。
