# 002: Inbox Provider 核心契约与企业微信 WebSocket 驱动

**Status**: TODO  
**Blocked By**: None (*Frontier*)  
**Blocks**: 003  

## Context & Goal

根据 Rover 接收外部异步消息的规划，外部通知源（如企业微信、飞书、监控告警）需通过统一的驱动接口（Provider）接入 Rover。基于已验证的 `@wecom/aibot-node-sdk` 方案，企业微信智能机器人支持出站长连接（WebSocket），无需本地公网 IP 或 Webhook 域名。
本 Ticket 旨在抽象统一的 `InboxProvider` 接口契约，并在 `@rover/runtime` 中引入 `@wecom/aibot-node-sdk` 依赖，实现首个内置提供商 `WecomInboxProvider`。

## Specification & Invariants

1. **统一 Provider 接口契约 (`InboxProvider`)**：
   - `id: string`: 唯一提供商标识（如 `'wecom'`）；
   - `displayName: string`: 展示名称（如 `'企业微信智能机器人'`）；
   - `getStatus(): InboxProviderStatus`: 返回 `'disabled' | 'connecting' | 'connected' | 'auth_failed' | 'disconnected' | 'error'`；
   - `onMessage(dispatcher: InboxMessageDispatcher): void`: 注册接收消息的回调管线；
   - `onStatusChange?(listener: ProviderStatusListener): void`: 状态变化通知；
   - `start(config: TConfig): Promise<void>`: 启动长连接；
   - `stop(): Promise<void>`: 优雅断开连接并清理句柄；
   - `testConnection?(config: TConfig): Promise<ConnectionTestResult>`: 连通性与凭证校验探针；
   - `reply?(event: IncomingInboxEvent, text: string): Promise<void>`: 双向回传接口。
2. **标准化投递事件 (`IncomingInboxEvent`)**：
   - 包含 `sourceId`, `sourceEventId`, `sourceMessageId`, `revision`, `kind`, `title`, `summary`, `occurredAt`, `payload`；
   - 字段对齐 [Rover Inbox 投递协议 v1](../../architecture/Rover%20Inbox%20%E6%8A%95%E9%80%92%E5%8D%8F%E8%AE%AE%20v1.md)。
3. **企业微信 Provider (`WecomInboxProvider`) 实现要点**：
   - 基于 `@wecom/aibot-node-sdk` 的 `AiBot.WSClient`；
   - 支持解析 `text`（文本）、`voice`（语音转写）及 `mixed`（图文混排）正文并组装标题与摘要；
   - 提取 `chatid`、`from.userid`，正确映射 `chattype`（`group` / `single`）；
   - 捕获 `WSAuthFailureError`，直接将状态置为 `auth_failed` 并停止无限重连；
   - 进程退出守卫与重试退避上限约束；
   - 实现 `replyStream` 回复群聊闭环。

## Affected Components & Directory Structure

```text
packages/runtime/
├── package.json                                         # * [Modified] 添加 @wecom/aibot-node-sdk 依赖
├── src/
│   ├── modules/
│   │   └── inbox/
│   │       ├── * [Modified] types.ts                    # + [Add] InboxProvider, IncomingInboxEvent 核心契约
│   │       └── providers/
│   │           └── + [New] wecom.ts                     # 企业微信 WebSocket Provider 实现
│   └── __tests__/
│       └── + [New] wecom_provider.test.ts               # Provider 协议转换与状态机测试
```

## Acceptance Criteria

- [ ] `packages/runtime` 成功引入 `@wecom/aibot-node-sdk` 且构建通过。
- [ ] `InboxProvider` 接口完整覆盖生命周期、消息管线、测试握手与状态获取。
- [ ] `WecomInboxProvider` 能将模拟收到的 `@bot` 文本/混合消息准确解析并触发 `dispatcher` 回调。
- [ ] 凭证错误或认证失败能准确映射为 `auth_failed` 状态并终止重试。
- [ ] `stop()` 执行后，相关网络连接与心跳完全释放，状态切为 `disabled`。

## Verification Plan

```bash
pnpm --filter @rover/runtime test packages/runtime/src/__tests__/wecom_provider.test.ts
```
