# 013: Toolbar 内 Task 的堆叠、展开与收起交互

**Status**: TODO  
**Blocked By**: 012  
**Blocks**: 014  

## Context & Goal

在新的宠物工具栏下实现 Task 三态交互，并将任务展示及接管行为收敛到 PetToolbar 的 Task 功能。沿用现有 Task 查询、状态投影与 Terminal 接管，不修改 Task 领域语义。

## Specification & Invariants

1. **状态**：PetToolbar 管理 `activeFeature: 'none' | 'inbox' | 'task'`；Task 内另有堆叠/列表展开状态。Task 自己管理堆叠/展开；通过 active 与开关回调和 Toolbar 协作，取消 PetPanel/useActivePanel。
2. **转换**：

   | 当前状态 | 操作 | 结果 |
   | --- | --- | --- |
   | 面板关闭 | 点击 Task 按钮 | Task 堆叠 |
   | Task 堆叠 | 点击堆叠卡片 | Task 列表展开 |
   | Task 列表展开 | 点击 Task 按钮 | Task 堆叠 |
   | Task 堆叠 | 点击 Task 按钮 | 面板完全关闭 |
   | Inbox 打开 | 点击 Task 按钮 | 关闭 Inbox，显示 Task 堆叠 |

3. **工具栏反馈**：关闭时显示铃铛与任务数量 badge；打开时切换为展开状态图标。数量来自已有 Task 数据源，不把 Prompt 或普通 LLM 回答计作 Task。
4. **任务列表**：继续展示已有目标、Agent、状态与摘要，保留任务更新和终端接管。卡片专用逻辑归 tasks 区域；任务查询通过类型约束的数据 Hook/Runtime client，复用 Query 缓存，WS 事件更新或失效查询。
5. **滚动边界**：只有 Task/Inbox 的列表区域滚动，列表应用相同的窗口高度限制与滚动样式。Pet、PetBubble、PetToolbar 的快捷按钮与输入框位置固定；列表内部不再嵌套滚动容器。沿用现有窗口边界与尺寸偏好。
6. **组织**：Task 属于 PetToolbar。`Task/index.tsx` 组合 trigger、数据与内部状态；`Task/list.tsx` 承载列表、卡片及终端接管的视图。专用卡片留在列表文件下方。Toolbar 管理互斥与布局，不承载任务查询和终端业务。

```text
PetToolbar/
  Task/
    index.tsx       # trigger、堆叠/展开状态与数据
    list.tsx        # 列表与专用卡片
  Inbox/            # 由 014 完成
  PromptInput/
  index.tsx         # 输入模式、功能互斥与布局
```

## Affected Components & Files

- `packages/app/src/features/pet/PetToolbar/Task/index.tsx`
- `packages/app/src/features/pet/PetToolbar/Task/list.tsx`
- `packages/app/src/features/pet/PetToolbar/index.tsx`
- 现有任务卡片：必要时迁入 list.tsx，引用迁移后删除无用实现。
- `packages/app/src/__tests__/PetWindow.test.tsx` 及 Task 交互测试。

## Acceptance Criteria

- [ ] 完整走通「关闭 → 堆叠 → 展开 → 堆叠 → 关闭」，图标与 badge 同步。
- [ ] Task 堆叠或展开时，失焦不会隐藏工具栏或丢失面板。
- [ ] 大量任务仅在 Task 列表内滚动；宠物、气泡和工具栏不随列表滚动。
- [ ] 零任务、查询失败和实时任务更新均有正确呈现，不保留过期的本地任务副本。
- [ ] 已有 Terminal 接管仍有效，错误呈现在任务交互附近，不覆盖 LLM 气泡。
- [ ] 不额外抽出单调用点工具函数；数据与接管行为不经 PetWindow 无意义转发。

## Verification Plan

- 验证状态转换与重复点击，014 接入后补验 Inbox/Task 互斥。
- 手动覆盖空列表、多任务滚动、实时更新、原生终端接管及尺寸调整。
- 执行 app 类型检查与对应交互测试；Runtime 现有 Task 契约维持不变。

## Out of Scope

Task 生命周期、Session 承载方案、新的任务筛选/排序功能、Runtime Task 服务重构。
