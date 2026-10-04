# 012: 宠物待命、工具栏与输入交互重构

**Status**: IN_PROGRESS  
**Blocked By**: 002, 010  
**Blocks**: 013, 014, 015  

## Context & Goal

将 PetWindow 的宠物与输入交互调整为已确认的 Rover 行为，同时按职责拆分当前大型入口组件。复用现有宠物素材、Tiptap 编辑器、窗口能力与尺寸偏好，不重写这些基础能力。

本次 012–015 是 010 完成后的交互修订，取代其中旧的整体展开与 Prompt 队列交互。代码组织遵循 [TRD §2.1–2.2](../../architecture/Rover%20MVP%20TRD.md)，视觉延续 [prototype](../../prototype/)；样式使用 Tailwind CSS。

## Specification & Invariants

1. **Pet**：待命展示宠物，宠物本身是窗口拖拽 source；右键 context-menu 仅包含 Dashboard 按钮。拖拽、菜单开关与打开 Dashboard 的逻辑由 Pet 持有。
2. **PetToolbar**：hover Pet 显示「编辑 / Inbox / Task」快捷按钮，不包含语音输入。hover 区域允许用户从宠物移动到工具栏，不在移动过程中立即消失。
3. **输入模式**：点击编辑按钮，工具栏切换为输入框并自动聚焦；提交成功接收后恢复快捷按钮。拒绝提交或提交失败时保留草稿并展示可修复错误。
4. **隐藏条件**：当焦点与 hover 均离开交互区域、输入为空、`activeFeature === 'none'` 时完全隐藏工具栏。有草稿、堆叠任务或展开面板时不误收起。输入是否为空应考虑结构化引用，不能只检查纯文本。
5. **Mention**：输入框无前置 `+` 按钮或 Agent/Skill 选择入口。Agent、Skill、Inbox 引用分别沿用 `@`、`/`、`#` Suggestion；保留结构化 `PromptDocumentV1`、中文输入法、候选选择与换行行为。不为尚无数据源的 `#` 构造假消息。
6. **共享边界**：PetWindow 仅承担组合、布局与真正跨组件的状态；工具栏的输入模式、焦点、草稿与错误留在 PetToolbar/编辑器内。Task、Inbox 与 PromptInput 均属于 PetToolbar；`activeFeature: 'none' | 'task' | 'inbox'` 的互斥状态由 PetToolbar 持有，Task/Inbox 持有自己的内部状态。取消 PetPanel 与 useActivePanel，不将工具栏内部状态提升到 PetWindow。
7. **尺寸与宿主**：保留现有 compact 默认尺寸与 Dashboard 尺寸设置；拆分后仍作用于整个宠物 UI。原生窗口尺寸计算仅按新布局作必要适配，避免裁切或多余空白，不扩展偏好设置功能。

## Affected Components & Files

- `packages/app/src/features/pet/index.tsx`：PetWindow 组合与必要窗口布局适配。
- `packages/app/src/features/pet/Pet/index.tsx`：宠物拖拽与 Dashboard 菜单。
- `packages/app/src/features/pet/PetToolbar/index.tsx`：快捷按钮与输入模式。
- `packages/app/src/features/pet/PetToolbar/Task/index.tsx`、`list.tsx`：接入已有任务列表与会话入口；堆叠交互由 013 实现。
- `packages/app/src/features/pet/PetToolbar/Inbox/index.tsx`：本票保留未启用入口；列表与发送生命周期由 014 实现。
- `packages/app/src/features/pet/PetToolbar/PromptInput/index.tsx`、`usePromptEditor.ts`、`types.ts`：仅必要的输入接口调整。
- `packages/app/src/__tests__/PetWindow.test.tsx`、`editor.test.ts`：对应交互回归。

独立功能使用功能目录与 `index.tsx`。编辑器的 Hook、类型、序列化、建议扩展和专用视图均属于 `PetToolbar/PromptInput/`。Task 与 Inbox 的入口放在各自 `index.tsx`，列表放在 `list.tsx`；切换输入模式时保持功能组件挂载。专用子组件与 Hook 留在所属组件文件内；不为拆分而新增全局 store、通用 helpers 或未被使用的目录。旧组件仅在引用完成迁移后删除。

012 保留已有待处理 Prompt 的暂存、确认和失败保留能力；014 再替换为本地 Inbox 与 follow-up。提交只有在 Runtime 接收成功或现有本地队列接收后才清空，等待回执期间禁止重复提交。

## Acceptance Criteria

- [ ] 待命只展示宠物；可拖动窗口，拖动不误触发其他操作。
- [ ] 右键仅显示 Dashboard，点击能打开已有 Dashboard；菜单可正常关闭。
- [x] hover 出现三枚快捷按钮，编辑后输入自动聚焦，提交被接收后恢复快捷按钮。
- [x] 空输入且面板关闭时失焦完全收起；非空草稿失焦后仍保留。
- [x] 输入无 `+`、语音与额外 Agent/Skill 选择按钮；mention、IME、Enter/Shift+Enter 行为保持正确。
- [x] 原有正常提交与 LLM 输出流程可用，尚未迁移的能力不因拆分丢失。
- [ ] compact 默认与 Dashboard 尺寸设置保持生效；修改尺寸不会裁切宠物、工具栏或候选菜单。

## Verification Plan

- 对草稿保留、提交失败与编辑器卸载边界进行有实际行为意义的回归验证。
- 手动验收 hover → 输入 → 提交 → 失焦、右键与原生拖拽，覆盖已有尺寸范围。
- 执行 `pnpm --filter @rover/app typecheck`、`pnpm --filter @rover/app test`。

## Implementation & Verification (2026-10-04)

- 功能目录迁移完成：Pet、PetToolbar/PromptInput、Task、Inbox；删除 PetPanel 与旧整体展开入口。
- 工具栏拥有输入、焦点、草稿、提交错误和 activeFeature；Task 查询使用已有 Query 缓存，task.changed 使查询失效，保留列表及会话入口。Inbox 入口保持禁用，014 再启用。
- 提交等待实际回执，编辑器发送中锁定并防止重复发送；失败保留草稿，晚到回执不清除新文档。现有本地队列确认失败时保留 item，成功接收后移除。
- App 的 51 项测试通过，包含真实 React/Tiptap 交互、Native API 调用、失败与卸载边界、HTTP/WS 事件交错；App 类型检查、变更 lint/格式检查和生产构建通过，Tauri debug app bundle 构建成功。
- 浏览器使用临时本地 Mock Runtime 验证候选选择、提交与回复、Task/输入共存、60%/75%/100%/120% 尺寸；默认已恢复 75%，控制台无新增错误。
- **待验收**：桌面自动化读取原生 Rover 窗口连续超时，因此原生拖拽、Dashboard 打开及屏幕边缘/候选框裁切仍需桌面验证。Status 保持 IN_PROGRESS，不将原生验收计为通过。

## Out of Scope

Task 数据与状态生命周期重写、外部 Inbox 接入、新的尺寸偏好存储、动画/素材重制、Dashboard 其他功能。
