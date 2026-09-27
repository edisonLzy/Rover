# 输入栏与 Runtime 间使用结构化 PromptDocumentV1 JSON

> 状态：已采纳 · 2026-09-27

输入栏（React Tiptap）向 Node Runtime 提交的 Prompt 采用受限的结构化 JSON（`PromptDocumentV1`），顺序承载纯文本片段与显式引用（`kind: agent | skill`），而不使用纯文本 XML 标签或富文本 HTML。

做出该决定的原因在于：
1. **彻底杜绝代码转义二义性与注入风险**：Rover 用户频繁输入或粘贴包含 HTML、XML、SVG 或伪标签的代码片段，纯文本 XML 传输必须依赖转义，极易产生误解析或 Prompt 注入；结构化对象在数据类型上将正文文本与指令引用物理隔离。
2. **契合编辑器 AST 且具运行时强校验**：Tiptap 底层为 ProseMirror AST 树，映射至精简 JSON 是天然零成本操作，并可通过 Zod Schema 在 API 边界做严格的运行时类型断言。
3. **隔离 API 契约与模型 Prompt 偏好**：大模型对 XML 标签的理解偏好属于 Runtime 内部组装 Prompt 时的单向转换逻辑，不应作为外部应用级 IPC/HTTP 的通信协议。
