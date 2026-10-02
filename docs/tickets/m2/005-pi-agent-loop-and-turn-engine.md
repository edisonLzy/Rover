# 005: Pi Agent Loop 回合引擎与流式响应

**Status**: DONE  
**Blocked By**: 001, 002, 003, 004  
**Blocks**: 006, 010  

## Context & Goal
Rover Agent 负责接收用户输入，并产生即时答复、提出澄清问题或调用受控工具。本任务集成 Pi Agent Core loop，建立完整的 Rover 输入回合生命周期管理，支持流式 Token 下发与 WebSocket 双向状态同步，构成用户与 Rover 对话的核心驱动引擎。

## Specification & Invariants
1. **回合接口与预算控制 (`POST /v1/turns`)**：
   - 接收 `PromptDocumentV1` 并进行强校验，解析其中的指令片段（如显式 `/skill`、`@Agent` 意图）；
   - 为单次 Rover 输入回合分配 `turn_id`，维护 `rover_turn` 生命周期投影并保存原始 `PromptDocumentV1`；不将 Pi 内部 `turn_end` 直接视为 Rover 回合结束；
   - 实施防御性预算边界：最大思考步数（如 10 步）、超时控制（如 60s）、最大输出 Token；
   - 支持主动取消接口：`POST /v1/turns/{id}/cancel`，及时中止模型流式生成或工具调用。
2. **Pi Agent Loop 驱动流程**：
   - 按 [ADR-0014](../../adr/0014-linear-rover-entries-and-compaction.md) 从 `rover_entry` 构建“最新累计摘要 + 覆盖边界之后的原始消息”，组装 System Prompt；已入库的当前用户 Prompt 只注入一次，每次模型请求前检查预算；
   - 驱动 Pi Agent Loop（支持 Tool Call 决策与文本流式生成）；
   - 回合产生三类即时结果：直接解答（回答用户咨询）、澄清提问（关键信息缺失时追问）、受控工具调用（如触发任务派发）；
   - 接受输入时原子创建回合与 user entry；每个完整 assistant/toolResult 消息产生后立即追加，相关工具调用消息先于副作用执行落盘；不等待整个回合结束，不合并多次模型调用的原始消息；
   - 在 Runtime 层持久化，流式片段服务于展示与事件传输；回合终止时更新生命周期投影并保留实际 error/aborted 消息；取消、崩溃恢复和工具幂等的具体策略另行定稿，不能根据历史自动重放副作用。
3. **实时流式与事件协议 (WebSocket)**：
   - 生成过程中实时推送 `turn.delta`（包含增量文本块、正在思考的状态标识）；
   - 回合结束推送 `turn.end`（包含完整结果、耗时、Token 统计与最终状态 `completed | cancelled | failed`）；
   - 所有事件均携带递增 `eventSeq` 并同步记入 `runtime_event` 表。

## Affected Components & Files
- `packages/runtime/src/agent/engine.ts`
- `packages/runtime/src/agent/prompts.ts`
- `packages/runtime/src/transport/router.ts` (turns 路由)
- `packages/runtime/src/transport/websocket.ts`
- `packages/runtime/src/__tests__/turns.test.ts`

## Acceptance Criteria
- [x] 提交合法 `PromptDocumentV1` 后 user entry 已持久化，能成功启动模型调用，并在 WebSocket 收到连续递增序号的 `turn.delta` 事件。
- [x] 完整消息产生后立即落库；模型输出完毕后收到 `turn.end`，`rover_entry` 可按 `turn_id` 查询完整原始消息链，`rover_turn` 有真实结束状态。
- [x] 调用取消接口能立即截断模型输出，并将回合状态标记为 `cancelled`。
- [x] 异常测试：在未配置 API Key 或模型网络不可达时，向客户端返回明确的结构化错误码，不发生进程 Crash。

## Verification Plan
```bash
pnpm --filter @rover/runtime test packages/runtime/src/__tests__/turns.test.ts
```
