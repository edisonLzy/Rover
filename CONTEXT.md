# Rover Agent 与任务监督

Rover Agent 接收用户输入，直接回答或按照 Skill 处理；需要本地 Code Agent 执行时启动其 Session，并由 Rover 呈现对应 Task。这里定义 Rover 产品语言中各对象的含义及边界。

## Rover 输入与记忆

**Rover 输入回合**:
一次用户输入及 Rover 对它的即时回复、澄清问题、能力说明或派发结果。Rover 给出其中一种结果后，本轮处理结束；已派发 Task 的执行不延长这一回合。回合只是界面和执行周期的边界，不创建新的 Agent history。界面只呈现当前回合，不提供 Rover 会话列表。

**AgentRuntime（Agent 运行时回路）**:
负责维护底层 Agent 实例、调度 Prompt / Steer / Follow-Up 三模态输入队列、分发生命周期 Callbacks 的纯领域核心执行回路。它不持有 SQLite 数据库或网络广播连接，专注于交互推进与推理控制。
_Ref_: ADR-0019
_Avoid_: RoverTurnEngine、执行引擎

**CQRS 查询（只读查询分离）**:
Rover 架构中将改变 Agent 执行状态的命令与读取历史状态的只读查询在通道与生命周期上的彻底解耦。写操作（启动、插话、追问、取消）全量流经 `AgentRuntime`；读操作（回合记录、历史 Entry 检索）直接面向底层 Storage 数据库，严禁为只读操作唤醒或依赖执行运行时实例。
_Ref_: ADR-0019

**Rover Agent history**:
Rover Agent 跨用户目标持续使用的全局上下文，不按项目划分。用户补充澄清信息或开始另一个目标时仍沿用这份上下文；回忆旧任务时，检索到的 Task 摘要可作为本轮工具结果进入 history。它不是 Task 与 Session 关联的事实来源。

**Follow-Up（后续跟进）**:
用户在 Rover 输入回合进行中通过 `Enter` 提交或由 Inbox 卡片一键交办的排队输入。它直接挂入底层 Agent 的 `followUpQueue`，并在前端以单行微型胶囊的形式附着于宠物气泡底部的微型徽章架（Badge Shelf）中，支持拖拽重排与随手删除。当前回合结束后自动接力开启下一轮，消费后按既有规范计入 Rover Agent history。
_Ref_: ADR-0018

**Steer（实时插话 / 转向）**:
用户在 Rover 输入回合进行中通过 `Cmd + Enter`（Win 下为 `Ctrl + Enter`）提交的强权干预指令。它直达底层 Agent 的 `steeringQueue`，在模型推理与工具执行间隙优先被消费以实现实时纠偏；它不进入前端徽章架排队，气泡就地给出微反馈。
_Ref_: ADR-0018

**即时回复**:
Rover 使用自身可用能力直接给出的答复。它结束当前输入回合，不形成 Task。

**Rover 记忆**:
当前 MVP 由持续的 Rover Agent history 及其必要时的 compaction 提供跨输入上下文；未来的独立长期记忆机制另行设计。压缩后的历史不保证复原过去的原话。

## 界面区域与状态

**宠物区域**:
桌面上随 Rover 常驻的轻量交互区域，承载宠物形象、气泡、输入栏、任务列表及 Inbox 列表。它与独立的 Dashboard 区分。

**宠物形象**:
宠物区域中可拖动、可点击的 Rover 角色图像。

**悬浮待命态**:
宠物区域收起时的界面状态，主要显示宠物形象及其下方的快捷操作胶囊；Inbox 有未读消息时仍可显示 Inbox 气泡。
_Avoid_: 胶囊态

**交互展开态**:
宠物区域展开时的界面状态，显示输入栏与任务列表；排队的 Follow-Up 收敛于宠物气泡底部的微型徽章架，工具栏下方不再维持独立的待处理多行队列。

**快捷操作胶囊**:
悬浮待命态中位于宠物形象下方的胶囊形操作栏，提供输入、语音和通知入口。它是组件名称，不是整个界面状态的名称。
_Avoid_: 胶囊状态 UI

**输入栏**:
宠物区域内提交 Rover 问题或目标的控件，包含执行者选择与发送入口。

**宠物气泡**:
宠物形象旁显示当前 Rover 输入回合的回答、澄清或重要 Task 事件的短消息；其底部可承载 Follow-Up 微型徽章架。它不构成历史消息列表。

**任务列表**:
交互展开态中呈现已建立 Task 的列表，每一项称为任务卡片。

**任务卡片**:
任务列表中一个 Task 的可见条目，呈现目标、可信进度或结果；原 Session 可用时，点击后直接进入该 Session。

**需关注任务**:
等待用户介入或执行失败等需要用户查看的 Task 的筛选视图。它不是 Inbox 消息列表。

**Dashboard（管理面板）**:
独立于宠物区域的管理界面，集中呈现 Skill 目录、定时计划及运行日志、最近活动、Inbox、模型配置、本地数据删除及需关注任务；由 macOS 菜单栏的 Rover 菜单进入。

**Rover 菜单栏图标**:
macOS 菜单栏中的 Rover 常驻入口；右键打开包含 Dashboard 入口的菜单，宠物区域本身不承载 Dashboard 入口。

**Dashboard Inbox**:
Dashboard 中查看 Inbox 消息与历史的视图，与宠物区域展开的 Inbox 列表指向同一批消息。

## 任务与会话

**Rover Agent**:
接收用户输入的全局桌面 Agent，不隶属于某个项目。它可直接回答、提出澄清问题，或选用 Skill 处理目标；派发 Code Agent 是由 Skill 流程决定的处理路径。

**Code Agent（本地 Code Agent）**:
在本地 Session 中理解、澄清并执行目标的 Agent，例如 Claude Code 或 Codex。

**Task（任务）**:
经 Skill 派发而建立的一个 Code Agent Session 在 Rover 中的展示与记录抽象。Task 与 Session 一对一；其状态和结果反映该 Session。没有创建 Code Agent Session 的 Rover 回答或 Skill 处理不产生 Task。同一 Session 即使在结束后继续处理，仍更新同一 Task。

**Agent Session（Agent 会话）**:
由 Code Agent 提供、与一个 Task 一对一关联的交互上下文，承载用户与 Agent 对目标的讨论、操作、执行和继续处理。Task 建立后，用户对该目标的补充进入此 Session；Rover 输入不会给它追加指令。

**Task 摘要（可引用摘要）**:
Code Agent 在所属 Session 中按需写出的任务内容总结，供 Rover 在用户回忆过往工作或提出相关新需求时检索。它可能不存在；Rover 不从 Session 状态、Task 卡片文案或旧对话自行补写。检索是否命中不决定新需求能否派发。

**会话不可用**:
Task 所关联的原 Agent Session 无法打开的状态。它描述会话入口，不等同于任务执行失败。

**Task Event（任务事件）**:
Task 中已发生的可读事实，例如派发、请求用户介入、执行失败或恢复处理。它记录发生了什么，而不是后续任务可直接套用的经验。

**需要用户介入**:
Task 对应的 Agent Session 等待用户回答问题、选择方案或批准操作的状态；该 Task 仍在处理中。

**执行失败**:
Code Agent Session 已停止处理且目标未完成时 Task 映射出的结果状态。Agent 仍在自行处理的单次工具或 API 错误不构成执行失败。

**执行摘要**:
Task 处理中对当前阶段或最近一项有意义进展的简短概述，不是 Agent Session 的消息记录。

**结果摘要**:
已结束 Task 的简短结果陈述，说明完成结果、重要产物，或未完成的部分及原因；失败和取消也有结果摘要。
_Avoid_: 完成摘要

## 派发与 Skill

**目标仓库**:
某次请求需要查询或处理的代码仓库，由该次请求明确指定或在澄清后确定。它不构成 Rover 的项目对象。

**Agent 派发**:
Rover Agent 依照内置派发 Skill 选择 Code Agent、启动 Session，并为该 Session 注册一对一 Task 的过程。

**`/skill`（显式 Skill 引用）**:
用户在输入中明确选定业务 Skill 的方式；它指定处理流程，而不是执行者，也不必然创建 Task。

**`@Agent`（显式 Agent 指定）**:
用户在目标中明确选定 Code Agent 的输入方式；它指定执行者，并要求 Rover 派发对应的 Session，而不是指定业务 Skill。

**Skill Package（Skill）**:
供 Rover Agent 或 Code Agent 使用的可复用做法与资源集合。Skill 定义处理步骤；它可以让 Rover 直接完成目标，也可以派发一个或多个 Code Agent Session。选中 Skill 本身不必然创建 Task，也不代表额外权限。

**业务 Skill**:
面向某类用户目标的 Skill Package，可由 Rover Agent 为普通输入匹配，或由用户明确指定；是否启动 Code Agent Session 由该 Skill 的流程决定。

**内置 Skill**:
描述 Rover Agent 派发约定或 Code Agent 任务状态回报约定的 Skill Package，区别于面向具体用户目标的业务 Skill。

**`agent-dispatch`**:
供 Rover Agent 使用的内置 Skill，指导它选择 Code Agent、启动 Session，并注册对应 Task。

**`task-recall`**:
供 Rover Agent 使用的内置 Skill，依据用户的自然语言线索或 Task ID 检索本地可引用 Task 摘要，并把查得的内容用于当前输入回合。仅检索和回答时不创建 Code Agent Session 或 Task；派发新需求时，命中摘要可作为补充背景。

**`pet-task-state`**:
指导 Code Agent 回报 Session 进度、用户介入与结果，供 Rover 映射为 Task 状态的内置 Skill。

**Skill 目录**:
Rover 已索引、可供 Rover Agent 或 Code Agent 选用的 Skill Package 集合。

## 定时运行

**定时计划**:
由 Rover 管理、约定在未来时间触发处理的安排。计划本身不是 Task；只有触发处理时建立了 Code Agent Session，才出现对应 Task。

**计划运行记录**:
定时计划一次触发的结果记录，无论该次处理是否建立 Code Agent Session。建立 Session 时，它关联对应 Task；未建立 Session 时，它仍保留触发结果。

## Inbox

**Inbox（收件箱）**:
Rover 收纳需要告知用户的消息及其处理入口的统一消息集合。Inbox 气泡提示未读消息；气泡消失不删除消息，用户仍可在 Inbox 查看。

**Inbox 气泡**:
宠物形象旁显示 Inbox 未读消息数的常驻提醒组件；未读数大于零时显示，可打开宠物区域的 Inbox 列表。它与显示当前 Rover 回合的宠物气泡是两个独立组件。

**Inbox 列表**:
按类型呈现 Inbox 消息的视图，可从 Inbox 气泡在宠物区域展开，也可在 Dashboard Inbox 查看。同一列表包含告警等不同类型的消息。

**`#` Inbox 引用**:
用户在 Rover 输入栏选中一条 Inbox 消息后插入的引用，指向所选消息。插入引用本身不标已读，也不启动消息处理。

**Inbox 消息**:
Inbox 中可独立查看的一条消息，有来源、类型、标题和到达时间。消息可被来源更新；收到消息本身不产生 Task，也不进入 Rover Agent history。

**外部来源**:
用户为 Rover 登记的外部系统身份，其送达的 Inbox 消息有明确的来源归属。未登记的发送者不能代替用户交办目标。

**告警消息**:
类型为告警的 Inbox 消息，描述外部监控系统报告的一次异常发生。它可以随异常进展更新，并由用户交给 Rover 处理；只有建立 Code Agent Session 时才出现关联 Task。
_Avoid_: 报警 Task

**告警轮次**:
同一监控对象从异常开始到恢复的一次发生。恢复后再次异常属于新轮次，即使来源系统复用同一个 Issue ID。

## 最近活动

**最近活动记录**:
Rover 对近期已结束 Task 的结果及自身实际完成的操作所作的本地记录。它回答「最近做了什么」，不包含普通问候和问答，也不代表可复用的处理方法。
_Avoid_: Episode、本地经验
