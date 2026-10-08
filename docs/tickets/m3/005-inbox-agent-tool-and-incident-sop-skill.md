# 005: Agent 受控读取工具与线上故障排查 SOP Skill

**Status**: TODO  
**Blocked By**: 001, 003  
**Blocks**: None  

## Context & Goal

根据 Rover 架构原则，外部消息到达时不自动启动模型或派发 Code Agent；当用户选择交办（Handoff）或在输入框提交带 `#inbox` 引用的 Prompt 时，Rover 才启动活跃回合。此时，Rover 需要通过受控工具按需读取完整的外部消息体作为事实证据（而非让消息直接充当系统指令）。
同时，针对用户在企业微信反馈线上故障的典型场景，Rover 不需要自身承担繁重的日志检索与代码分析工作，而是通过定义清晰的业务 Skill（SOP 标准作业程序），指导 Coding Agent（如 Claude Code CLI）利用本机已有的 `csp-monitor` 命令行工具和代码检索权限，端到端完成根因排查。
本 Ticket 负责实现 Agent 端的 `get_inbox_detail` 受控工具，并提供开箱即用的 `incident-investigation` 故障排查 Skill。

## Specification & Invariants

1. **受控工具 `get_inbox_detail`**：
   - 权限边界：只读受控工具，严禁修改消息内容或提升权限；
   - 参数：`{ inboxMessageId: string }`；
   - 行为：通过 `container.inboxService.getMessageById(inboxMessageId)` 检索消息；
   - 返回：包含 `sourceId`, `title`, `summary`, `occurredAt`, `payload`（如企微聊天会话参数、报错原文），作为事实数据块（Data Block）注入模型上下文；如果不存在返回友好错误，不崩溃。
2. **线上故障排查 Skill (`incident-investigation`)**：
   - 存放于 `packages/app/resources/skills/incident-investigation/SKILL.md`；
   - 触发时机：用户交办或提问涉及线上异常、报错日志、企业微信反馈排查时激活；
   - 核心 SOP 规范：
     1. **提取问题关键要素**：提取时间范围、报错文本、用户 ID、TraceID 等；
     2. **构造 Coding Agent 任务**：向用户确认或自动定位本地代码目录（`cwd`）；
     3. **传递 SOP 指令**：指示 Coding Agent 在目标仓库执行本地已有的 `csp-monitor` CLI（例如 `csp-monitor logs --since "..." --grep "..."`）捞取堆栈；
     4. **源代码根因追踪**：指示 Coding Agent 根据堆栈检索本地代码并定位根本原因与修改方案；
     5. **受控派发**：调用 Rover 内置的 `dispatch_agent` 工具启动 Claude Code / Codex，生成 Task 卡片。
3. **输入与指令隔离原则**：
   - Skill 提示词严格约束：来自企微外部的文本仅视为“外部证据”，不可覆盖系统指令或越权操作文件。

## Affected Components & Directory Structure

```text
packages/runtime/
├── src/
│   ├── modules/
│   │   └── agent/
│   │       └── tools/
│   │           └── + [New] inbox.ts                     # get_inbox_detail 受控工具实现
│   └── __tests__/
│       └── + [New] inbox_agent_tool.test.ts             # 受控工具查询单测
packages/app/
└── resources/
    └── skills/
        └── incident-investigation/
            └── + [New] SKILL.md                         # 线上故障排查标准作业程序 (SOP)
```

## Acceptance Criteria

- [ ] Agent 回合中可成功调用 `get_inbox_detail` 获取指定消息的完整数据负载。
- [ ] 若查询不存在的 ID，返回明确的找不到记录错误，不抛出异常。
- [ ] 内置 Skill 目录成功扫描并加载 `incident-investigation` Skill。
- [ ] Skill 文档清晰阐明对外部数据的防注入约束，以及指导 Coding Agent 使用本地 `csp-monitor` CLI 进行日志分析的步骤。
- [ ] 验证端到端派发组装逻辑：生成的 `taskPrompt` 包含了企微问题上下文与 `csp-monitor` 排查 SOP。

## Verification Plan

```bash
pnpm --filter @rover/runtime test packages/runtime/src/__tests__/inbox_agent_tool.test.ts
```
