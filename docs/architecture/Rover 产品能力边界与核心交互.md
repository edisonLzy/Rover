# Rover 产品能力边界与核心交互

> 状态：产品方案基线 · 2026-09-25<br>
> 范围：用户体验、能力分工与信息模型；不规定框架、SDK、通信协议或存储技术。<br>
> 对应交互稿：[桌面原型](../prototype/index.html)

## 1. 产品定位

Rover Agent 是常驻桌面宠物背后接收用户输入的 Agent，也是本地 Code Agent Session 的监督者。它可以直接回答问题，也可以选用 Skill 处理目标。`agent-dispatch` 是 Rover Agent 的内置派发 Skill；当处理流程启动 Claude Code、Codex 等本地 Code Agent Session 时，Rover 为该 Session 建立一对一的 Task 展示。用户也可以用 `/skill` 明确引用 Skill，或用 `@Agent` 指定 Code Agent。

每条真正提交给 Rover Agent 的用户输入开启一次处理回合，并追加到同一份持续的 Agent history；处理回合结束不新建或清空 history。用户通过宠物气泡接收本次即时回答、澄清问题或派发提醒；通过任务列表看见 Code Agent Session「有哪些事正在处理、目前做到哪里、已经完成什么、哪件事需要我」。Rover 不提供自身的会话列表。Code Agent Session 中的深入理解、为完成原目标所需的澄清与确认、计划、工具使用和具体执行不复制到 Rover。用户提出需要 Code Agent 执行的后续目标时，Rover 建立关联来源 Task 的新 Session 与新 Task。

界面分为宠物区域和独立 Dashboard。宠物区域保留悬浮待命、宠物、当前气泡、输入框和任务列表，让用户随时提出新问题或新目标。Dashboard 集中管理 Skill 目录、定时计划、本地经验、Skill 草稿及需关注事项；它不占用宠物区域的任务视图。

**核心体验承诺**：Rover Agent 能直接完成的输入在当前气泡得到答复；Skill 启动 Code Agent Session 时出现可追踪的 Task。后续输入可以参考 Rover 记忆延续上下文，但记忆不承诺逐字复原历史回复。收起宠物不影响已启动的 Session；需要用户介入时一键进入原会话；Session 结束后 Task 留下可核查的结果和本地经验。

## 2. 产品原则与能力边界

**核心交互原则：Rover Agent 处理输入，Task 映射 Code Agent Session。** Rover Agent 能可靠完成的请求在宠物气泡中结束。Skill 是否启动 Code Agent Session 由其流程决定；只有 Session 建立后才出现对应 Task。Rover 跟随 Session 状态更新 Task；需要用户介入、出现需关注的异常或执行失败时，在任务卡片和通知中说明情况，并提供返回原会话的入口。原会话不可用时则如实说明，保留任务记录。

| 事项 | Rover Agent 负责 | 本地 Code Agent 负责 |
| --- | --- | --- |
| 理解请求 | 识别普通输入、`/skill` 与 `@Agent`；判断能否直接回答或选用 Skill | 在自身 Session 中理解接到的目标，补齐执行信息，判断具体做法 |
| 即时回复 | 使用自身可用能力回答轻量问题；缺少必要信息时在气泡中提问；当前回答由气泡呈现 | 不参与 Rover 直接完成的输入 |
| 记忆 | 为后续输入提供经过选择或归纳的上下文，不把记忆当成逐字对话存档 | 按需核对传入的历史线索 |
| Skill | 发现、索引并使用适用 Skill；业务 Skill 可直接完成输入，也可调用内置派发 Skill 启动 Code Agent | 阅读传入的 Skill 指引和必要资源，按自身 Session 的目标执行 |
| 上下文 | 提供任务目标、项目定位、所选 Skill、有关的历史经验和 Rover 内置约定 | 按需阅读代码、文档、日志和工具结果；自行规划与验证 |
| 执行 | 依照 Skill 调用可用能力；派发成功后为新 Code Agent Session 注册一对一 Task，并展示状态摘要 | 在 Session 中调用实际能力并完成目标；出错后的处理和继续执行发生在该 Session |
| 用户介入 | 在统一任务卡片上显示「去确认」，并跳转到对应 Session | 在原会话呈现具体问题、选项、输入框或操作批准，并接收完成当前目标所需的回答与修正 |
| 状态 | 将 Code Agent Session 的状态映射到 Task，更新处理中纯文本摘要与结束后的 Markdown 结果摘要 | 按任务状态维护 Skill 回报有意义的进度、结果和摘要 |
| 经验 | 关联任务、会话与本地经验；提出可复用 Skill 草稿 | 可协助总结经验、起草 Skill，并验证其内容 |

**边界规则**：Skill 定义 Agent 的处理流程，不等于工具、权限或调度器，也不必然创建 Task。比如「创建定时任务」Skill 可以规定由 Rover Agent 使用计划能力完成，或规定调用派发 Skill 交给 Code Agent；只有后一条路径真正创建 Code Agent Session 时才出现 Task。真正保存计划并按时触发仍需可用的产品能力。

## 3. 核心对象

- **Rover Agent**：接收用户输入，直接回答或按照 Skill 处理；派发 Code Agent 是通过内置 Skill 完成的路径。
- **Code Agent**：Claude Code、Codex 等在本地 Session 中执行目标的 Agent。
- **Rover 输入回合**：一次用户输入及 Rover 对它的即时回答、澄清问题或派发说明。它不代表一份新 history；气泡只显示当前回合，Rover 没有会话列表。
- **Rover Agent history**：同一个 Rover Agent 持续追加的用户、助手和工具消息。澄清补充与新目标都在这份 history 中继续；上下文窗口接近限制时才 compaction。
- **Rover 记忆**：MVP 由持续的 Agent history 和必要时的 compaction 提供跨输入上下文；独立长期记忆机制另行设计，压缩后的历史不保证复原过去的原话。
- **宠物区域**：桌面上的轻量交互入口，承载悬浮待命、当前气泡、输入框和任务列表。
- **Dashboard**：独立管理面板，承载 Skill、定时计划、经验与草稿等管理内容。
- **Task**：一个 Code Agent Session 在 Rover 中的展示与记录抽象。Task 与 Session 一对一，随 Session 成功创建而出现；没有 Code Agent Session 的输入不产生 Task。卡片显示该 Session 的目标、状态和结果，内部保留来源与事件记录。
- **后续 Task**：用户针对已有 Task 提出需要 Code Agent 执行的新目标时，形成独立 Task 与独立 Agent Session，并保存来源 Task 的关联。来源 Task 的状态不随新 Task 改变。
- **Agent Session**：Code Agent 提供、与一个 Task 一对一关联的交互上下文。目标的理解、澄清、具体执行与失败后的继续处理都在自身 Session 中进行；「查看会话」打开该 Task 对应的 Session。
- **Skill Package**：一个以 `SKILL.md` 为入口的目录，可以附带 `references/`、`scripts/`、`assets/`。Rover Agent 可以自动匹配业务 Skill，用户也可以用 `/skill` 明确引用。Skill 决定处理步骤，可能由 Rover Agent 直接完成，也可能调用内置 `agent-dispatch` 启动 Code Agent Session。`pet-task-state` 则指导 Code Agent 回报供 Task 展示的状态。
- **Task Event**：任务中发生的可读事实，如已派发、Agent 请求用户介入、执行失败、在原会话恢复处理或结果记录。
- **Episode**：一次任务结束后的本地经验记录，保留来源、结果、证据及适用范围。
- **Skill Draft**：从多次或一次有价值的 Session 中提炼的候选 Skill。草稿经用户审阅后才加入可用 Skill 列表。

宠物气泡回答 Rover Agent 当前输入，Task 回答「对应 Code Agent Session 进展如何」，Session 承载用户与 Code Agent 的具体交互。Rover 保存 Session 定位信息，但不复制或展示其对话内容。用户点击卡片或「查看会话」时，打开该 Task 一对一关联的 Session；Agent 在该 Session 内继续处理仍更新同一个 Task。

## 4. 输入分流、派发与 Skill 装载

Rover Agent 接收输入后先显示短暂的判断状态，再决定直接回答或使用哪个 Skill。Skill 可以让 Rover Agent 利用自身能力完成输入，也可以通过内置 `agent-dispatch` 启动 Code Agent Session；Session 创建成功时，Rover 同步注册与之对应的 Task。缺少必要信息且尚未启动 Session 时，Rover 在气泡中提出简短问题，下一条输入可补足当前目标。没有可用能力时，Rover 直接说明限制，不建立空 Task。

| 本轮处理结果 | Code Agent Session | Rover Task |
| --- | --- | --- |
| Rover Agent 直接回答，或 Skill 由 Rover Agent 完成 | 无 | 无 |
| Skill 启动 Code Agent Session 成功 | 新建一个 | 为该 Session 注册一个 |
| Skill 尝试派发但 Session 启动失败 | 无 | 无；气泡说明失败 |

Rover Agent 复用同一份 history：每次实际执行的 Prompt 作为新的 user message 追加，随后追加本轮 assistant 与 tool 消息。模型依据已有上下文判断是澄清补充、延续话题还是切换目标；不为每次 Prompt 新建 history，也不在目标切换时清空历史。MVP 只在上下文窗口接近限制时触发 compaction，不以固定轮数、目标完成或气泡关闭作为压缩条件。压缩后的历史无法保证无损保存无限轮原话，因此不承诺找回已关闭气泡中的逐字回答；需要长期核查的工作结果进入 Task 或其他明确保存的产物。独立长期记忆机制留待后续设计。

Rover Agent 同一时间只处理一条输入。Prompt 1 仍在处理时，用户可以继续提交 Prompt 2、Prompt 3；界面按提交顺序将它们放进可见的「待处理 Prompt」队列，发送按钮保持可用。队列由界面本地状态维护，尚未提交的文本不进入 Rover Agent history，也不形成 Task。Prompt 1 给出即时回答、澄清问题、能力说明或派发结果后，本轮 Agent Loop 结束，气泡只显示 Prompt 1 的真实输出。界面随即显示队列数量和下一条内容，询问用户是否继续；这条提示由界面生成，不由 Agent 输出，Agent 也不需要通过工具读取队列。用户确认后，界面取出下一条，追加到**同一份** Rover Agent history 并启动下一轮处理；若暂不继续，队列保留，用户可稍后继续或移除。这个 follow-up 交互逐条重复，不自动连续执行队列。

采用 `pi-agent-core` 接入时，界面复用同一个 Rover Agent 实例：用户确认后对它调用 `agent.prompt(nextText)`，由 Agent 将新的 user message 追加到已有 history。界面队列与确认提示不使用 Agent tool；不在 Prompt 1 进行中调用 `steer`，也不提前通过自动 `followUp` 注入后续 Prompt。这里的 follow-up 指界面上的「稍后继续」交互，不代表另开一份 Agent history。

输入框在 Task 处理中继续可用。明确的新目标独立判断，可直接回答或创建新 Task；已有 Task 继续运行，不因新输入暂停。「给 Task 1 再加测试」这类面向已有 Task 的后续目标也创建新 Task 及新 Agent Session，并关联来源 Task 1；Task 1 的状态不改变。若只说「给刚才那个再加测试」而无法可靠定位来源，Rover 先让用户从任务列表选来源，再建立新 Task。新 Session 可获得来源 Task 的目标、已有摘要与可用产物定位，不能假定 Rover 拥有原 Session 的完整对话。若 Prompt 1 以澄清问题结束，待处理 Prompt 默认按新输入提交；用户可在界面明确选择将下一条作为刚才问题的补充回答。这里的界面 follow-up 队列与面向已有 Task 的后续目标是不同概念。

分流依据是执行责任和所需能力。**未命中业务 Skill 不妨碍使用内置派发 Skill**；只要需要 Code Agent，`agent-dispatch` 仍可启动 Session，随之出现 Task。天气等实时问题若 Rover Agent 有可信数据源，可直接回答且不创建 Task；若相关 Skill 选择交给 Code Agent，则启动 Session 并出现 Task；没有可用能力时说明无法查询。原型没有天气数据源，因此展示能力说明。

Rover 索引内置、用户及当前项目中可用的标准 Skill 目录。索引至少保留名称、描述、来源与目录位置。不同输入方式的处理规则如下：

| 用户输入 | Rover 行为 | 业务 Skill |
| --- | --- | --- |
| 普通问题或目标 | 直接回答或使用匹配的 Skill；Skill 决定是否通过内置派发 Skill 启动 Session | 可不选；命中时由 Skill 流程决定如何使用 |
| `/skill` + 目标 | 直接使用用户点名的 Skill；若不存在，应明确告知 | 用户指定的 Skill，不必然产生 Task |
| `@Agent` + 目标 | 使用内置派发 Skill 启动指定 Code Agent Session，并建立对应 Task | 默认不自动附加业务 Skill |
| `/skill` + `@Agent` + 目标 | 使用指定 Skill 与指定执行者；Session 成功创建后建立对应 Task | 用户指定的 Skill |

`@Agent` 是执行者选择，不是 Skill 引用。例如「我想调研 XX 问题，请使用 `@Claude Code` 完成相关调研」会由内置派发 Skill 启动 Claude Code Session，并建立对应 Task。没有 `@Agent` 时，需要派发的 Skill 可借助 `agent-dispatch` 选定执行者。启动 Session 仍依赖产品可用的本地能力；显式指定的 Agent 不可用时，Rover 应说明无法派发，不能悄悄换人。

每个 Task 都保留与自身 Code Agent Session 的一对一关联，并向该 Agent 提供适用的 `pet-task-state`。业务 Skill 是否传给 Code Agent 取决于该 Skill 的流程与用户显式要求。用户为完成当前目标而回答 Agent 提问或确认操作时，进入该 Task 的原 Session；新的后续目标若再次启动 Code Agent Session，则创建关联来源的独立 Task。Rover 的即时回复和派发说明呈现在当前气泡；Code Agent Session 的结果映射到所属 Task 摘要，宠物气泡可以提示用户查看。

Skill 的作用是提供流程指引和可复用资源。Rover 不把 Skill 展示成一个与 Claude Code/Codex 并列的「执行器」，也不把 Skill 文本当成高于用户或执行者规则的授权来源。

## 5. 关键用户流程

### 5.0 宠物说话与气泡状态

宠物气泡是 Rover 当前回合的短消息，不是 Task 卡片，也不承载 Agent 会话。它与任务列表可同时存在。气泡的状态按一次用户输入或一次需关注的任务事件变化：

| 状态 | 气泡内容 | 收起方式 | 后续入口 |
| --- | --- | --- | --- |
| 待命 | 默认不显示气泡；宠物和输入入口保持可见 | — | 打开输入或任务列表 |
| 判断中 | 简短显示「我看看怎么处理…」和轻量动效；不预告结果 | 被下一状态替换；持续过久可自动收起 | 可提交下一条 Prompt 至界面队列 |
| 即时回答 | 显示 Rover 的答案；较长内容在当前气泡内滚动查看 | 用户关闭或下一次输入替换 | 继续输入 |
| 需要补充 | 问一个能决定下一步的简短问题；未派发前不创建 Task | 约 10 秒后自动收起 | 在 Rover 输入中回答，输入框保留待补充提示 |
| 选择来源任务 | 后续目标引用不明确时，请用户选来源 Task；选定后创建独立 Task | 约 10 秒后自动收起 | 在任务列表选择来源 |
| 已派发 | 说明交给哪个 Agent，Task 已出现；不暗示任务已完成 | 约 10 秒后自动收起 | 查看 Task 或 Agent Session |
| 无法处理 | 说明缺少的能力或信息；不创建空 Task | 用户关闭或下一次输入替换 | 重新输入 |
| 任务提醒 | 仅提示需要用户介入、重要结果、失败或需关注异常 | 进行中的提醒约 10 秒后收起；终态结果保留到关闭或下一次输入 | 打开对应 Task 或原 Session |

非终态气泡的自动收起延时约为 10 秒。鼠标停在气泡上时暂停计时，移开后重新计满 10 秒；用户也可随时关闭。自动收起不改变 Task 状态，也不取消待补充的目标。下一条输入替换当前气泡；Rover 不提供旧气泡或会话列表。收起宠物不清除进行中的 Task 或可用于后续输入的记忆。

待处理 Prompt 的「继续下一条」确认位于输入框附近的界面区域，不属于气泡状态。气泡收起也不清除队列。队列项可以移除；继续处理时才从队列取出并进入 Agent history。Task 列表只展示已建立的 Code Agent Session，不展示这些待处理 Prompt。

### 5.1 自然语言派发：以创建定时任务为例

1. 用户输入「帮我设置一个定时任务」。宠物气泡短暂显示判断状态。
2. Rover Agent 选出 `scheduled-task` Skill。本原型将该 Skill 定义为调用内置 `agent-dispatch`，启动 Claude Code Session；Session 创建成功后注册对应 Task。气泡显示「已交给 Claude Code」，Task 卡片显示任务描述和一条纯文本执行摘要。
3. Code Agent 接收任务目标、该 Skill 要求传入的指引、`pet-task-state` 和相关上下文。执行所需的频率或内容不明确时，由 Agent 在 Session 中提问。
4. Rover 跟随 Agent 执行状态更新摘要。收到「需要用户介入」信号时，原 Task 卡片出现「去确认」；用户进入 Code Agent Session 填写时间和任务内容。
5. Agent 创建计划并验证结果，按内置状态 Skill 回报结果。Rover 将卡片切换为完成态，以 Markdown 摘要呈现结果和计划入口，并显示「查看会话」。到了执行时间，只有触发流程实际启动新的 Code Agent Session，才生成与之对应的新 Task。

### 5.2 显式引用 Skill 与直接派发 Agent

用户输入「`/scheduled-task` 每天 09:30 检查支付链路告警」时，Rover Agent 直接选用 `scheduled-task`，无需再猜测业务 Skill；是否出现 Task 仍取决于该 Skill 是否启动 Code Agent Session。本原型的 `scheduled-task` 走派发路径。

用户输入「我想调研 XX 问题，请使用 `@Claude Code` 完成相关调研」时，Rover Agent 使用内置派发 Skill 启动 Claude Code Session，不额外推断或附加业务 Skill。用户同时提供 `/skill` 时，指定 Skill 的流程也生效；需要传给 Code Agent 的指引由该流程决定。Session 建立后，卡片点击即进入与之对应的 Session。

### 5.3 处理中：纯文本执行摘要与用户介入

Rover 将 Session 已创建但排队、执行中以及等待用户的 Task 视为处理中。卡片显示任务描述和一条**纯文本执行摘要**。摘要跟随 Code Agent Session 的执行状态更新，描述当前阶段或最近一项有意义的进展；它是状态概述，不是会话消息流、逐字记录或实时终端输出。列表不额外显示「处理中」「需要你确认」等分组 label；卡片以动态边框或轻量加载效果表达正在执行。

Task 处理中与 Rover 判断中是两种状态。例如 Task 1 尚在运行，但 Rover 已完成 Prompt 1 的派发回合，用户此时输入一个无关的新目标，Rover 可建立 Task 2，两张卡片各自关联自己的 Agent Session。如果 Prompt 2 是对 Task 1 的后续目标，也建立 Task 2，并在卡片标明「接续 Task 1」。两种情况下 Task 1 都继续独立运行。运行中卡片提供「查看会话」入口；需要用户介入时用「去确认」。来源不明确时，Rover 在气泡提醒先选择任务。

```text
<任务描述>
  <正在执行的任务摘要>  [去确认]
```

无论 Agent 正等待操作批准、问题回答还是方案选择，Rover 都只显示「去确认」。该按钮仅在需要用户介入时出现；点击卡片或按钮都定位到对应 Code Agent Session。Rover 不复制 Agent 的确认表单，也不显示「批准 / 拒绝」、会话内容或补充任务输入框。用户在 Agent 原生界面完成决定后，Rover 更新 Task 状态及纯文本摘要。其他 Task 不因这一 Session 等待用户而停止。

单次工具或 API 调用报错时，只要 Agent 仍在原 Session 中处理，Task 保持处理中；Rover 可提示异常并提供原会话入口，不据此宣称任务失败。

### 5.4 处理完成：Markdown 结果摘要、续办与失败

Agent 的本次处理结束后，Task 卡片切换为稳定的完成态，用 **Markdown 格式**呈现简短的结果摘要，并提供「查看会话」入口。列表不添加完成状态 label：

```text
<任务描述>
  <任务结果摘要（Markdown）>
  <查看会话>
```

摘要应写明完成结果、重要产物或仍未完成的部分，可用段落、列表、强调和链接表达；它不是会话全文。只有 Agent 停止处理且目标未完成，Task 才记录执行失败；失败或取消采用已结束的卡片形态，摘要须明确说明未完成及原因，不能冒充成功。失败卡片保留「查看会话」入口，用户在原 Agent Session 中查看原因并继续处理；Agent 后续恢复执行时，同一 Task 回到处理中，保留先前失败事实。

Rover 不提供重新派发或新建 Session 的重试按钮。如果原 Session 无法打开，Rover 应如实显示会话不可用并保留失败记录，不能把用户导向一段无关会话。

Rover 保存会话运行事实，也接收 Agent 依照 `pet-task-state` 报告的语义进度。两者不一致时，界面不能仅凭一段最终回答宣称任务成功；应呈现待核对或失败事实，保留原记录。

### 5.5 经验沉淀与 Skill 草稿

任务结束后，本地形成带来源的 Episode。相似任务再次出现时，Rover 可以把相关 Episode 作为线索交给 Agent，Agent 仍需验证当前情况。

当一次或多次 Session 呈现稳定、可复用的做法，Rover 可以提出标准 Skill 目录草稿。用户先查看适用条件、步骤、来源和可能涉及的敏感内容，再选择「保存 Skill」或「忽略」。保存后才加入 Skill 索引；草稿和已启用 Skill 在界面中必须有清楚区分。这是 Rover 的经验型 Self Improve，不意味着自动修改模型或未经审阅地改变以后任务的行为。

## 6. 状态与通知

| 卡片形态 | 内部状态 | 卡片内容 | 主要入口 |
| --- | --- | --- | --- |
| 处理中 | Session 已创建且排队中、进行中、需要你确认 | 任务描述 + 随 Agent 状态更新的纯文本摘要；需要介入时显示「去确认」 | 点击卡片或「去确认」打开一对一关联的 Session |
| 处理完成 | 已完成、失败、已取消 | 任务描述 + Markdown 结果摘要 +「查看会话」；失败和取消须明确标识结果 | 「查看会话」打开原 Session；不可访问时显示会话不可用 |

Rover 只在需要用户介入、发生重要结果、执行失败或需要关注的异常时主动打断；普通进度变化只更新 Task 卡片，不反复占用宠物气泡。列表按处理中的 Task 在前、已结束的 Task 在后排列，不加分组 label；运行状态由卡片边框或加载效果表达。处理中摘要随 Agent 状态产生有意义的变化而更新；没有新状态时保留上一条可信摘要，不根据会话文字猜测进度。关闭或收起宠物不影响 Task 的持续记录。通知点击后在可访问时定位到对应 Agent Session；若 Session 创建失败，则说明派发失败且不创建 Task；原 Session 后来不可用时显示不可用说明，并保留已有 Task 记录。

## 7. 原型范围与验收点

原型展示独立 Dashboard 与宠物区域、悬浮待命与持续可用的输入框、界面维护的待处理 Prompt 队列及逐条继续确认、Rover Agent 直接回答、`current-time` Skill 由 Rover Agent 完成且不创建 Task、无法查询实时天气、未命中业务 Skill 时使用内置派发 Skill、后续目标创建关联来源的新 Task、`/skill` 和 `@Agent` 指定路径、宠物气泡状态及非终态自动收起、两种无状态 label 的任务卡片、Task/Session 一对一关系、纯文本执行摘要更新、Markdown 结果摘要、会话跳转占位、可恢复的 API 错误、执行失败后回到原会话、完成回填、经验记录和 Skill 草稿审阅。原型只演示当前回合的补充信息关联，不实现长期 Rover 记忆。所有操作为演示数据；原型不展示 Agent 会话内容，也不实际启动 Agent、查询天气、注册定时器或安装 Skill。

评审时应能沿着以下路径走通：

1. 输入「Rover 能做什么」→ 气泡直接回答，不创建 Task 或会话记录；输入「`/current-time` 现在几点」→ Rover Agent 执行 Skill 并回答，仍不创建 Session 或 Task；输入「帮我」→ Rover 提问，气泡约 10 秒后可自动收起，用户补充「整理这份需求文档」后才派发；输入「今天天气怎么样」→ 气泡说明原型没有实时天气数据，不创建 Task。
2. 输入「帮我整理这份需求文档」→ 没有匹配业务 Skill，仍可通过内置派发 Skill 启动 Code Agent Session，并出现一对一 Task；输入「帮我设置一个定时任务」→ Rover Agent 自动匹配本原型中配置为派发的 `scheduled-task`；输入「`/scheduled-task` …」→ 直接引用该 Skill。
3. 输入带 `@Claude Code` 的调研任务 → 直接派发给 Claude Code，不自动选业务 Skill。
4. 模拟 Agent 进度变化 → 「处理中」卡片的纯文本摘要更新；模拟请求缺失信息 → 卡片增加「去确认」，气泡提示入口 → 定位原 Session → Task 继续。
5. 模拟 Agent 完成 → 卡片移入「处理完成」，显示 Markdown 摘要和「查看会话」→ 出现可审阅的 Episode / Skill 草稿。
6. QA 发布等待批准 → Rover 卡片显示「任务描述 + 纯文本摘要 + 去确认」；确认或取消属于 Agent Session，Rover 原型不展示该会话内容。
7. 模拟 Agent 的 API 调用报错但仍在处理 → Task 保持处理中并提供原会话入口；模拟 Agent 停止且任务未完成 → Task 显示失败摘要和「查看会话」→ 模拟在原 Session 继续 → 同一 Task 回到处理中。
8. 模拟原 Session 无法打开 → 失败卡片显示「会话不可用」并保留任务记录，不显示可用的会话跳转按钮。
9. Prompt 1 仍在判断时提交 Prompt 2、Prompt 3 → 两条按序进入界面待处理队列，不进入 Rover Agent history，也不出现在 Task 列表；Prompt 1 得到结果后气泡只显示该结果，界面询问是否继续下一条。选择「暂不处理」保留队列；选择「继续下一条」才将 Prompt 2 交给 Rover Agent，Prompt 3 继续等待。若 Prompt 1 请求澄清，Prompt 2 默认是新输入，只有明确切换后才作为澄清回复；无需等待 Task 1 完成。
10. Task 1 运行时输入一个独立目标 → 新建 Task 2，两项任务各有自己的 Session；输入「给刚才那个再加测试」→ Rover 提示选择来源 Task → 新建接续 Task，来源 Task 的状态与 Session 不变。
11. 收起宠物后仍能从悬浮待命入口打开输入与任务列表；打开 Dashboard → Skill 目录、定时计划、经验与草稿在独立面板，宠物区域仍可显示当前任务。

这份文档确定的是产品行为和职责边界。具体 Agent 接入方式、状态接口、目录装载机制及存储形式留给后续技术设计。
