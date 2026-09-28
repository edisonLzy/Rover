# 005: Pi Agent Loop 回合引擎与流式响应

**Status**: TODO  
**Blocked By**: 001, 002, 003, 004  
**Blocks**: 006, 010  

## Context & Goal
Rover Agent 负责接收用户输入，并产生即时答复、提出澄清问题或调用受控工具。本任务集成 Pi Agent Core loop，建立完整的 Rover 输入回合生命周期管理，支持流式 Token 下发与 WebSocket 双向状态同步，构成用户与 Rover 对话的核心驱动引擎。

## Specification & Invariants
1. **回合接口与预算控制 (`POST /v1/turns`)**：
   - 接收 `PromptDocumentV1` 并进行强校验，解析其中的指令片段（如显式 `/skill`、`@Agent` 意图）；
   - 为单次回合分配隔离的 `turn_id`；
   - 实施防御性预算边界：最大思考步数（如 10 步）、超时控制（如 60s）、最大输出 Token；
   - 支持主动取消接口：`POST /v1/turns/{id}/cancel`，及时中止模型流式生成或工具调用。
2. **Pi Agent Loop 驱动流程**：
   - 从 `rover_message` 读取有效 History，组装 System Prompt 与当前用户 Prompt；
   - 驱动 Pi Agent Loop（支持 Tool Call 决策与文本流式生成）；
   - 回合产生三类即时结果：直接解答（回答用户咨询）、澄清提问（关键信息缺失时追问）、受控工具调用（如触发任务派发）；
   - 回合结束时原子追加 `assistant` 消息入库，持久化至 `rover_message`。
3. **实时流式与事件协议 (WebSocket)**：
   - 生成过程中实时推送 `turn.delta`（包含增量文本块、正在思考的状态标识）；
   - 回合结束推送 `turn.end`（包含完整结果、耗时、Token 统计与最终状态 `completed | cancelled | failed`）；
   - 所有事件均携带递增 `eventSeq` 并同步记入 `runtime_event` 表。

## Affected Components & Files
- `packages/runtime/src/agent/loop.ts`
- `packages/runtime/src/agent/engine.ts`
- `packages/runtime/src/agent/prompts.ts`
- `packages/runtime/src/transport/router.ts` (turns 路由)
- `packages/runtime/src/transport/websocket.ts`
- `packages/runtime/src/__tests__/turns.test.ts`

## Acceptance Criteria
- [ ] 提交合法 `PromptDocumentV1` 能成功启动模型调用，并在 WebSocket 收到连续递增序号的 `turn.delta` 事件。
- [ ] 模型输出完毕后，WebSocket 收到 `turn.end`，且 SQLite `rover_message` 中能查询到该回合完整的 assistant 记录。
- [ ] 调用取消接口能立即截断模型输出，并将回合状态标记为 `cancelled`。
- [ ] 异常测试：在未配置 API Key 或模型网络不可达时，向客户端返回明确的结构化错误码，不发生进程 Crash。

## Verification Plan
```bash
pnpm --filter @rover/runtime test packages/runtime/src/__tests__/turns.test.ts
```
