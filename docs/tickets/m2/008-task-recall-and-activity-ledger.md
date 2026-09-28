# 008: 任务摘要回忆 (task-recall) 与最近活动台账

**Status**: TODO  
**Blocked By**: 001, 006, 007  
**Blocks**: 011  

## Context & Goal
根据 CONTEXT.md，Rover 具备两个关键的辅助记忆能力：
1. **最近活动 (`activity`)**：记录近期实际完成的操作与结束的 Task，回答用户“最近做了什么”；
2. **任务摘要回忆 (`task-recall`)**：检索本地 Code Agent 在原会话中提交的 `task_summary`，作为新一轮对话的只读证据，而不创建新的 Code Agent Session。

## Specification & Invariants
1. **最近活动台账 (`activity`)**：
   - 触发时机：当 Task 达到终态（`completed` / `failed`）或 Rover 自主完成特定操作时；
   - 字段：`id, kind, ref_id, title, summary, occurred_at`；
   - 提供 `GET /v1/activities?limit=20` 供 Dashboard 呈现；
   - 绝不把普通的闲聊问候记为活动。
2. **Task 摘要与 N-Gram 检索 (`task_summary`)**：
   - Code Agent 通过 helper 的 `report` 命令提交任务摘要，存入 `task_summary`；
   - 为中文与英文摘要构建字符级 2-gram/3-gram 索引（避免外部庞大依赖）；
   - 在接收到自然语言查询时，首先由 SQLite 倒排索引检索候选，再由当前 Pi 模型进行重排（rerank）。
3. **内置 Skill: `task-recall`**：
   - 供 Rover Agent 在需要回忆旧任务时使用；
   - 检索命中后，将摘要内容作为工具结果注入当前回合，供 Rover 直接回答或在新派发任务中作为前置背景；
   - 仅检索不产生新的 Code Agent Session 或 Task。

## Affected Components & Files
- `packages/runtime/src/storage/repositories/activity.ts`
- `packages/runtime/src/storage/repositories/summary.ts`
- `packages/runtime/src/skills/builtin/task-recall.ts`
- `packages/runtime/src/search/ngram.ts`
- `packages/runtime/src/__tests__/recall.test.ts`

## Acceptance Criteria
- [ ] Task 结束时自动在 `activity` 表新增记录，API 能按时间倒序拉取。
- [ ] 插入一段测试摘要，通过 N-Gram 索引能准确通过关键词模糊检索召回。
- [ ] Agent 执行 `task-recall` 工具后，摘要成功返回至 Agent Context，不触发派发流程。

## Verification Plan
```bash
pnpm --filter @rover/runtime test packages/runtime/src/__tests__/recall.test.ts
```
