# 006: 受控工具链与 Task 事务原子创建

**Status**: TODO  
**Blocked By**: 001, 005  
**Blocks**: 007, 008, 009, 010  

## Context & Goal
Rover Agent 在回合中通过工具调用派发 Code Agent。根据 TRD 第 4 与第 5 节，Rover Agent 必须受到受控工具边界的严格限制，杜绝任意 Shell 或网络操作；当决定派发 Code Agent 时，执行内置 `agent-dispatch` 流程，调用 M1 构建的 `Dispatcher` 与 `ScreenSupervisor`，并恪守核心不变量：**唯有在取得受可信信号证实的原生 Session ID 后，才在单一事务中创建 Task，彻底杜绝“空 Task”**。

## Specification & Invariants
1. **受控工具安全沙箱**：
   - 严禁赋予 Rover Agent 通用 shell 执行、文件任意写或未受限网络请求工具；
   - 仅挂载白名单受控工具：
     - `list_skills`: 查阅当前可用 Skill 及其触发条件；
     - `inspect_repo`: 仅限只读检查指定目标仓库的目录、分支、语言类型与配置文件；
     - `query_tasks`: 查询已有任务状态与结果；
     - `dispatch_agent`: 派发 Code Agent 工具。
2. **`agent-dispatch` 与 Task 事务创建生命周期**：
   - 步骤 1：生成派发尝试 ID、候选 Task UUID、上报 Token，并写入 `dispatch_attempt` 表；此时**不得**向前端展示 Task 卡片或创建 `task` 记录；
   - 步骤 2：调用 M1 的 `Dispatcher`，启动 GNU Screen 后台会话承载；
   - 步骤 3：等待可信的 Native Session ID（如 Claude 的预分配 UUID 或 Codex 的 `SessionStart` Hook 回传）；
   - 步骤 4（核心事务）：在单一 SQLite 事务内写入：
     - `session_ref`（记录 `agent`, `native_session_id`, 承载名称, `availability: "available"`）；
     - `task`（记录 `id`, `goal`, `agent`, `status: "running"`, `created_at`）；
     - 首个 `task_event`（`kind: "dispatched"`）；
     - 对应 `runtime_event`（`type: "task.changed"`）；
   - **阻断红线**：若启动失败或未能在超时内捕获原生 Session ID，将 `dispatch_attempt` 标记为 `failed`，**严禁创建空 Task 记录**。
3. **Task 查询 API**：
   - `GET /v1/tasks`: 获取当前 Task 列表（含状态、进度文本、目标）；
   - `GET /v1/tasks/{id}`: 获取指定 Task 的详细事件链与会话引用信息。

## Affected Components & Files
- `packages/runtime/src/agent/tools/index.ts`
- `packages/runtime/src/agent/tools/dispatch.ts`
- `packages/runtime/src/agent/tools/repo.ts`
- `packages/runtime/src/skills/builtin/agent-dispatch.ts`
- `packages/runtime/src/storage/repositories/tasks.ts`
- `packages/runtime/src/transport/router.ts` (tasks 路由)
- `packages/runtime/src/__tests__/dispatch_flow.test.ts`

## Acceptance Criteria
- [ ] Rover Agent 无法调用非白名单工具，工具入参受到 Zod 校验。
- [ ] 模拟触发派发流程，在拿到 Native Session ID 之前，数据库中 `task` 表条目为 0。
- [ ] 成功捕获原生 Session ID 后，原子事务执行，`task`、`session_ref`、`task_event` 三表同时存在记录，并经 WebSocket 广播 `task.changed`。
- [ ] 模拟 CLI 启动崩溃场景，验证 `dispatch_attempt` 记录失败原因，不残留任何孤儿或空 Task。

## Verification Plan
```bash
pnpm --filter @rover/runtime test packages/runtime/src/__tests__/dispatch_flow.test.ts
```
