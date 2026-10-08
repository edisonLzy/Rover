# 018: Inbox 抽屉卡片与一键交办流转闭环

**Status**: TODO  
**Blocked By**: 013, 016, 017  
**Blocks**: None  

## Context & Goal

依据 [ADR-0018](../../adr/0018-multi-source-input-steer-and-follow-up-interaction.md)，激活目前处于禁用状态的 `PetToolbar/Inbox` 图标，实现与 Task 互斥的收件箱抽屉卡片列表；提供「交由 Rover 处理 ↗」一键交办流转能力（空闲时直接发起回合，忙碌时自动转为 Follow-Up 入列），并补齐输入框 `#` 引用的自动联想候选菜单。

## Specification & Invariants

1. **Toolbar 入口激活与互斥**：
   - 移除 `PetToolbar/Inbox/index.tsx` 中的 `disabled` 属性；
   - 点击 Inbox 按钮切换抽屉展开/收起；与 Task 抽屉严格互斥（展开 Inbox 时自动收起 Task，反之亦然）。
2. **卡片列表展示（Inbox Drawer）**：
   - 在 `PetToolbar/Inbox/list.tsx` 中呈现当前未读/待办消息列表；
   - 沿用 Task 列表的高度限制与滚动样式，内部禁止嵌套滚动容器；
   - 展示告警/事件标题、到达时间、摘要及类型微标。
3. **一键交办流转（Handoff Action）**：
   - 卡片右下角提供 `[交由 Rover 处理 ↗]` 操作按钮；
   - **空闲态（`!isBusy`）点击**：
     - Inbox 抽屉顺滑收起；
     - 自动组装带有 `#issue-xxx` 的 `PromptDocumentV1` 并直接调用 `trpc.turns.start`，启动 Rover 活跃回合；
   - **忙碌态（`isBusy`）点击**：
     - Inbox 抽屉顺滑收起；
     - 自动组装 `PromptDocumentV1` 并作为 **Follow-Up** 注入，挂入 `PetBubble` 底部微型徽章架（由 016 承接），抽屉关闭，0 多余确认。
4. **输入框 `#` Mention 引用联想**：
   - 完善 `usePromptEditor.ts` 中的 `availableInboxes` 数据源订阅；
   - 当用户在输入框键入 `#` 时，弹出未读/可用 Inbox 消息候选浮层；
   - 键盘上下键或回车选中后，生成 `ReferencePart { kind: 'inbox', id, label }` 胶囊，并保留后续光标供用户继续撰写自定义 Prompt。

## Affected Components & Files

- `packages/app/src/features/pet/PetToolbar/Inbox/index.tsx`：激活按钮与未读徽标。
- `packages/app/src/features/pet/PetToolbar/Inbox/list.tsx`：抽屉列表视图与卡片组件。
- `packages/app/src/features/pet/PetToolbar/index.tsx`：管理 `activeFeature === 'inbox'` 互斥与交办路由。
- `packages/app/src/features/pet/PetToolbar/PromptInput/usePromptEditor.ts`：注入 `#` 候选列表。
- `packages/app/src/__tests__/PetWindow.test.tsx` 及 Inbox 相关测试。

## Acceptance Criteria

- [ ] 点击 Inbox 图标能展开收件箱抽屉，再次点击或点击 Task 图标能正确切换互斥。
- [ ] 空闲时点击「交由 Rover 处理 ↗」立即关闭抽屉并开启新回合。
- [ ] 忙碌时点击「交由 Rover 处理 ↗」立即关闭抽屉并将任务作为微徽章挂入气泡底部。
- [ ] 在输入框输入 `#` 能弹出待办消息候选菜单，回车选中能生成 `#` 胶囊。
- [ ] 选中的 `#` 胶囊随 Prompt 提交后，能正确传递至底层 Runtime。

## Verification Plan

- 验证空闲态一键交办和忙碌态一键交办的分别流转路径。
- 验证 `#` 输入补全菜单的上下键与回车交互。
- 验证 Inbox 与 Task 展开的完全互斥。
- 执行 `pnpm --filter @rover/app test`。

## Out of Scope

外部 Webhook 网关接入（属于 M3）、外部监控系统集成。
