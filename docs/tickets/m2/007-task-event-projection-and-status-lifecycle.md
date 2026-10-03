# 007: 任务事件投影与状态生命周期管理

**Status**: DONE  
**Blocked By**: 001, 006  
**Blocks**: 008, 010, 011  

## Context & Goal
M1 建立了基于 Hook Helper 与本地 Spool 的事件采集管道。根据 TRD 第 5 节与 CONTEXT.md，Task 的事实状态不能凭空推断，必须由消费 Spool 事件流并进行去重后投影得出。本任务实现 Spool 消费循环、`task_event` 去重存储，以及将底层信号映射为 Task 的 `running`、`needs_intervention`、`completed`、`failed`、`unverified` 等生命周期状态。

## Specification & Invariants
1. **Spool 消费者与事件去重**：
   - 监听/轮询 M1 的本地 Spool 目录；
   - 提取事件：`source_event_id`、`native_session_id`、`kind`（如 `SessionStart`, `PermissionRequest`, `Stop`, `SessionEnd`）与显式 `report` 载荷；
   - 依据 `task_id + source + source_event_id` 唯一约束写入 `task_event` 表，重复事件静默幂等忽略。
2. **状态机投影映射准则**：
   - `SessionStart`: 确认处于 `running`；
   - `PermissionRequest` / 显式等待输入: 状态跃迁至 `needs_intervention`（需要用户介入）；用户在 Terminal 中批准后恢复 `running`；
   - `Stop`: 仅代表单次回合停顿，不等于目标完成；
   - **完成态阻断红线（防止无证据判定成功）**：
     - 唯有 Code Agent 经 helper 发出显式 `report(status: "completed")` 时，才将 Task 状态标记为 `completed` 并写入 `result_text`；
     - 若承载进程 Screen 退出但无完成回报，状态标记为 `unverified`（状态待核对），绝不盲目假定成功；
     - 若显式上报失败或发生不可恢复异常，标记为 `failed`。
3. **事件同步**：
   - 状态或进度发生变更时，写入 `runtime_event`（`type: "task.changed"`），通过 WebSocket 实时通知前端。

## Affected Components & Files
- `packages/runtime/src/observe/consumer.ts`
- `packages/runtime/src/observe/projector.ts`
- `packages/runtime/src/storage/repositories/task-events.ts`
- `packages/runtime/src/observe/types.ts`
- `packages/runtime/src/__tests__/projection.test.ts`

## Acceptance Criteria
- [x] 模拟写入连续的 Spool 文件（含重复的 event id），验证 `task_event` 表能准确去重。
- [x] 接收到权限申请事件时，Task 状态变为 `needs_intervention`，并通过 WebSocket 广播给前端。
- [x] 进程意外退出且无完成回报时，状态为 `unverified`；只有显式调用 report 成功时才变为 `completed`。

## Verification Plan
```bash
pnpm --filter @rover/runtime test packages/runtime/src/__tests__/projection.test.ts
```
