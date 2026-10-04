# 气泡富交互动作采用自定义协议 Markdown 链接

> 状态：已采纳 · 2026-10-01

Rover 宠物气泡（Pet Bubble）展示即时回复、澄清追问与任务状态打断。为了在紧凑的桌面气泡中提供丰富的交互入口（如 `[去确认 ↗]`、`[继续下一条待办]`、`[查看原任务 ↗]`），Rover 决定采用**标准 Markdown 链接语法结合自定义 URL 协议（`rover://` 与 `rover-action:`）**由模型或系统输出；前端（React-Markdown）通过 AST 拦截自定义链接并映射为交互式胶囊按钮（Button），杜绝非标私有标签或破坏流式打字体验的纯 JSON 动作载荷。

做出该决定的核心原因在于：

1. **天然契合打字机流式生成（Streaming Native）**：
   * 若采用纯结构化 JSON（如返回 `actions: [{ label, action }]`）或工具调用（Tool Call）传递按钮，前端必须等待模型将整个 JSON 结构完全输出且闭合校验后才能渲染；
   * 采用标准 Markdown 链接 `[去确认 ↗](rover://tasks/TASK-219/open)` 时，LLM 可以一边流式打字一边输出，前端 Markdown 流式渲染器在链接闭合瞬间即可就地将超链接升级为按钮动效，交互丝滑流畅。

2. **内联排版灵活与跨端优雅降级（Inline & Graceful Degradation）**：
   * 纯结构化按钮往往只能死板地统一定位在气泡底部，割裂了文本的语境关联；
   * Markdown 链接允许根据语义自然内嵌于句中或段落尾端（例如：“请问需要修改哪个模块？[切换为开发配置](rover-action:input/fill?text=dev) 或直接告诉我目标”）；
   * 落入 SQLite `rover_message`、导出到系统日志或在终端展示时，它依然保持符合 CommonMark 规范的纯文本超链接，杜绝了 `<custom-action>` 等私有 XML/HTML 标签带来的解析污染。

3. **契约正交：将 UI 表现层与动作路由解耦**：
   * 模型输出层只需关心标准文本排版与规范化的 URL Scheme（如 `rover://tasks/{id}/open`）；
   * 前端渲染层只负责将匹配白名单协议的链接包装为 `<button>`，具体的系统调用（如调用 Tauri `invoke('open_task')`）由前端动作分发器（Action Dispatcher）集中处理，职责高度正交。

---

### 一、协议规范与语法示例

自定义协议分为两类：

* **实体资源定位协议（`rover://`）**：指向 Rover 内部实体对象与操作。
* **交互行为触发协议（`rover-action:`）**：触发轻量 UI 交互或队列控制。

```markdown
<!-- 示例 1：会话接管与任务查看 (实体资源) -->
发布准备已完成，等待你在终端中确认。[去确认 ↗](rover://tasks/TASK-219/open)

<!-- 示例 2：待处理 Prompt 队列控制 (UI 交互行为) -->
当前任务已开始执行。[继续下一条待办](rover-action:queue/continue) 或 [暂不处理](rover-action:queue/defer)

<!-- 示例 3：澄清场景下的快速补全与选项 -->
你可以直接选择环境：[开发环境](rover-action:input/fill?text=使用开发环境) | [预发环境](rover-action:input/fill?text=使用预发环境)
```

---

### 二、架构边界与防御不变量（Security & Guardrails）

1. **严格的 Action 白名单防御（防 Prompt 注入）**：
   * 前端接收到 `rover://` 或 `rover-action:` 点击事件后，必须通过严格的路由白名单校验（如 `open_task`, `queue/continue`, `input/fill`）；
   * **绝对禁止**将 URI 直接映射到任意 Shell 命令执行或任意外部网络请求，防止恶意 Prompt 诱导模型生成高危指令链接。
2. **底层事件打断与保底策略演进（Dual-Track Fail-Safe & Evolution）**：
   * 对于 Code Agent 发生危险操作需要确认（`needs_intervention`）等核心生命周期事件，该信号来源于底层 Hook Spool，而非依靠 LLM 自由聊天的稳定性；
   * *演进（2026-10-04）*：在早期实现中曾在 PetBubble 底部强行保底渲染「去确认」按钮，但这导致了任务状态粗暴覆盖正在输出的 LLM 回答。随着 Ticket 012–015 的落地，该保底通道已完整迁移并收敛至 `PetToolbar/Task`（由 `TaskCard` 呼吸动效、优先级置顶以及卡片就地错误反馈承接）；气泡内的自定义链接语法（`rover://`）严格作为 LLM 主动引导或澄清场景下的内联动作入口，不再作为全局任务状态强行覆盖展示通道。

---

### 三、备选方案权衡（Considered Options）

* **采用纯结构化 JSON 动作数组（如 `actions: [{ label, type, payload }]`）**：
  * *否决原因*：严重破坏打字机流式输出的即时性，必须等待整个回合结束或 JSON 闭合；且无法支持内联文本混排。
* **发明非标微标签或指令语法（如 `:button[去确认]{action=open_task}` 或 `<rover-btn>`）**：
  * *否决原因*：发明私有语法增加解析复杂度，容易与代码片段/HTML 混淆；落库与非富文本降级时产生难看的私有语法乱码。

---

### 四、架构演进与职责修正（2026-10-04）

随着 M2 阶段宠物窗口交互切片重构（Ticket 012–015），对气泡与任务模块的职责边界作出了进一步清晰界定：

1. **PetBubble 职责纯化**：专职负责当前 Rover 回合的 LLM 生成流程（启动中、思考中、流式 Token、生成完毕、回合失败报错）。气泡内仍支持通过 `rover://` 渲染内联胶囊按钮，但仅用于 LLM 生成内容中的语义引导（如追问澄清选择、指引查看特定会话）。
2. **任务与终端反馈各归其位**：
   - `needs_intervention` 任务干预提醒收敛至 `PetToolbar/Task`：通过 Task 按钮数量徽标、`TaskList` 优先置顶（`priority: 0`）、`TaskCard` 蓝色呼吸动效及高亮「去确认」主按钮承载；
   - 终端唤起反馈（`openNotice`、`openError`）采用就地反馈（Inline Alert）模式直接在任务卡片上方呈现，与气泡彻底解耦。
3. **消除信息冲刷冲突**：彻底避免了后台任务状态变化瞬间刷掉前台 LLM 正在生成的思考流或最终答复的体验割裂问题。
