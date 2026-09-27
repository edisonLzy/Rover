# 远端 Inbox 消息经持久事件网关送达 Rover

> 状态：提议，待产品接入范围确认

远端服务与本机 Rover sidecar 之间使用服务端持久 outbox 和 Rover 主动发起的 HTTPS 拉取/确认协议；已配置发送方先向网关鉴权投递 Inbox 消息修订，Node Runtime 的本机 HTTP/WebSocket API 只绑定 `127.0.0.1`，不接受远端入站连接。告警只是 Inbox 消息的一个 `kind`。这样用户的 Mac 离线、睡眠或位于 NAT 后仍能恢复消息，也不会把本机客户端 API 当作公网 Webhook；代价是服务端必须交付可鉴权、可重放的事件网关，并维护设备配对和保留期。
