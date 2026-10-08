# 003: Inbox 领域服务、配置持久化与 Container 注入

**Status**: TODO  
**Blocked By**: 001, 002  
**Blocks**: 004, 005  

## Context & Goal

根据 Rover 的模块解耦规范（ADR-0020 与 `AGENTS.md`），`InboxService` 作为 Inbox 模块的唯一业务协调者，负责向上聚合多个 Provider 实例，向下对接 SQLite Repository，并向桌面端推送实时事件。
本 Ticket 负责实现 `InboxService`、支持外部消息源的配置持久化与动态开关（读取 `~/.rover/inbox.json` 并对 `botSecret` 凭证脱敏），并将 `inboxService` 注入到运行时组合根 `Container` 中。

## Specification & Invariants

1. **配置持久化与凭证脱敏 (`config.ts`)**：
   - 配置存储路径：默认 `~/.rover/inbox.json`（支持环境变量重写以支持测试）；
   - Schema：`WecomInboxConfigSchema` 包含 `enabled: boolean`、`botId?: string`、`botSecret?: string`、`wsUrl?: string`；
   - 提供 `maskConfig()` 函数，回传给外部或前端时，`botSecret` 脱敏遮蔽（如 `sec_****`），不泄露明文。
2. **`InboxService` 核心职责**：
   - 管理注册的 Provider 字典（默认加载 `WecomInboxProvider`）；
   - 监听 Provider 的 `onMessage`，通过 `repository.ingestEvent` 原子落库并去重；
   - 消息入库成功后，调用 `WebSocketManager.broadcast({ type: 'inbox.changed', payload: ... })` 向桌面端广播变更，更新未读数；
   - 提供动态开关 `applyWecomConfig(config)`：若 `enabled === true` 且有有效凭证，启动 Provider；若 `enabled === false`，调用 `provider.stop()` 释放资源；
   - 提供只读查询：`listMessages`、`getUnreadCount`、`getMessageById`；
   - 提供操作接口：`markAsRead`、`markAsDelegated`（或 `markDelegated`）、`linkTask`。
3. **Container 组合根装配**：
   - 在 `packages/runtime/src/container.ts` 中实例化 `InboxService` 并导出为 `container.inboxService`；
   - 启动时自动读取持久化配置，若已启用且配置有效，则拉起长连接；
   - 容器释放或进程退出时安全调用 `inboxService.stopAll()`。

## Affected Components & Directory Structure

```text
packages/runtime/
├── src/
│   ├── container.ts                                     # * [Modified] 组合根装配 inboxService
│   ├── modules/
│   │   └── inbox/
│   │       ├── + [New] config.ts                        # 配置持久化与凭证脱敏逻辑
│   │       ├── + [New] service.ts                       # InboxService 领域服务实现
│   │       └── + [New] index.ts                         # 模块统一 Public Facade 导出
│   └── __tests__/
│       └── + [New] inbox_service.test.ts                # 服务生命周期、广播与组合根单测
```

## Acceptance Criteria

- [ ] `InboxService` 启动时若配置已启用，能自动触发 Provider 建立长连接。
- [ ] 当调用 `applyWecomConfig({ enabled: false })` 时，Provider 立即断开长连接并置为 `disabled`。
- [ ] Provider 收到消息后，`InboxService` 成功调用仓储完成入库，并通过 WebSocketManager 广播 `inbox.changed` 事件与未读计数。
- [ ] 配置存储成功保存至文件，且读取展示时密钥被正确掩码脱敏。
- [ ] `Container` 能正确初始化并暴露只读的 `container.inboxService`。

## Verification Plan

```bash
pnpm --filter @rover/runtime test packages/runtime/src/__tests__/inbox_service.test.ts
```
