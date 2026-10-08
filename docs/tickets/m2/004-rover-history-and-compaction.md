# 004: 全局 History 与 Compaction 存储

**Status**: DONE  
**Blocked By**: 001  
**Blocks**: 005  

## Context & Goal
根据 [ADR-0001](../../adr/0001-global-rover-history.md)、[ADR-0014](../../adr/0014-linear-rover-entries-and-compaction.md) 与 CONTEXT.md，Rover 沿用一份跨用户目标的全局持续 history。基于 SQLite `rover_entry` 保存完整原始消息与独立 compaction 条目，构建有限预算下的有效上下文；原始历史保留，摘要可追溯但有损，不承担 Task/Session 关联的事实来源职责。

## Specification & Invariants
1. **全局 History 持久化 (`rover_entry`)**：
   - 字段与约束以 ADR-0014 为准：`seq`、稳定 UUID `id`、`turn_id`、`type`、`schema_version`、JSON `data`、`created_at`；不使用 `conversation_id`、`ordinal` 或 `is_compacted`；
   - 每个 `message` entry 保存一个完整 `AgentMessage`（user、各次独立 assistant、toolResult），在消息完成后追加，并在同一事务写对应 `runtime_event`；
   - 按 `seq` 排序，通过 `turn_id` 聚合回合；`rover_turn` 投影用于区分运行中和已结束回合；
   - `getEffectiveHistory` 在同一短读事务/固定 head 中读取最新累计摘要及覆盖边界之后的原始消息，不能只读取摘要 entry 之后的消息。
2. **上下文估算与 Compaction 策略**：
   - 每次模型调用前估算完整上下文，扣除 System Prompt、工具 Schema、记忆/检索注入、当前运行中回合、输出预留和安全余量，不能按固定历史占比触发；
   - 按预算保留最新连续完整回合后缀，压缩更老的完整回合前缀，避免割裂工具调用链；默认不压缩运行中的回合；
   - 仅在生成成功并通过基准/边界校验后追加 `compaction` entry，记录 `summary`、`coveredThroughSeq`、`previousCompactionId` 与生成依据，不修改原始消息；
   - 再次压缩使用上一份累计摘要与新覆盖消息；全局只允许一个压缩任务在途，拒绝过期发布。后台压缩不够及时且下次调用超预算时，等待必要的前台压缩；
   - 摘要显式提取重要约束、结论、Task ID 与仓库引用，但不宣称无损；Thinking 与签名原样存储，回放由供应商上下文转换器决定；
   - 单回合或工具输出过大时，实施输出限额、分段读取或受控摘要，不能靠整轮截断解决。
3. **隔离性约定**：
   - 待处理 Prompt 队列（尚未开启回合的输入）保存在 UI 内存，不得提前写入 `rover_entry`；
   - 外部未确认的 Inbox 消息或原始 CLI 终端输出不得直接进入全局 History。

## Affected Components & Files
- `packages/runtime/src/storage/repositories/history.ts`
- `packages/runtime/src/agent/compaction.ts`
- `packages/runtime/src/storage/types.ts`
- `packages/runtime/src/__tests__/history.test.ts`

## Acceptance Criteria
- [x] 跨回合完整保存原始消息及工具结果，按 `seq` 恢复顺序；相同 ID 的一致重试去重，内容冲突明确拒绝。
- [x] 达到动态预算阈值时，按完整回合边界追加摘要，原始消息不更新或删除，当前输入不重复注入。
- [x] 验证摘要追加前已存在的保留消息、后台生成期间新增消息均进入有效上下文，连续压缩使用最新累计摘要。
- [x] 验证运行中回合不被默认压缩、过期摘要拒绝发布及生成失败不改变覆盖边界。
- [x] 摘要样例保留重要 Task ID、仓库引用和约束；已提交消息在 Runtime 崩溃后仍可查询。

## Verification Plan
```bash
pnpm --filter @rover/runtime test packages/runtime/src/__tests__/history.test.ts
```
