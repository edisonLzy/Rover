# 016: PetBubble Follow-Up 徽章架与生命周期守卫

**Status**: TODO  
**Blocked By**: 012, 014, 015  
**Blocks**: 018  

## Context & Goal

依据 [ADR-0018](../../adr/0018-multi-source-input-steer-and-follow-up-interaction.md)，彻底废除底部工具栏（Toolbar）展开多行纵向抽屉列表的旧 `PendingQueue` 实现。在 `PetBubble` 底部边缘构建单行横向微型徽章架（Badge Shelf），支持拖拽重排与随手删除，并通过 WebSocket 消费事件精准出队；同时为气泡增加 Follow-Up 队列非空的生命周期守卫，防止待办被 10 秒倒计时误关闭。

## Specification & Invariants

1. **废弃与清理**：
   - 彻底删除 `packages/app/src/features/pet/PetToolbar/PendingQueue.tsx` 及其在 `PetToolbar/index.tsx` 中的引用；
   - 消除 Toolbar 下方的待办列表容器，保持 Toolbar 垂直高度绝对干净。
2. **微型徽章架（Badge Shelf）规格**：
   - 附着于 `PetBubble` 底部边缘，作为气泡的复合子组件展示；
   - **单行横向排布**：单条徽章（Pill）高度为 **22px**，背景采用轻浅半透明样式，内含抓手图标 `⠿`、简短文本摘要、以及轻量删除按钮 `×`；
   - **数量上限与折叠**：单行最多同时展示 2~3 个徽章，超出部分在末尾显示 `+N` 折叠指示器，点击或 Hover 展开微型下拉；
   - **拖拽排序**：采用 `@dnd-kit` 实现横向拖拽，拖拽结束就地更新本地顺序并触发与 Runtime 的队列同步。
3. **队列状态镜像与同步**：
   - 前端维护 `pendingFollowUps` 列表状态；
   - 拖拽重排或点击 `×` 删除时：前端更新列表，调用 `trpc.turns.clearAllQueues`，随后将剩余列表批量重新发送 `trpc.turns.followUp`；
   - **消费出队（Eviction）**：订阅 WebSocket 事件，当收到当前回合消费该用户消息的 `message_start`（通过 timestamp 匹配）时，精准从徽章架移除该 Pill。
4. **生命周期守卫（Guard Condition）修正**：
   - 检查并修正 `PetBubble` 现存的 10 秒无交互自动淡出计时器（`PetBubbleView#L115-L124`）；
   - 增加前置守卫：只有当 `!isThinking && pendingFollowUps.length === 0 && !isHovered` 时，才允许启动 10 秒自动关闭计时器；
   - 只要队列中有未处理徽章，气泡严禁自动淡出。
5. **自动接力（Auto-advance Handoff）**：
   - 当当前回合 LLM 输出完成（`turn.end`），首项待办徽章微高亮亮起，倒计时 1.5 秒自动出队并启动该任务的执行（用户也可直接点击跳过倒计时立即开始）。

## Affected Components & Files

- `packages/app/src/features/pet/PetBubble/index.tsx`：集成 Badge Shelf 并修正 10 秒自动淡出守卫。
- `packages/app/src/features/pet/PetBubble/BadgeShelf.tsx`：全新实现横向微型徽章架（含拖拽与折叠）。
- `packages/app/src/features/pet/PetToolbar/PendingQueue.tsx`：移除旧代码。
- `packages/app/src/features/pet/PetToolbar/index.tsx`：解绑旧队列并接入新事件总线。
- `packages/app/src/__tests__/PetWindow.test.tsx` 及气泡单元测试。

## Acceptance Criteria

- [ ] Toolbar 下方不再渲染任何纵向待办列表容器。
- [ ] 忙碌态下添加 Follow-Up 后，`PetBubble` 底部单行横向浮现微型胶囊徽章。
- [ ] 徽章支持横向拖拽调换顺序，并正确同步至 Runtime。
- [ ] 点击徽章上的 `×` 能立即删除该项并同步至 Runtime。
- [ ] 当底层 Agent 开始执行某一 Follow-Up 时，该徽章从气泡底部精准消失。
- [ ] 队列中存在待办时，`PetBubble` 超过 10 秒不会自动关闭；队列清空后恢复既有的 10 秒自动淡出。
- [ ] 当前回合结束后，首项徽章能平滑自动接力开启下一轮回合。

## Verification Plan

- 模拟忙碌态添加 1 条、2 条及 4 条 Follow-Up，验证单行排列及 `+N` 溢出折叠。
- 验证拖拽排序与点叉删除的 RPC 调用时序。
- 模拟等待 15 秒，验证有待办时不触发关闭、无待办时 10 秒后正常淡出。
- 跑通 Vitest 前端相关测试。

## Out of Scope

PromptInput 快捷键（017 负责）、Inbox 抽屉（018 负责）。
