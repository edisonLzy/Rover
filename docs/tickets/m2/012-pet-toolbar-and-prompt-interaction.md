# 012: 宠物待命、工具栏与输入交互重构

**Status**: TODO  
**Blocked By**: 002, 010  
**Blocks**: 013, 014, 015  

## Context & Goal

将 PetWindow 的宠物与输入交互调整为已确认的 Rover 行为，同时按职责拆分当前大型入口组件。复用现有宠物素材、Tiptap 编辑器、窗口能力与尺寸偏好，不重写这些基础能力。

本次 012–015 是 010 完成后的交互修订，取代其中旧的整体展开与 Prompt 队列交互。代码组织遵循 [TRD §2.1–2.2](../../architecture/Rover%20MVP%20TRD.md)，视觉延续 [prototype](../../prototype/)；样式使用 Tailwind CSS。

## Specification & Invariants

1. **Pet**：待命展示宠物，宠物本身是窗口拖拽 source；右键 context-menu 仅包含 Dashboard 按钮。拖拽、菜单开关与打开 Dashboard 的逻辑由 Pet 持有。
2. **PetToolbar**：hover Pet 显示「编辑 / Inbox / Task」快捷按钮，不包含语音输入。hover 区域允许用户从宠物移动到工具栏，不在移动过程中立即消失。
3. **输入模式**：点击编辑按钮，工具栏切换为输入框并自动聚焦；提交成功接收后恢复快捷按钮。拒绝提交或提交失败时保留草稿并展示可修复错误。
4. **隐藏条件**：当焦点与 hover 均离开交互区域、输入为空、`activePanel === 'none'` 时完全隐藏工具栏。有草稿、堆叠任务或展开面板时不误收起。输入是否为空应考虑结构化引用，不能只检查纯文本。
5. **Mention**：输入框无前置 `+` 按钮或 Agent/Skill 选择入口。Agent、Skill、Inbox 引用分别沿用 `@`、`/`、`#` Suggestion；保留结构化 `PromptDocumentV1`、中文输入法、候选选择与换行行为。不为尚无数据源的 `#` 构造假消息。
6. **共享边界**：PetWindow 仅承担组合、布局与真正跨组件的状态；工具栏的输入模式、焦点、草稿与错误留在 PetToolbar/编辑器内。`useActivePanel()` 在 PetWindow 调用一次，由 PetToolbar 与 PetPanel 使用同一结果，禁止分别实例化。
7. **尺寸与宿主**：保留现有 compact 默认尺寸与 Dashboard 尺寸设置；拆分后仍作用于整个宠物 UI。原生窗口尺寸计算仅按新布局作必要适配，避免裁切或多余空白，不扩展偏好设置功能。

## Affected Components & Files

- `packages/app/src/features/pet/index.tsx`：PetWindow 组合与必要窗口布局适配。
- `packages/app/src/features/pet/Pet.tsx`：宠物拖拽与 Dashboard 菜单。
- `packages/app/src/features/pet/PetToolbar/index.tsx`：快捷按钮与输入模式。
- `packages/app/src/features/pet/PetPanel/useActivePanel.ts`：实际共享的面板状态，具体转换由 013/014 补齐。
- `packages/app/src/features/pet/editor/PromptInput.tsx`、`usePromptEditor.ts`、`types.ts`：仅必要的输入接口调整。
- `packages/app/src/__tests__/PetWindow.test.tsx`、`editor.test.ts`：对应交互回归。

独立功能使用功能目录与 `index.tsx`，PetToolbar 的实现放在 `PetToolbar/index.tsx`。专用子组件与 Hook 留在所属组件文件内；不为拆分而新增全局 store、通用 helpers 或未被使用的目录。旧组件仅在引用完成迁移后删除。

## Acceptance Criteria

- [ ] 待命只展示宠物；可拖动窗口，拖动不误触发其他操作。
- [ ] 右键仅显示 Dashboard，点击能打开已有 Dashboard；菜单可正常关闭。
- [ ] hover 出现三枚快捷按钮，编辑后输入自动聚焦，提交被接收后恢复快捷按钮。
- [ ] 空输入且面板关闭时失焦完全收起；非空草稿失焦后仍保留。
- [ ] 输入无 `+`、语音与额外 Agent/Skill 选择按钮；mention、IME、Enter/Shift+Enter 行为保持正确。
- [ ] 原有正常提交与 LLM 输出流程可用，尚未迁移的能力不因拆分丢失。
- [ ] compact 默认与 Dashboard 尺寸设置保持生效；修改尺寸不会裁切宠物、工具栏或候选菜单。

## Verification Plan

- 对草稿保留、提交失败与编辑器卸载边界进行有实际行为意义的回归验证。
- 手动验收 hover → 输入 → 提交 → 失焦、右键与原生拖拽，覆盖已有尺寸范围。
- 执行 `pnpm --filter @rover/app typecheck`、`pnpm --filter @rover/app test`。

## Out of Scope

Task 数据与状态生命周期重写、外部 Inbox 接入、新的尺寸偏好存储、动画/素材重制、Dashboard 其他功能。
