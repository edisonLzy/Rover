# Rover Inbox 投递协议 v1

> 状态：传输契约草案；Inbox 收录范围、离线保留期限待产品确认。
> 用途：Rover 与外部服务分别实现同一投递协议。Inbox 是 Rover 唯一的消息列表，监控告警是 `kind: "alert"` 的消息；新增消息类型沿用信封并为其 `payload` 增加类型约束。

投递 body 的机器可读约束见 [JSON Schema v1](./rover-inbox-delivery.v1.schema.json)。Schema 之外仍须检查原始 body 大小、RFC 3339 时间、URL 安全及消息修订的合法状态迁移。

## 1. 参与方与边界

- **发送方**：经配置的监控服务或适配器，产生稳定的来源消息 ID、每次变更的事件 ID 和递增修订号。它不直连用户 Mac 的本机 Runtime API。
- **事件网关**：网络可达的服务端，验证来源，持久保存投递、设备订阅、游标和 ACK。可由监控平台或独立服务实现，不在 Rover monorepo 中增加第三个包。
- **Rover Runtime**：主动拉取，将投递事件与本地 Inbox 消息写入 SQLite，再 ACK。未读消息使 Inbox 气泡常显；告警到达本身不调用模型或派发 Code Agent。

MVP 配对由网关管理界面生成 HTTPS base URL、`deviceId` 和一次性显示的设备读取令牌，用户在 Rover Dashboard 录入。Rust 将令牌存入 Rover 自己的 Keychain，Node Runtime 在请求时取用；网关只保存令牌哈希。发送方 HMAC 密钥仅在发送方与网关之间配置。首版不要求扫码或 OAuth 配对。

网关 `202` 只表示投递已持久提交，不表示 Rover 已提醒、处理或创建 Task。传输采用**至少一次送达**；重复 POST、拉取和 ACK 均由事件、消息及修订的唯一键消重。

## 2. Inbox 投递信封

```json
{
  "v": 1,
  "sourceId": "monitor-prod",
  "sourceEventId": "evt-20260926-001",
  "sourceMessageId": "issue-123-open-2",
  "revision": 1,
  "kind": "alert",
  "occurredAt": "2026-09-26T12:00:00Z",
  "title": "结算页错误率升高",
  "summary": "近 5 分钟超过阈值",
  "url": "https://monitor.example/issues/issue-123",
  "payload": {
    "status": "open",
    "severity": "critical",
    "entity": { "kind": "issue", "id": "issue-123", "episodeId": "open-2" },
    "projectRef": "checkout",
    "repoRef": "customer-web"
  }
}
```

`sourceId + sourceMessageId` 标识**同一条 Inbox 消息**，`sourceId + sourceEventId` 标识一次投递变更；同一消息的后续更新使用更大的 `revision` 和新的 `sourceEventId`，保持同一个 `sourceMessageId`。相同修订号且内容不同返回冲突；迟到的低修订仍可审计，但不能覆盖当前消息或再次弹气泡。Rover 自己生成本地 `inboxMessageId`，用户界面和本机 API 只使用这个 ID。网关生成不可由发送方指定的 `deliveryId`、设备内单调 `seq` 和 `receivedAt`。

`kind` 是消息类型。MVP 对 `alert` 解析 `payload.status`、`severity` 和 `entity`；其它符合信封 Schema 的类型可用标题/摘要保存为普通 Inbox 消息并气泡提醒，但标为“尚无处理流程”，未知 `payload` 不持久化、也不能交给 Rover Agent 执行。新增类型的处理流程和类型约束需版本化发布。告警同一异常轮次只对应一条消息；恢复以更高修订把 `status` 改为 `resolved`，之后该消息不得回到 `open`。再次异常使用新的 `sourceMessageId` 和 `episodeId`。

发送方或适配器须在首次产生消息时生成并持久保存稳定 ID 与修订号。整个原始 JSON body 不超过 64 KiB；信封不承载凭据、可执行指令或大型堆栈，标题、摘要和链接仅作为不可信数据展示。未知信封字段拒绝，类型专用内容限于 `payload`。`url` 只接受 HTTPS，不由 Rover 自动抓取。

## 3. HTTPS 接口

| 接口 | 请求 | 成功响应 | 失败响应 |
| --- | --- | --- | --- |
| `POST /v1/rover/inbox/deliveries` | 原始 JSON body；`X-Rover-Source`、`X-Rover-Timestamp`、`X-Rover-Key-Id`、`X-Rover-Signature` | 网关在 outbox 与目标设备投递记录提交后返回 `202 {deliveryId}`；同一来源事件 ID 和相同 body 重试返回原 ID | `400` 格式错误、`401/403` 来源无效、`409` 事件 ID 或消息修订冲突、`413` 超限、`429` 限流、`5xx` 可重试 |
| `GET /v1/rover/devices/{deviceId}/inbox/deliveries?after={seq}&limit=100&wait=20` | 设备 Bearer 令牌；从 Rover 本地已提交游标继续 | `200 {events:[{seq,deliveryId,receivedAt,body}], nextSeq, hasMore}`；无新事件可长轮询至 20 秒 | `401/403` 设备无效、`409 {code:"cursor_gap", earliestSeq}` 保留缺口、`429/5xx` 退避重试 |
| `POST /v1/rover/devices/{deviceId}/inbox/acks` | 设备 Bearer 令牌；`{throughSeq}` 为本地已连续提交的最大序号 | `200 {throughSeq}`；重复 ACK 幂等且不可倒退 | `400` 跳过未投递范围、`401/403`、`5xx` 可重试 |

来源签名是 `sha256=` 加 HMAC-SHA256 十六进制结果，签名输入为 `<Unix 秒时间戳>\n<原始请求 body 字节>`。网关按 `X-Rover-Key-Id` 找到 `X-Rover-Source` 的密钥，要求它与 body 的 `sourceId` 相同，常量时间比较签名，拒绝与当前时间相差超过五分钟的请求。来源密钥与设备读取令牌独立；设备只能获得其获准订阅的来源/项目投递。所有接口仅 HTTPS；CORS 不能代替鉴权。密钥轮换允许短暂双密钥窗口，吊销立即阻止后续投递和拉取。

## 4. 顺序、游标与恢复

网关为每个设备生成单调 `seq`。同一来源事件重试不重新分配序号。Rover 按 `seq` 顺序在一个 SQLite 事务内写入投递事件、Inbox 消息投影和最新连续游标，再发送 ACK；ACK 丢失后重收由唯一键消重。网关可清理已 ACK 投递；未确认投递的保留期限待产品确认。游标过期时必须返回 `cursor_gap` 并在 Rover Dashboard 显示缺口，不得静默跳到最新位置。

Rover 离线后的补收与提醒策略待产品确认。对告警消息，较高 `revision` 的 `resolved` 是该消息的终态；迟到的 `open` 修订不能重新打开它。外部消息到达不会进入 Rover Agent history 或自动调用模型。用户点击「交给 Rover 处理」后，Rover 才按本地 Inbox 消息 ID 读取证据并开始回合；原始 `payload` 始终是数据，不获得工具权限。Rover Runtime 的客户端 HTTP/WS API 只绑定 `127.0.0.1`，不接收远端入站投递。

## 5. 双方契约测试

Rover 仓库提供同一份 Schema 和 fixture，网关与 Runtime 各自在 CI 验证：新消息、同消息高修订、恢复、重复 POST、同修订不同内容、错误签名、过期时间戳、设备越权、离线积压、ACK 丢失、游标缺口、乱序修订、未知 `kind`、64 KiB 超限。Rover 验证同一消息不会因重复投递重复弹气泡；点击前没有模型调用或 Code Agent 派发，点击后仍须有原生 Session 才能产生 Task。
