# 014: 本地 Inbox 与 Agent Loop follow-up

**Status**: TODO  
**Blocked By**: 005, 013  
**Blocks**: None  

## Context & Goal

将原待处理 Prompt 队列升级为可从工具栏打开的本地 Inbox，提供已确认的 `immediate` 与 `suspended` 两种交互；仅补齐实现这些交互所必需的 Runtime follow-up 能力。

这里的 Inbox item 是前端临时 Prompt，尚不是 TRD 第 8 节的持久化外部消息。本次修订替代 010 中「所有排队 Prompt 都需确认」的旧交互：只有 `suspended` 必须先确认。

## Specification & Invariants

1. **模式**：`immediate`（立即）在已有 Agent Loop 中作为 follow-up 提交；`suspended`（挂起）只保存在前端内存，用户确认前不进入 Runtime、Loop 或 history。输入区域提供最小的模式选择，具体呈现沿用原型视觉，不恢复 `+` 或 mention 选择按钮。
2. **无活动 Loop**：用户提交 immediate 或确认 suspended 时，若没有活动 Loop，沿用已有新回合提交能力；是否加入当前 Loop 由 Runtime 判断，不能依靠过期的前端 busy 状态发起竞争回合。
3. **接收与处理**：Runtime 成功接收提交后移除对应临时 item；该确认表示接收成功，不表示 LLM 已处理完。明确接口回执语义，避免把 `turn.end` 当作队列移除信号。
4. **失败与重复**：提交失败保留原 `PromptDocumentV1` 和错误，允许重试；发送中禁止重复确认。离线或模型不可用时不丢输入，错误留在输入/Inbox 区域。本票不承诺网络响应丢失后的跨重启 exactly-once 投递，不新增通用投递系统。
5. **Runtime 边界**：只增加必要的类型化提交能力；follow-up 使用实际 Pi Agent 的队列机制，不并行启动第二个 Loop。接收的输入按既有 history 契约记录；挂起未确认输入不写 history。普通 Prompt 不创建 Task。
6. **列表与互斥**：点击 Inbox 按钮打开/关闭 Inbox；打开时关闭 Task。切回 Task 从堆叠态开始。列表滚动复用 PetPanel，不额外增加滚动区域；数量由本地待处理 item 提供。
7. **职责归属**：Inbox 的临时 item 与发送生命周期由 inbox 区域负责；只有在输入入口、badge 与列表确有共享时建立宠物窗口范围的共享状态。私有列表项留在 `inbox/index.tsx`；PetWindow 不实现队列发送、删除和重试。
8. **引用**：item 保存完整结构化 Prompt，不把 mention 降成纯文本。临时 Prompt 的 item ID 不能冒充持久化 Inbox 消息 ID；`#` 继续使用真实且受支持的消息来源，没有来源时按编辑器既有空候选行为处理。

## Affected Components & Files

- `packages/app/src/features/pet/PetPanel/inbox/index.tsx` 及确实共享的本地状态实现。
- `packages/app/src/features/pet/PetToolbar/index.tsx`：输入模式与数量 badge。
- `packages/app/src/features/pet/PetPanel/useActivePanel.ts`：Inbox/Task 互斥。
- 原 `packages/app/src/features/pet/components/PendingQueue.tsx`：引用迁移后移除。
- `packages/runtime/src/agent/engine.ts`：必要的 follow-up 用例。
- `packages/runtime/src/transport/router.ts`：类型化提交入口，路由不承载 Loop 业务规则。
- app Inbox 状态测试、Runtime 回合/follow-up 契约测试。

## Acceptance Criteria

- [ ] 活动 Loop 中 immediate 进入 follow-up，复用同一 Loop，不启动竞争回合或生成虚假 Task。
- [ ] suspended 提交后只出现于本地 Inbox，确认前 Runtime 与 history 均无该输入。
- [ ] 确认 suspended 后根据 Runtime 当前状态加入 Loop 或启动新回合。
- [ ] Runtime 接收成功才移除临时 item；失败保留结构化内容，可重试，重复点击不重复发送。
- [ ] 输入被本地 Inbox 接收后恢复快捷按钮；直接拒绝提交时保留编辑器草稿。
- [ ] Inbox 与 Task 严格互斥；从展开 Task 切至 Inbox 再切回 Task，回到堆叠态。
- [ ] Inbox 列表与数量同步，空列表与错误反馈沿用原型风格。

## Verification Plan

- 使用可控制完成时机的发送替身，验证确认、回执、失败、重试和重复点击的真实状态边界。
- Runtime 集成测试覆盖活动 Loop follow-up、无活动 Loop 提交、history 写入与模型错误，不仅 mock 路由返回值。
- 手动走通输入 → Inbox → 确认 → LLM 输出，以及 Inbox/Task 来回切换。
- 执行 app/runtime 类型检查与相应测试。

## Out of Scope

SQLite Inbox 表与迁移、外部告警投递、网关拉取/确认、持久化消息搜索、未读提醒、跨重启队列恢复。它们沿用 M3 的独立规划，本票不提前建立相应接口或空实现。
