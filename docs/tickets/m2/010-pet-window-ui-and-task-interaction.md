# 010: 宠物窗口完整交互 UI 与终端接管

**Status**: DONE  
**Blocked By**: 002, 005, 006, 007  
**Blocks**: None  

## Context & Goal
宠物区域是桌面常驻的核心交互载体。本任务在 React (`packages/app`) 中实现完整的宠物窗口交互：从悬浮待命态到展开交互态的切换、宠物气泡、结合 Tiptap 3 的输入栏、待处理 Prompt 队列，以及任务卡片列表。点击任务卡片通过 Tauri 命令调起 Terminal.app 接入正在运行或恢复已结束的 Screen 会话。

## Specification & Invariants
1. **状态机与布局架构**：
   - **悬浮待命态**：展示宠物形象（可拖拽）与下方的快捷操作胶囊（输入、状态指示）；
   - **交互展开态**：展开面板，包含当前回合气泡、Tiptap 输入栏、待处理 Prompt 队列与任务卡片列表；
   - 点击外部区域或快捷键可收起回待命态。
2. **宠物气泡 (Pet Bubble)**：
   - 订阅 `turn.delta` 与 `turn.end` 事件，实时打字机呈现 Rover 回复或澄清提问；
   - 它展示当前回合的即时信息，不承载冗长的历史列表。
3. **待处理 Prompt 队列**：
   - 当前回合进行中，用户继续输入提交的 Prompt 进入本地队列暂存；
   - 回合结束时气泡或队列区提示：“是否继续下一项待办？”，用户点击确认后发起新回合。
4. **任务卡片与终端接管**：
   - 实时渲染来自 `task.changed` 的任务卡片，展示 Agent、目标、状态 Badge（如 `需要用户介入`、`执行中`）；
   - **点击接管交互**：用户点击卡片，React 调用 Tauri 命令 `open_task(taskId)`；
   - Rust 宿主向 Node 内部查询真实的 `native_session_id` 与承载信息，调用 M1-4 的终端自动化脚本，激活 Terminal.app 并在当前或新标签执行接管。

## Affected Components & Files
- `packages/app/src/features/pet/PetWindow.tsx`
- `packages/app/src/features/pet/components/PetAvatar.tsx`
- `packages/app/src/features/pet/PetBubble/index.tsx`
- `packages/app/src/features/pet/components/TaskCard.tsx`
- `packages/app/src/features/pet/components/PendingQueue.tsx`
- `src-tauri/src/terminal.rs` (Tauri invoke `open_task`)
- `packages/app/src/__tests__/PetWindow.test.tsx`

## Acceptance Criteria
- [x] 宠物悬浮与展开切换顺畅，透明窗口无穿透问题。
- [x] 提交 Prompt 后，气泡能流式打字渲染；若回合未完输入新内容，自动进入暂存队列。
- [x] 任务状态变更时（如 `needs_intervention`），卡片实时呈现警示样式。
- [x] 点击任务卡片能成功唤起 Terminal.app 并执行 Screen attach。

## Verification Plan
```bash
pnpm --filter @rover/app test packages/app/src/__tests__/PetWindow.test.tsx
pnpm --filter @rover/app dev
```
