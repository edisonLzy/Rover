# 014d: Human-in-the-Loop (HITL) 权限审批与用户提问状态机集成

**Status**: TODO  
**Blocked By**: 014c  
**Blocks**: None  

## Context & Goal

依据 [ADR-0019](../../adr/0019-agent-runtime-callbacks-and-decoupled-lifecycle.md)，参考 `divisor-agent` 中经过实战验证的 HITL 设计，为 Rover AgentRuntime 引入基于 Promise 延迟挂起与恢复的状态机，支持高危工具权限控制（Permission Approval）与 Agent 澄清提问（Ask User Question）。

## Specification & Invariants

1. **HITL 抽象基类 (`AbstractHumanInTheLoop`)**：
   - 位于 `packages/runtime/src/agent/runtime/hitl/abstract-hitl.ts`；
   - 泛型定义：`AbstractHumanInTheLoop<TKind, TPayload, TResult>`；
   - 内存维护 `pendingRequests = new Map<string, PendingRequest>()`；
   - `request(payload)`：生成全局唯一 `requestId`，返回 Promise 挂起当前协程，并派发事件；
   - `resolve(requestId, result)`：提取挂起的 Promise 并正常返回值唤醒协程；
   - `cancelAll(reason)`：回合中断或销毁时批量 Reject 所有挂起项，彻底防止幽灵挂起与内存泄露。

2. **高危工具权限服务 (`PermissionService`)**：
   - 位于 `packages/runtime/src/agent/runtime/hitl/permission-service.ts`；
   - 在 `Agent` 配置的 `beforeToolCall` 钩子中介入：
     - 若工具风险等级为 `high`（高危），且不在已记住批准的前缀列表（`rememberApproval`）中，调用 `requestPermission()` 挂起；
     - 触发 Callbacks 的 `onPermissionRequested` 通知前端渲染授权卡片；
     - 客户端通过 RPC 决算后调用 `resolvePermissionRequest(requestId, resolution)`；若拒绝则向 Agent 返回 `{ block: true, reason }`。

3. **Agent 澄清提问服务 (`AskUserQuestionService`)**：
   - 位于 `packages/runtime/src/agent/runtime/hitl/ask-user-question-service.ts`；
   - 注册内置工具 `ask_user_question`，Agent 调用该工具时挂起；
   - 触发 Callbacks 的 `onAskUserQuestionRequested` 通知前端渲染选择题/输入表单；
   - 客户端提交后唤醒工具执行并返回结构化答案。

## Affected Components & Files

- `packages/runtime/src/agent/runtime/hitl/abstract-hitl.ts`
- `packages/runtime/src/agent/runtime/hitl/permission-service.ts`
- `packages/runtime/src/agent/runtime/hitl/ask-user-question-service.ts`
- `packages/runtime/src/agent/runtime/agent-runtime.ts`（集成 `beforeToolCall` 与问答工具）
- `packages/runtime/src/__tests__/hitl.test.ts`

## Acceptance Criteria

- [ ] 调用标记为 high 的高危工具时，执行回路自动挂起，Callbacks 派发 `permission_requested`。
- [ ] 外部调用 `resolve(requestId, { approved: true })` 后工具继续执行；调用 `{ approved: false }` 后工具被阻止并向模型返回拒绝理由。
- [ ] 调用 `ask_user_question` 工具时回路挂起，用户提交回答后模型恢复并拿到回答内容。
- [ ] 在挂起期间调用 `runtime.abortPrompt()`，所有 pending Promise 被安全拒绝（CancelledError），不发生无响应死锁。

## Verification Plan

```bash
pnpm --filter @rover/runtime test packages/runtime/src/__tests__/hitl.test.ts
```
