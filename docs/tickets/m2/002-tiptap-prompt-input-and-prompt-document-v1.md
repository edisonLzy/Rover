# 002: Tiptap 3 输入栏与 PromptDocumentV1 契约

**Status**: TODO  
**Blocked By**: None (*Frontier*)  
**Blocks**: 005, 010  

## Context & Goal
Rover 宠物区域需要一个既轻量又具备结构化引用能力的原生输入栏。根据 [ADR-0006](file:///Users/zhiyu/Desktop/coding/Rover/docs/adr/0006-prompt-document-json.md) 与 TRD 2.2，输入栏基于 Tiptap 3 构建，支持 `@Agent`、`/skill` 候选以及 `#` 引用扩展接口，杜绝富文本 HTML 与 XML 注入；在提交时将 ProseMirror AST 序列化为确定性的 `PromptDocumentV1` JSON，并通过 Zod 在前后端边界进行双向强校验。

## Specification & Invariants
1. **编辑器选型与依赖**：
   - `@tiptap/react`, `@tiptap/pm`, `@tiptap/starter-kit`, `@tiptap/extension-placeholder`, `@tiptap/extension-mention`, `@tiptap/suggestion`。
   - 保留段落 (`paragraph`)、文本 (`text`) 与换行 (`hardBreak`)；彻底禁用标题、粗体、斜体、列表等富文本节点。
2. **触发符与 Suggestion 扩展**：
   - `@`: 候选可派发的 Code Agent（`kind: "agent"`，如 `claude-code`, `codex`）；
   - `/`: 候选已启用的业务与内置 Skill（`kind: "skill"`，如 `agent-dispatch`, `task-recall`）；
   - `#`: 预留扩展接口（`kind: "inbox"`），M2 提供语法节点与空候选/Mock 桩，为 M3 对接真实 Inbox 消息打通通路；
   - 各触发符具有独立的 `PluginKey` 与建议菜单容器，状态完全隔离。
3. **数据契约 (`PromptDocumentV1`)**：
   - 数据结构：
     ```json
     {
       "v": 1,
       "parts": [
         { "type": "reference", "kind": "agent", "id": "claude-code", "label": "@Claude Code" },
         { "type": "text", "text": " 帮我重构一下认证逻辑" }
       ]
     }
     ```
   - 在 `@rover/runtime` 中提供公共导出 `PromptDocumentV1Schema` (Zod)。
   - 禁止传输原始 HTML 或 Tiptap 内部复杂 JSON。
4. **键盘与输入法交互准则**：
   - 菜单激活时：`Enter` 选中候选条目，禁止触发提交；`Esc` 关闭菜单；方向键导航。
   - 菜单关闭时：`Enter` 提交；`Shift+Enter` 换行。
   - **严格阻断中文/日语等 IME 组合态**：`isComposing` 为 true 时，按 `Enter` 仅确认拼音上屏，禁止触发提交。

## Affected Components & Files
- `packages/app/package.json`
- `packages/app/src/features/pet/editor/PromptInput.tsx`
- `packages/app/src/features/pet/editor/extensions/agentMention.ts`
- `packages/app/src/features/pet/editor/extensions/skillMention.ts`
- `packages/app/src/features/pet/editor/extensions/inboxMention.ts`
- `packages/app/src/features/pet/editor/serializer.ts`
- `packages/runtime/src/types/prompt.ts` (Zod Schema)
- `packages/app/src/__tests__/editor.test.tsx`
- `packages/runtime/src/__tests__/prompt.test.ts`

## Acceptance Criteria
- [ ] 渲染 Tiptap 输入栏，输入 `@`、`/` 能正确弹出下拉浮层并展示对应候选。
- [ ] 选中候选后以不可分割的 Badge/Pill 节点插入编辑器，删除键一次性删除整个引用。
- [ ] 序列化工具输出纯净的 `PromptDocumentV1` 结构，能通过 Runtime 的 Zod 校验。
- [ ] 模拟拼音输入法敲回车事件，不触发提交回调；普通输入状态按回车触发提交。

## Verification Plan
```bash
pnpm --filter @rover/runtime test packages/runtime/src/__tests__/prompt.test.ts
pnpm --filter @rover/app test packages/app/src/__tests__/editor.test.tsx
```
