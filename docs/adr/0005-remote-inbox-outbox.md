# 远端 Inbox 消息经持久事件网关送达 Rover

> 状态：已采纳 · 2026-09-27

远端服务与本机 Rover sidecar 之间使用服务端持久 outbox 和 Rover 主动发起的 HTTPS 拉取/确认协议；已配置发送方先向网关鉴权投递 Inbox 消息修订，Node Runtime 的本机 HTTP/WebSocket API 只绑定 `127.0.0.1`，不接受远端入站连接。告警只是 Inbox 消息的一个 `kind`。这样用户的 Mac 离线、睡眠或位于 NAT 后仍能恢复消息，也不会把本机客户端 API 当作公网 Webhook；代价是服务端必须交付可鉴权、可重放的事件网关，并维护设备配对和保留期。

实施决策补充：
1. **告警轮次与合并**：基于 `sourceId + alertKey` 维护活动轮次。未恢复前状态更新仅自增 `revision` 更新同一消息，不重复提醒；收到 `resolved` 标记恢复；恢复后再次异常分配全新 `sourceMessageId` 开启新轮次。
2. **网关保留与断档**：服务端保留期固定为 30 天未 ACK 投递。Mac 长期离线导致 `cursor_gap` 时，客户端在 Dashboard Inbox 显式提示断档，并将游标对齐至网关最早可用位点继续消费，不静默丢弃。

