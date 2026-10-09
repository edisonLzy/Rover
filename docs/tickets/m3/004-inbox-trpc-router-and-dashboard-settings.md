# 004: Inbox tRPC 路由与 Dashboard 集成设置

**Status**: DONE  
**Blocked By**: 003  
**Blocks**: None  

## Context & Goal

为支持桌面端 UI 查阅收件箱消息，以及允许用户在管理后台图形化配置企业微信等外部消息来源的开关和密钥，需要向前端暴露 tRPC API 契约，并在 Dashboard 窗口中实现「消息集成」管理面板。
本 Ticket 负责构建 `inboxRouter`、挂载到应用主路由，并在 Dashboard 中实现支持开关切换、状态徽标、密钥保护及一键测试连接的设置面板。

## Specification & Invariants

1. **tRPC 路由契约 (`packages/runtime/src/modules/inbox/router.ts`)**：
   - 消息查询与管理：
     - `inbox.list`: 查询消息列表（支持分页与状态过滤）；
     - `inbox.getUnreadCount`: 获取未读消息计数；
     - `inbox.markAsRead`: 批量标记已读；
     - `inbox.markAsDelegated`: 标记消息已一键交办（开启 Rover 回合，此时不关联 Task ID）；
     - `inbox.linkTask`: 将指定消息与 Rover Agent 派发创建的 Task ID 关联；
   - 企业微信 Provider 设置与运维：
     - `inbox.getWecomConfig`: 获取当前开关状态、Bot ID、脱敏 Secret、以及当前连接状态徽章（`disabled` | `connecting` | `connected` | `auth_failed` 等）；
     - `inbox.updateWecomConfig`: 保存开关与配置，触发服务重载或启停；
     - `inbox.testWecomConnection`: 输入临时凭证，执行握手测试并返回延迟与结果信息。
2. **Dashboard 界面设计 (`packages/app/src/features/dashboard/inbox-settings/`)**：
   - 在 Dashboard 导航或设置中加入「消息集成 (Inbox)」视图；
   - 采用卡片化布局展示「企业微信智能机器人」：
     - 顶部包含开关（Switch）：打开展开表单，关闭折叠；
     - 表单输入项：`Bot ID`、`Bot Secret`（输入框尾部提供小眼睛 `Eye` / `EyeOff` 按钮，支持在密码遮蔽态 `••••••` 与明文之间一键切换）；
     - 底部操作栏：提供「测试连接」按钮与「保存配置」按钮；
     - 状态徽标（Status Badge）：动态反馈当前运行状态（绿色已连接、黄色连接中、红色错误等）。

## Affected Components & Directory Structure

```text
packages/runtime/
├── src/
│   ├── modules/
│   │   └── inbox/
│   │       └── + [New] router.ts                        # Inbox tRPC 路由定义
│   └── transport/
│       └── * [Modified] trpc.ts                         # 挂载 inboxRouter 到 appRouter
packages/app/
├── src/
│   ├── features/
│   │   └── dashboard/
│   │       ├── * [Modified] index.tsx                   # 导航增加消息集成入口
│   │       └── inbox-settings/
│   │           ├── + [New] index.tsx                    # 消息集成设置面板主视图
│   │           └── + [New] WecomConfigCard.tsx          # 企微卡片开关、表单与测试按钮
│   └── __tests__/
│       └── + [New] DashboardInboxSettings.test.tsx      # Dashboard 设置交互测试
```

## Acceptance Criteria

- [x] tRPC 路由中的查询、已读、交办以及配置管理接口均能通过自动化测试。
- [x] 调用 `testWecomConnection` 接口能返回真实的测试探针结果，不破坏当前主连接。
- [x] 在 Dashboard 页面能切换开关：保存后 Runtime 即刻启停长连接。
- [x] 页面上的状态徽标能根据 Runtime 实际连接状态（如 `connected`、`auth_failed`）实时变色。
- [x] 密钥输入框具备脱敏保护，且修改保存逻辑正常。

## Verification Plan

```bash
pnpm --filter @rover/runtime test packages/runtime/src/__tests__/inbox_service.test.ts
pnpm --filter @rover/app test packages/app/src/__tests__/DashboardInboxSettings.test.tsx
```
