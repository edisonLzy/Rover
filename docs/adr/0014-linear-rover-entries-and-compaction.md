# Rover 历史采用消息粒度的线性 Entry 与独立 Compaction 条目

> 状态：已采纳 · 2026-10-02
>
> 部分替代 [ADR-0012](./0012-context-compaction-and-tiered-memory.md)：历史表结构、归档标记、摘要存储方式、Thinking 回放规则及拒绝 Entry 抽象的理由以本文为准。动态上下文预算和历史与长期记忆分离的原则继续适用；独立长期记忆的具体机制不在本决策范围内。

## 背景

依据 [ADR-0001](./0001-global-rover-history.md) 与 [CONTEXT.md](../../CONTEXT.md)，Rover 只有一份跨用户目标持续的全局 Agent history，不提供项目级会话列表或日常上下文重置。一次 Rover 输入回合从用户输入被 Runtime 接受开始，到即时答复、澄清或派发结果结束；已派发 Code Agent 的执行不延长该回合，其完整对话仍归原生 Session 所有。

持续历史需要保存完整的模型消息与工具调用链，同时为有限的模型上下文构建压缩后的视图。Dashboard 后续也需要展示运行日志。原方案通过修改 `is_compacted` 和向消息表插入系统摘要实现压缩，混合了原始事实与上下文选择状态；将内容拆为纯文本和 Thinking 字段也不足以保留 Pi 多块消息及供应商协议信息。

Entry 是有类型的持久记录，不必采用分支树。Rover 可以使用单线 Entry 日志，而不引入 `parent_id`、fork 或 leaf 指针。

## 决策

以 `rover_entry` 替代 `rover_message`。正常历史写入只追加条目，初始类型为 `message` 与 `compaction`。一个 `message` entry 保存一个完整的原始 `AgentMessage`；通过 `turn_id` 聚合 Rover 输入回合。持久化、业务执行和压缩的单位分别是：

```text
持久化单位：一个完成的 AgentMessage
业务单位：  一个 Rover 输入回合
压缩单位：  连续历史前缀中的完整 Rover 输入回合
```

数据库不把整轮消息数组保存为一条 entry。整轮 `messages[]` 是查询或展示层的聚合结果。Pi 的 `turn_start/turn_end` 对应内部模型响应及工具执行步骤，不能直接作为 Rover 输入回合边界；一次 Agent run 也可能消费多个 follow-up 或 steering 输入。Rover M2 的待处理 Prompt 在用户确认处理前留在 UI，不进入 Agent run 或历史。

### 表结构与字段

历史体系由两张表协同构成：`rover_turn` 承载用户输入回合的生命周期投影与富文本原稿，`rover_entry` 承载不可变的消息日志与独立 Compaction 记录。`rover_turn` 先于 `rover_entry` 创建。

```sql
CREATE TABLE rover_turn (
  id TEXT PRIMARY KEY,
  status TEXT NOT NULL CHECK (status IN ('running', 'completed', 'failed', 'cancelled')),
  prompt_doc TEXT NOT NULL CHECK (json_valid(prompt_doc)),
  error TEXT,
  created_at INTEGER NOT NULL,
  completed_at INTEGER
);

CREATE TABLE rover_entry (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  id TEXT NOT NULL UNIQUE,
  turn_id TEXT REFERENCES rover_turn(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('message', 'compaction')),
  schema_version INTEGER NOT NULL DEFAULT 1 CHECK (schema_version >= 1),
  data TEXT NOT NULL CHECK (json_valid(data)),
  created_at INTEGER NOT NULL,
  CHECK (
    (type = 'message' AND turn_id IS NOT NULL)
    OR (type = 'compaction' AND turn_id IS NULL)
  )
);

CREATE INDEX idx_rover_entry_turn_seq ON rover_entry(turn_id, seq);
CREATE INDEX idx_rover_entry_latest_compaction
  ON rover_entry(seq DESC) WHERE type = 'compaction';
```

#### `rover_turn` 字段与约束

| 字段 | 含义与约束 |
| --- | --- |
| `id` | 稳定 UUID（`turn_id`），一次用户输入对应一个唯一回合。 |
| `status` | 回合生命周期状态：`running`（运行中）、`completed`（成功完成）、`failed`（执行失败）、`cancelled`（用户取消）。禁止根据末条 entry 推断。 |
| `prompt_doc` | 原始 `PromptDocumentV1` JSON。保留富文本及显式 `@Agent`、`/skill`、`#inbox` 结构化引用，供追溯、重试与审计。 |
| `error` | 失败、超时或异常中止时的结构化错误或原因描述；正常完成为 NULL。 |
| `created_at` | 回合接收并创建的时间，UTC Unix 毫秒。 |
| `completed_at` | 回合达到终态（`completed` / `failed` / `cancelled`）的时间，UTC Unix 毫秒；运行中为 NULL。 |

#### `rover_entry` 字段与约束

| 字段 | 含义与约束 |
| --- | --- |
| `seq` | SQLite 分配的追加顺序，用于读取游标、排序和精确的压缩覆盖边界。允许有空洞，不要求连续；与 `runtime_event.event_seq` 是不同序列。 |
| `id` | 稳定 UUID，用于跨层引用和写入重试去重，可在入库前生成。相同 ID 的重试必须验证内容一致，不能静默覆盖。 |
| `turn_id` | 原始消息所属的 Rover 输入回合；压缩条目为 NULL。它不是 Code Agent 的原生 Session ID。外键约束支持级联清理。 |
| `type` | 决定 `data` 的持久化契约，初始只开放 `message`、`compaction`。 |
| `schema_version` | 持久化载荷格式版本。读取时按类型和版本解码；不是 Pi 包版本、模型版本或数据库迁移版本。 |
| `data` | JSON 序列化载荷。数据库检查 JSON 语法，Runtime 再校验类型、版本和语义。 |
| `created_at` | 条目入库时间，UTC Unix 毫秒；不作为历史排序或摘要截断依据。消息自身的时间戳保留在 `data`。 |

保留 UUID 与 `seq` 的理由是稳定身份与追加顺序职责不同；若未来统一使用整数 ID，可重新评估合并，而不是把双字段视为通用必需品。当前不添加 `conversation_id`，因为没有第二份 Rover 会话；不添加 `ordinal`，因为 `seq` 已提供轮内顺序，稳定 ID 已支持去重。显示位置可以查询时计算。

### Message 载荷与写入时机

`message.data` 是完整的 Pi `AgentMessage` 对象，保留 user、各次独立 assistant 和 `toolResult`。保留文本、图片、Thinking、工具调用块、调用 ID、供应商签名，以及消息自带的模型、usage、stopReason 等元数据。不合并多次模型调用为一个原始 assistant 消息，不用 UI 气泡或 `toolStates` 反推原始历史。

Runtime 接受用户输入时，在同一事务中建立回合记录、追加 user entry 并写对应 `runtime_event`。回合记录保留原始 `PromptDocumentV1`，使显式 Agent/Skill/Inbox 引用可追溯，不仅保留转换后的文本。当前输入进入上下文一次，不因“入库后读取历史，再追加当前输入”重复注入。

每个完整 assistant 或 `toolResult` 消息产生后立即追加，不等整个回合结束。对将要执行的工具调用，Runtime 应在调用相关副作用前完成承载该调用的 assistant 消息持久化。流式片段只用于当前展示与事件传输，不逐片追加 Entry；供应商返回的终止消息，包括 error 或 aborted 消息，仍按实际内容保存。进程崩溃前尚未形成完整消息的流式草稿不属于完整历史。

Entry 追加及其对应的同步事件在同一 SQLite 事务提交。回合的运行状态、结束状态等由 `rover_turn` 投影维护，不能用“最后一条是不是 assistant”推断。持久化消息不等于工具恰好执行一次；工具幂等、派发核对与外部副作用恢复仍由相应领域机制负责。

回合异常、失败或被用户取消时，系统更新 `rover_turn` 的终态状态（`failed` 或 `cancelled`）及 `error` 原因，**严禁物理删除已写入的 user 或中间 entry**。失败与取消是已发生客观事实的一部分：保留这些记录保证外部已执行的副作用可追溯、支持用户重试，并允许后续对话理解历史报错。上下文构建器读取有效历史时，根据合法的消息链与回合终态组装上下文，不因单次失败而损坏全局历史。

存储保留 Thinking 与协议元数据；上下文转换器根据供应商、模型和当前调用阶段决定回放。不能统一剥离所有历史 Thinking 或签名，尤其不能破坏仍在进行的工具调用协议。

### Compaction 载荷与上下文构建

成功生成并校验摘要后才追加 `compaction` entry，不更新原始消息的归档状态，也不把摘要伪装为原始 system message。载荷示例：

```json
{
  "summary": "历史摘要，包含重要约束、结论及可追溯引用……",
  "coveredThroughSeq": 6,
  "previousCompactionId": null,
  "policyVersion": 1,
  "provider": "summarizer-provider",
  "model": "summarizer-model",
  "tokensBefore": 25000,
  "tokensAfter": 15000
}
```

`coveredThroughSeq` 必须指向本次累计摘要覆盖的最后一条原始消息，且是可安全截断的 Rover 回合边界。`previousCompactionId` 记录本次生成使用的上一份摘要；首次为 NULL。`policyVersion` 记录摘要策略版本。模型来源用于追溯，Token 统计是生成快照下的估算，可以省略，不能当作未来请求的实际 Token 用量。

有效历史为最新累计摘要，加上所有 `type = 'message' AND seq > coveredThroughSeq` 的消息，按 `seq` 排序。没有摘要时使用原始消息。其他类型条目不直接转为模型消息。读取摘要与原始消息后缀时，使用同一短读事务及固定 head，避免生成不一致的上下文快照。

```text
seq  type        turn_id  data
---  ----------  -------  ----------------------------------
1    message     T1       user
2    message     T1       assistant(toolCall)
3    message     T1       toolResult
4    message     T1       assistant(final)
5    message     T2       user
6    message     T2       assistant(final)
7    message     T3       user
8    message     T3       assistant(final)
9    compaction  NULL     C1，coveredThroughSeq=6
10   message     T4       user
11   message     T4       assistant(final)
12   compaction  NULL     C2，coveredThroughSeq=8，previous=C1

C1 的有效历史 = C1.summary + 消息 7、8
C2 的生成输入 = C1.summary + 消息 7、8
C2 的有效历史 = C2.summary + 消息 10、11
```

摘要 entry 的追加位置不是截断位置。后台生成摘要时新到达的消息，只要超出覆盖边界，仍保留在有效历史中。每次再压缩使用上一份累计摘要和新覆盖的原始前缀，旧摘要只保留为生成依据，不与新摘要同时注入。

M2 对全局历史只允许一个压缩任务在途。发布摘要前校验基准摘要仍是当前版本、覆盖边界合法且前进；不满足时丢弃过期结果并重新评估。生成失败不追加有效摘要、不改变覆盖边界。原始记录保持可检索，摘要是有损上下文，不能保证原话或事实锚点永不丢失；Task 与 Session 的关联仍以领域表为准。

### 触发预算与回合边界

每次模型请求前重新评估预算，包括工具返回后触发的下一次模型请求。预算计入 System Prompt、工具 Schema、检索与记忆注入、当前输入及运行中回合、输出预留和安全余量；输出上限已经包含的 reasoning 预算不能重复扣减。产品的目标输入预算可以低于模型最大窗口，阈值不能仅按消息条数或固定历史占比决定。

默认根据 Token 预算保留最新的连续完整回合后缀，将更老的完整回合前缀压缩。正常在回合结束后提前触发后台压缩；下次请求若已无法容纳，则等待必要的前台压缩完成。压缩前缀内的工具调用与工具结果共同纳入摘要，后缀内的完整调用链共同保留。

运行中的回合默认不压缩。取消、失败回合也必须记录实际终止事实；是否可作为截断边界取决于消息链和上下文转换合法性，不能编造缺失的工具结果。若单个回合或工具结果已经超过预算，必须通过工具输出限额、分段读取或受控摘要等方式处理，整轮划分本身不能解决该问题。

## 边界与后果

- `rover_entry` 服务于 Rover Agent 的消息与压缩记录，不吸收 `task_event`、`activity`、计划运行和 Inbox 等领域事实。Dashboard 统一运行日志可以聚合这些来源；Entry 本身不是全应用日志库。
- `runtime_event` 服务于状态同步和断点重放，有滚动保留窗口，不能替代永久 Agent history。
- 普通写入 append-only 不取消用户删除本地数据、纠正或遗忘信息的能力。授权清理涉及摘要来源时，必须同时清理或重建受影响的摘要，不能让已删除事实继续由摘要回注。
- 原始消息保留带来存储增长；M2 不用上下文压缩替代数据保留策略，附件外置、历史保留期限与独立长期记忆机制另行设计。
- `rover_turn` 的完整结构、取消与崩溃恢复、派发工具幂等及 Dashboard 日志查询接口需要后续决策；本文不预先承诺自动恢复或重放工具。

## 备选方案

| 方案 | 评估 |
| --- | --- |
| 原始消息表 + 独立摘要表 | 同样能正确表达原始历史与压缩视图；在消息、压缩记录需要共同追溯的场景，线性 Entry 更便于统一查询和类型扩展。不是所有 Agent 都必须使用 Entry。 |
| 一个 turn entry 保存完整 `AgentMessage[]` | 回合封装和压缩选择简单，但若坚持 append-only，需要等回合终止后落盘，或另建持久化缓冲。Rover 选择消息完成后立即追加，以保留工具链进展；整轮数组作为查询聚合。 |
| 修改 `is_compacted`、混入 system 摘要 | 原始事实与当前上下文选择混合，重复压缩及并发边界更难追溯，不采用。 |
| 只保留最近消息的滑动窗口 | 成本低，但持续伴侣容易失去早期约束与话题背景，不作为默认策略。 |
| 带 parent/leaf 的分支 Entry 树 | Rover 没有 fork、rewind 或多会话交互需求，不采用。 |

## 实施与验证

同步 M2 Ticket 001、004、005：初始化 `rover_turn`/`rover_entry`，实现消息仓储和上下文构建器，将写入点放在 Runtime 而非 React 展示层。当前 M2 存储尚未实现，本次变更是设计文档，不是已完成数据库迁移；若实现时存在旧数据，迁移需保留原文与来源，不能从纯文本补造缺失的工具或供应商元数据。

必要验证包括消息写入重试的一致性、完整工具链保存、未结束回合不会被默认压缩、摘要追加前已有保留消息仍会进入上下文、压缩期间新增消息不丢失、累计摘要边界前进及过期结果拒绝、当前输入不重复注入，以及回合崩溃后已提交消息仍可查询。

## 参考

- [Pi SessionManager 与上下文构建](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/src/core/session-manager.ts)、[Pi Compaction 说明](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/compaction.md)：类型化 Entry、独立压缩记录和保留消息边界的参考；Rover 不照搬分支结构。
- 本次审阅的本地 `neon-server/packages/agent-service/src/services/entries.ts`：`appendEntries` 在事务中插入多个独立数据库行，不是整轮数组 entry。
- 本次审阅的本地 `divisor-agent/packages/app/src/renderer/pages/workspace/use-agent-messages.ts`：运行结束后批量提交展示条目，且合并 assistant 内容、单独管理工具 UI 状态；Rover 不将这一展示投影用作原始历史。
