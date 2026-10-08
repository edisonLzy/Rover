# 005: Agent 受控读取 Inbox 详情工具

**Status**: DONE
**Blocked By**: 001, 003
**Blocks**: None

## Context & Goal

根据 Rover 架构原则，外部消息到达时不自动启动模型或派发 Code Agent；当用户选择交办（Handoff）或在输入框提交带 `#inbox` 引用的 Prompt 时，Rover 才启动活跃回合。此时，Rover 需要通过受控工具按需读取完整的外部消息体作为事实证据（而非让消息直接充当系统指令）。
本 Ticket 负责实现 Agent 端的 `get_inbox_detail` 受控工具。

## Specification & Invariants

1. **受控工具 `get_inbox_detail`**：
   - 权限边界：只读受控工具，严禁修改消息内容或提升权限；
   - 参数：`{ inboxMessageId: string }`；
   - 行为：通过 `container.inboxService.getMessageById(inboxMessageId)` 检索消息；
   - 返回：包含 `sourceId`, `title`, `summary`, `occurredAt`, `payload`（如企微聊天会话参数、报错原文），作为事实数据块（Data Block）注入模型上下文；如果不存在返回友好错误，不崩溃。
2. **输入与指令隔离原则**：
   - 来自企微等外部来源的文本仅作为事实数据返回，不作为系统指令执行，也不得提升工具权限。

## Affected Components & Directory Structure

```text
packages/runtime/
├── src/
│   ├── types/
│   │   └── * [Modified] prompt.ts                        # 移除旧的重复文本转换函数
│   ├── modules/
│   │   └── agent/
│   │       ├── * [Modified] service.ts                   # 将 InboxService 传给 Agent Runtime
│   │       ├── * [Modified] types.ts                     # AgentService 依赖声明
│   │       └── runtime/
│   │           ├── * [Modified] factory.ts               # 注册受控工具
│   │           ├── * [Modified] index.ts                 # 从具体工具文件导出公开契约
│   │           ├── * [Modified] prompts.ts               # 将 Inbox 引用 ID 传给 Agent
│   │           ├── * [Modified] runtime.ts               # 使用含引用 ID 的 Agent 输入
│   │           └── tools/
│   │               ├── + [New] inbox.ts                  # get_inbox_detail 受控工具实现
│   │               ├── - [Deleted/Moved] index.ts        # 移除宽泛 barrel
│   │               └── - [Deleted/Moved] skill.ts        # 移除只转发的包装文件
│   └── __tests__/
│       ├── + [New] inbox_agent_tool.test.ts             # 受控工具查询与引用顺序单测
│       └── * [Modified] prompt.test.ts                   # 验证统一转换函数
└── * [Modified] src/container.ts                        # 组合根注入 InboxService
```

## Acceptance Criteria

- [x] Agent 回合中可成功调用 `get_inbox_detail` 获取指定消息的完整数据负载。
- [x] 若查询不存在的 ID，返回明确的找不到记录错误，不抛出异常。
- [x] 返回的外部消息内容保持事实数据边界，不作为指令执行。

## Verification Plan

```bash
pnpm --filter @rover/runtime test packages/runtime/src/__tests__/inbox_agent_tool.test.ts
```
