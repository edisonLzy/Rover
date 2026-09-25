# Rover 任务监督

Rover 将用户目标交给专业 Agent 执行，并持续记录任务进展、结果与可复用经验。这里定义 Rover 产品语言中各对象的含义及边界。

## 任务与会话

**Coding Agent（专业 Agent）**:
接收用户目标并在自身会话中完成理解、澄清和执行的专业 Agent，例如 Claude Code 或 Codex。

**Task（任务）**:
用户目标在 Rover 中的持久记录；会话建立后关联该目标的原 Agent Session。用户在原会话中处理失败并继续执行时，仍是同一 Task。

**Agent Session（Agent 会话）**:
由 Coding Agent 提供、与一个 Task 关联的交互上下文，承载用户与 Agent 对该任务的讨论、操作和继续处理。

**会话不可用**:
Task 所关联的原 Agent Session 无法打开的状态。它描述会话入口，不等同于任务执行失败。

**Task Event（任务事件）**:
Task 中已发生的可读事实，例如派发、请求用户介入、执行失败或恢复处理。它记录发生了什么，而不是后续任务可直接套用的经验。

**需要用户介入**:
Task 对应的 Agent Session 等待用户回答问题、选择方案或批准操作的状态；该 Task 仍在处理中。

**执行失败**:
Coding Agent 已停止处理且目标未完成时 Task 的结果状态。Agent 仍在自行处理的单次工具或 API 错误不构成执行失败。

**执行摘要**:
Task 处理中对当前阶段或最近一项有意义进展的简短概述，不是 Agent Session 的消息记录。

**结果摘要**:
已结束 Task 的简短结果陈述，说明完成结果、重要产物，或未完成的部分及原因；失败和取消也有结果摘要。
_Avoid_: 完成摘要

## 派发与 Skill

**Agent 派发**:
Rover 为 Task 确定 Coding Agent，并将目标交给它、关联 Agent Session 的过程。

**`/skill`（显式 Skill 引用）**:
用户在目标中明确选定业务 Skill 的输入方式；它指定任务指引，而不是执行者。

**`@Agent`（显式 Agent 指定）**:
用户在目标中明确选定 Coding Agent 的输入方式；它指定执行者，而不是业务 Skill。

**Skill Package（Skill）**:
供 Agent 阅读的可复用做法和相关资源的集合。它提供任务指引，本身不代表执行能力或操作授权。

**业务 Skill**:
面向某类用户目标的 Skill Package，可由 Rover 为普通输入匹配，或由用户明确指定。

**内置 Skill**:
描述 Rover 派发约定或 Agent 任务状态回报约定的 Skill Package，区别于面向具体用户目标的业务 Skill。

**`agent-dispatch`**:
指导 Rover 选择 Coding Agent、派发用户目标并关联 Task 与 Agent Session 的内置 Skill。

**`pet-task-state`**:
指导 Coding Agent 回报任务进度、用户介入与结果的内置 Skill。

**Skill 目录**:
Rover 已索引、可供当前任务选用的 Skill Package 集合；未经审阅保存的 Skill Draft 不在其中。

**Skill Draft（Skill 草稿）**:
从一次或多次 Agent Session 中提炼出的候选 Skill。经用户审阅并保存后，它才成为可用的 Skill Package。

## 经验

**Episode（本地经验）**:
Task 结束后形成的经验记录，保留来源、结果、证据及适用范围。它是后续任务的线索，不是无需验证的结论。
