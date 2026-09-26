# Rover Agent Loop 框架评估

> 状态：推荐方案，待小型集成验证 · 2026-09-26<br>
> 范围：React + Tauri 桌面应用中，独立 Node Runtime 执行的 **Rover Agent**。本地 Claude Code、Codex 等 **Code Agent Session** 的启动、观察与打开属于另一层适配器。

## 结论

**首选验证 Pi Agent Core + Pi AI，Rover 自己持有输入回合、Skill、权限、派发和 Task/Session 状态。** Pi AI 提供多供应商模型接口及跨供应商上下文转换；Agent Core 提供有状态工具循环、细粒度事件、消息转换和工具调用前后的拦截。Rover Agent 可以自己使用 Skill 完成目标，这些运行时控制比仅有短回复或分流更重要。[Pi Agent Core](https://github.com/earendil-works/pi/blob/main/packages/agent/README.md) · [Pi AI](https://github.com/earendil-works/pi/blob/main/packages/ai/README.md)

**Vercel AI SDK Core + ToolLoopAgent 是对照候选。** 它有多供应商注册表、工具循环及较直接的工具批准请求处理；若 Pi 的可恢复批准或 Node sidecar 打包代价过高，应选择 AI SDK。上次把 AI SDK 列为首选，主要因为高估了其批准接口的决定性：批准记录和重启恢复仍须由 Rover 实现，Pi 的工具 Hook 也能接入 Rover 自己的策略。[AI SDK 模型管理](https://ai-sdk.dev/docs/ai-sdk-core/provider-management) · [工具批准](https://ai-sdk.dev/docs/ai-sdk-core/tools-and-tool-calling)

## 评估口径

Rover Agent 既可能直接回答，也可能读取业务 Skill 并调用产品能力；只有真正启动本地 Code Agent Session，才注册一对一 Task。一个 Rover 输入回合完成后即可接收下一条输入，无需等待 Task 结束。Task 建立后，对该目标的普通补充、修改和确认进入原 Session；Rover 输入只引导用户打开原 Session，不给已有 Task 追加指令。显式 `@Agent` 触发新派发；按需命中的历史 Task 摘要可进入新 Session，未命中不阻止派发，原 Session 不变。[产品基线](./Rover%20产品能力边界与核心交互.md) · [领域术语](../../CONTEXT.md)

因此优先比较：多模型与本地模型接入、工具调用、批准和暂停、可控的循环终止、事件可观测性、进程重启后的恢复成本、Node sidecar 打包，以及是否会把 Rover 与某个 Code Agent 的会话机制绑死。React 聊天组件的丰富程度不是主要指标，因为 Rover 不展示自身会话列表。

## 候选方案

| 候选 | 多模型与供应商 | Agent loop 与控制 | 需要 Rover 自己实现 | 判断 |
| --- | --- | --- | --- | --- |
| **Pi Agent Core + Pi AI** | 广泛供应商和 OpenAI 兼容端点；明确支持跨供应商上下文转换 | 有状态 Agent、细粒度事件、工具调用前后 Hook、可控制消息上下文 | 人工批准的可恢复流程、应用级权限、Skill/MCP 接入、Task/Session 映射 | **首选验证**：更贴近本地 Rover Agent 的运行时需求 |
| **Vercel AI SDK Core + ToolLoopAgent** | 官方供应商包、供应商注册表及 OpenAI 兼容端点；可按步骤换模型 | 工具循环、停止条件、每步准备、工具批准；MCP 工具可接入 | 输入回合状态、Skill 装载、权限总策略、Task/Session 映射、记忆和持久化 | **对照候选**：批准请求接口直接，且覆盖多供应商 |
| **Claude Agent SDK** | 以 Claude Code/Claude 模型体系为核心；支持 Anthropic 的不同部署渠道 | 完整 Claude Code harness、工具、权限、Hook、Session、Skill/MCP | 跨模型供应商抽象仍需另一层；桌面原会话交接仍须验证 | 适合 Claude 专用执行路径，**不作 Rover 的统一 loop** |
| **LangGraph.js + 模型适配** | 依赖所选模型适配层 | 显式状态图、检查点、人工中断与恢复 | 更多图节点、状态迁移及适配代码 | 若 Rover 本身出现跨天、跨多次人工介入的长流程，再考虑 |
| **OpenAI Agents SDK JS + AI SDK 适配** | 默认偏 OpenAI；可通过 AI SDK 模型适配接更多供应商 | Runner、工具与 Agent 编排 | 多一层模型与事件适配 | 当前 Rover loop 直接使用 Pi 或 AI SDK 更简单 |

依据：[AI SDK 模型管理](https://ai-sdk.dev/docs/ai-sdk-core/provider-management)、[ToolLoopAgent](https://ai-sdk.dev/docs/reference/ai-sdk-core/tool-loop-agent)、[MCP 客户端](https://ai-sdk.dev/docs/ai-sdk-core/mcp-tools)；[Pi 的提供商与跨供应商转换](https://github.com/earendil-works/pi/blob/main/packages/ai/README.md)、[Pi Agent 事件与 Hook](https://github.com/earendil-works/pi/blob/main/packages/agent/README.md)；[Claude Agent SDK 概览](https://code.claude.com/docs/en/agent-sdk/overview)；[LangGraph 的持久化中断示例](https://docs.langchain.com/oss/javascript/langgraph/thinking-in-langgraph)；[OpenAI Agents SDK 的 AI SDK 适配](https://openai.github.io/openai-agents-js/extensions/ai-sdk/)。

### 候选的关键取舍

**AI SDK。** 供应商注册表和 ToolLoopAgent 能完成 Rover 的基本循环。工具需要批准时，SDK 返回批准请求；应用持久化请求和模型消息，收到用户决定后再继续。这个交互路径比在 Node 中持续等待一个 Promise 更便于恢复，但它仍不是应用级权限或持久化方案。其 MCP 客户端主要是工具适配，完整的 MCP 会话、通知等能力需按实际需求另配客户端。[工具批准流程](https://ai-sdk.dev/docs/ai-sdk-core/tools-and-tool-calling) · [MCP 限制](https://ai-sdk.dev/docs/ai-sdk-core/mcp-tools)

**Pi。** Agent Core 直接暴露状态、消息和流式事件，工具调用前后可拦截，Pi AI 对供应商切换有明确的上下文转换；这些都让 Rover 更容易把 Skill 使用、派发和可观测性接在同一个 loop 上。当前上游包名是 earendil-works 命名空间，旧的 mariozechner 包名和示例不可直接当作新版本 API 使用。Pi 自述不内置文件系统、进程、网络等权限隔离，因此 Rover 必须自己做授权与工具边界。Pi 跨供应商转换会把某些推理块转成普通文本；Rover 不应默认将这些内容转发到另一供应商，跨供应商延续优先使用经过选择的 Rover 记忆和可核查的工具结果。[Pi 仓库与权限说明](https://github.com/earendil-works/pi) · [上下文转换细节](https://github.com/earendil-works/pi/blob/main/packages/ai/README.md)

**Claude Agent SDK。** 它是可编程的 Claude Code harness，而非以供应商中立为目标的模型 API。其内置文件操作、命令执行、权限、Session 和 Skill/MCP 对 Claude 专用执行很有价值；拿它做 Rover 核心会把多供应商目标转化为自建兼容层。官方还说明第三方产品不能未经批准向用户提供 claude.ai 登录与订阅额度，应分别设计各供应商的合法认证路径。[Claude Agent SDK](https://code.claude.com/docs/en/agent-sdk/overview)

## 推荐的 Node Runtime 边界

1. **确定性输入层**先解析用户显式的 Skill 和 Agent 指定，管理一次只能发送一条输入的 UI 约束。显式选择不交给模型猜。
2. **RoverTurnRunner** 从记忆、Skill 目录和当前目标构造上下文，调用有步数、时间和费用上限的 Pi Agent loop。输入回合只产生即时回复、澄清、能力说明或派发结果之一；派发结果以工具真正创建 Session 的返回值为准，不从模型文本中猜测。
3. **工具与权限层**持有 Skill 读取、可信数据源、定时计划、`task-recall` 检索及 `agent-dispatch` 等能力。回忆 Skill 从本地已保存的 Task 摘要中按需取回相关内容，作为当前回合的工具结果进入 Rover history；缺失时明确返回缺失，不从历史气泡推测。每个工具执行前由 Rover 策略核验；框架的批准接口是交互机制，不能代替产品授权。派发调用使用内部尝试 ID，避免重启后重复启动 Session。
4. **Code Agent 适配层**负责原 Session 的创建、定位、状态观察和打开。Rover Agent 使用哪家模型与 Code Agent 选 Claude Code 还是 Codex 是两个独立决定。
5. **存储层**由 Node 独占 Task、Task Event、派发尝试、最近活动记录和 Rover 记忆的写入；Tauri 管理窗口和操作系统入口。Sidecar 生命周期由 Tauri 管理。[Tauri Node sidecar 指南](https://v2.tauri.app/learn/sidecar-nodejs/)

Pi 的模型对象、消息和事件不作为 Rover 的持久化领域格式。持久化中保存 Rover 自己的输入回合结果、来源和必要证据；模型上下文是可重建的运行材料。这样将来更换 loop 框架时，Task/Session 关系和用户记录无需迁移。

## “抹平差异”的边界

统一接口可以抹平发起请求、流式文本、工具调用和常见错误类型；**不能保证**不同模型在工具调用质量、结构化输出、图像、推理控制、上下文长度、计费、限流与认证方式上等价。[AI SDK 模型能力说明](https://ai-sdk.dev/docs/foundations/providers-and-models) · [Pi 兼容参数说明](https://github.com/earendil-works/pi/blob/main/packages/ai/README.md)

Rover 应维护模型能力表：至少记录工具调用、视觉、结构化输出、上下文上限和当前认证是否可用。Rover 为每个 Skill 维护所需能力；模型不满足时换可用模型或明确告知，而不是静默降级。跨供应商切换优先发生在 Rover 输入回合之间；同一回合中途切换必须验证消息可转换、工具结果可重放，以及是否会泄露原供应商不应转发的推理内容。默认直连供应商，只有明确需要统一账单或网关策略时才引入中间网关。

## 选型验证

用同一组 Rover 工具和模拟 Code Agent 适配器，分别做 **Pi 与 AI SDK 的小型实现**；先不调用真实 Code Agent，也不依赖真实 API 密钥。验证通过后再接实际模型：

1. 普通问题直接回答，Rover Skill 自己完成，显式 Skill，显式 Agent，未命中 Skill 仍派发。
2. 派发成功才出现 Task；启动失败只在气泡说明；Node 在 Session 创建与 Task 注册之间重启，不重复创建。
3. 需要批准的 Rover 工具在重启后仍可继续；用户拒绝时不执行；一次输入完成后下一条输入可发送，已派发 Task 继续运行。
4. 同一任务分别用 Anthropic、OpenAI、Google 与一个本地兼容端点运行；记录工具参数有效率、结果分类准确率、延迟与费用。供应商切换后不得把推理块当普通用户可见记忆传播。
5. 打包为 Tauri sidecar 后验证启动、崩溃重启、窗口收起后的运行和 IPC 重连。

若 Pi 在可恢复批准、Skill 工具边界或 sidecar 打包上需要大量绕过其内部流程，就选择 AI SDK Core + ToolLoopAgent；若仅是 loop 控制不合适，也可只保留 Pi AI 供应商层，自行写一个小型 Rover loop。无论哪种结果，Rover 的 Task/Session 领域状态都不交给框架定义。
