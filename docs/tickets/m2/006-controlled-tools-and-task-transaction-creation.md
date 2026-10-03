# 006: 受控工具链与 Task 事务原子创建

**Status**: DONE  
**Blocked By**: 001, 005  
**Blocks**: 007, 008, 009, 010  

## Context & Goal
Rover Agent 在回合中通过工具调用派发 Code Agent。根据 TRD 第 4 与第 5 节，Rover Agent 必须受到受控工具边界的严格限制，杜绝任意 Shell 或网络操作；当决定派发 Code Agent 时，执行内置 `agent-dispatch` 流程，调用 M1 构建的 `Dispatcher` 与 `ScreenSupervisor`，并恪守核心不变量：**唯有在取得受可信信号证实的原生 Session ID 后，才在单一事务中创建 Task，彻底杜绝“空 Task”**。

## Specification & Invariants
1. **受控工具安全沙箱（双核心工具）**：
   - 严禁赋予 Rover Agent 通用无限制 shell 执行、文件任意写或任意网络请求工具（如禁止 `curl`、`wget`、`rm`、`npm`、写重定向 `>` 等）；
   - **受控工具链**：
     - `read_skill`：方案 B 模型驱动动态加载工具。允许大模型在需要处理代码任务、走查或派发时，按需动态加载内置技能（如 `dispatch-agent`）的完整 SOP 标准作业流程与澄清清单，实现两阶段渐进式披露；
     - `dispatch_agent`：Code Agent 任务派发工具。接收 `{ agent, cwd, taskPrompt }`，调度 Carrier 拉起 CLI 并落盘原子事务。
   - **冗余工具移除说明**：
     - `list_skills` 移除：内置 Skill 概览已由 `BuiltinSkillService` 在系统提示词 Level 1 中常驻注入，大模型按需调用 `read_skill` 加载正文；
     - `query_tasks` 移除：当前活跃任务由 `SystemPromptService` 动态注入提示词（零延迟感知），历史任务经验回忆则全权交由 Ticket 008 `task-recall`。
2. **`agent-dispatch` 与 Task 事务创建生命周期**：
   - 步骤 1：生成派发尝试 ID、候选 Task UUID、上报 Token，并写入 `dispatch_attempt` 表（status: `starting`）；此时**不得**向前端展示 Task 卡片或创建 `task` 记录；
   - 步骤 2：调用 M1 的 `Dispatcher`，启动 GNU Screen 后台会话承载；
   - 步骤 3：等待可信的 Native Session ID（如 Claude 的预分配 UUID 或 Codex 的 `SessionStart` Hook 回传）；
   - 步骤 4（核心事务）：在单一 SQLite 事务内原子写入：
     - `session_ref`（记录 `agent`, `native_session_id`, 承载名称, `availability: "available"`）；
     - `task`（记录 `id`, `goal`, `agent`, `status: "running"`, `created_at`）；
     - 首个 `task_event`（`kind: "dispatched"`）；
     - 推进 `dispatch_attempt` 状态为 `registered`；
     - 对应 `runtime_event`（`type: "task.changed"`，并通过 WebSocket 广播给前端）。
   - **阻断红线**：若启动失败或未能在超时内捕获原生 Session ID，将 `dispatch_attempt` 标记为 `failed`，**严禁创建空 Task 记录**。
3. **Task 查询 API**：
   - `GET /v1/tasks`: 获取当前 Task 列表（供前端 UI 渲染，含状态、进度文本、目标）；
   - `GET /v1/tasks/{id}`: 获取指定 Task 的详细事件链与会话引用信息。

## Affected Components & Files
- `packages/runtime/src/agent/tools/index.ts`
- `packages/runtime/src/agent/tools/bash.ts` (`read_only_bash` 工具实现)
- `packages/runtime/src/agent/tools/dispatch.ts` (`dispatch_agent` 工具实现)
- `packages/runtime/src/skills/builtin/agent-dispatch.ts` (`AgentDispatchService` 核心编排)
- `packages/runtime/src/storage/repositories/tasks.ts` (SQLite Task 事务与查询)
- `packages/runtime/src/transport/router.ts` (tasks tRPC/HTTP 路由)
- `packages/runtime/src/__tests__/read_only_bash.test.ts`
- `packages/runtime/src/__tests__/dispatch_flow.test.ts`

## Acceptance Criteria
- [x] Rover Agent 仅能访问 `read_only_bash` 与 `dispatch_agent` 两个受控工具，工具入参受 TypeBox 强类型校验。
- [x] `read_only_bash` 严格限制只读命令白名单，拦截任意网络命令（`curl`, `wget`）、修改删除命令（`rm`, `git commit`）与写重定向（`>`），并具备超时与截断防护。
- [x] 模拟触发派发流程，在拿到 Native Session ID 之前，数据库中 `task` 表条目为 0。
- [x] 成功捕获原生 Session ID 后，原子事务执行，`task`、`session_ref`、`task_event` 三表同时存在记录，并经 WebSocket 广播 `task.changed`。
- [x] 模拟 CLI 启动崩溃场景，验证 `dispatch_attempt` 记录失败原因，不残留任何孤儿或空 Task。

## Verification Plan
```bash
pnpm --filter @rover/runtime test packages/runtime/src/__tests__/dispatch_flow.test.ts
```
