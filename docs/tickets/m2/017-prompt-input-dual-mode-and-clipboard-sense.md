# 017: PromptInput 双模态快捷键与剪贴板瞬态感知

**Status**: TODO  
**Blocked By**: 012, 014  
**Blocks**: None  

## Context & Goal

依据 [ADR-0018](../../adr/0018-multi-source-input-steer-and-follow-up-interaction.md)，在 `PromptInput` 编辑器中实现双模态提交快捷键，区分常规排队（`Enter`）与实时插话干预（`Cmd + Enter`），并严格保全 `Shift + Enter` 换行习惯；同时在输入框唤起/聚焦时增加剪贴板瞬态代码嗅探与 Ghost Pill 建议。

## Specification & Invariants

1. **按键捕获与分流（Capture Phase Keyboard Handling）**：
   - 在 `usePromptEditor.ts` 或编辑器容器上以 `capture: true` 监听键盘事件，拦截在 TipTap 默认行为之前；
   - **`Shift + Enter`**：放行默认行为，仅插入换行符，严禁触发提交；
   - **`Enter` (未按下 Shift / Cmd / Ctrl)**：
     - 若 Rover 空闲（`!isBusy`）：正常调用 `onSubmit(doc)` 开启新回合；
     - 若 Rover 忙碌（`isBusy`）：调用 `onFollowUp(doc)` 提交入列，并在输入框清空后将焦点维持或平滑收起；
   - **`Cmd + Enter` (Mac) / `Ctrl + Enter` (Win)**：
     - 调用 `onSteer(doc)` 派发实时插话干预；
     - 清空输入框，并在界面上给出即时反馈（如输入框短暂绿色/黄色微光）。
2. **IME 输入法安全不变式**：
   - 严格维持现有 `isComposing` 与 `keyCode === 229` 检查，输入法拼音选词时的 Enter 绝对不触发任何提交。
3. **剪贴板瞬态感知（Focus-Triggered Ghost Pill）**：
   - **非侵入触发**：仅当用户主动展开输入框（点击编辑图标或快捷键呼出）时，执行一次瞬态嗅探；
   - **启发式识别**：判断剪贴板纯文本是否具备代码/报错特征（如包含大括号、缩进、常见语言关键字、或以 `Error:` / `Traceback` 开头，且长度在 20~2000 字符内）；
   - **呈现与操作**：在输入框上方渲染极轻量的情境小标签：
     `📋 检测到剪贴板代码 [一键带入解释] [忽略]`
   - 用户点击 `[一键带入解释]`，自动将代码作为 Markdown 代码块填入编辑器光标处，并附带默认提问模板；点击 `[忽略]` 或用户键入任意内容后自动淡出消失。
   - **零隐私残留**：剪贴板数据仅驻留前端内存，不写入 SQLite，不发送至外部。

## Affected Components & Files

- `packages/app/src/features/pet/PetToolbar/PromptInput/usePromptEditor.ts`：扩展按键监听与 `onSteer`、`onFollowUp` 回调。
- `packages/app/src/features/pet/PetToolbar/PromptInput/index.tsx`：支持 Ghost Pill 渲染。
- `packages/app/src/features/pet/PetToolbar/PromptInput/ClipboardGhostPill.tsx`：剪贴板感知胶囊子组件。
- `packages/app/src/features/pet/PetToolbar/index.tsx`：将 `onSteer` 与 `onFollowUp` 接入运行时服务。
- `packages/app/src/__tests__/PetWindow.test.tsx` 及输入组件测试。

## Acceptance Criteria

- [ ] 忙碌态下按 `Enter` 触发 `followUp`，按 `Cmd+Enter` (或 `Ctrl+Enter`) 触发 `steer`。
- [ ] 无论忙碌还是空闲，按 `Shift+Enter` 均只换行，不发生任何提交。
- [ ] 中文输入法选词回车不触发提交。
- [ ] 唤起输入框时，若剪贴板有代码，上方浮现 Ghost Pill；点击后能一键装填为带格式的 Prompt。
- [ ] 输入框输入内容后或点击忽略，Ghost Pill 自动消失。

## Verification Plan

- 单元测试覆盖各类按键组合（Shift+Enter, Enter, Mod+Enter）与 `isBusy` 的分支流转。
- 模拟剪贴板文本写入与聚焦，验证 Ghost Pill 出现及填入行为。
- 执行 `pnpm --filter @rover/app test` 验证通过。

## Out of Scope

外部持久化 Inbox 消费（018 负责）、Badge Shelf 渲染（016 负责）。
