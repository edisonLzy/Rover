# 统一自增事件账本与双阶段缓冲重连机制

> 状态：已采纳 · 2026-09-28

Node Runtime 作为本地 SQLite 唯一写入者，在领域表更新的同时同事务写入递增的 `runtime_event` 账本；Tauri React 前端通过“HTTP 全量快照（`GET /v1/state`）+ WebSocket 携带游标断点续传（`/v1/events`）”完成状态同步。当客户端携带上次已消费的 `eventSeq` 握手时，服务端通过“先挂内存实时缓冲队列 $\rightarrow$ 再查库重放增量 $\rightarrow$ 冲刷缓冲”的双阶段机制平滑并轨，在游标超期或断档时由服务端通知降级重新拉取全量快照。

做出该决定的原因在于：
1. **消除 HTTP 快照与长连接握手之间的竞态缝隙（Snapshot-to-Stream Gap）**：客户端获取快照（HTTP）到建立长连接（WebSocket）存在数十至数百毫秒的物理网络/握手时差。若仅依赖纯内存广播或无序连接，此时间窗口内发生的状态变更（如任务完成、权限等待）将永久丢失。自增序列与双阶段缓冲从数学上保证在高并发写入下事件不重、不漏、严格保序。
2. **轻量断点续传杜绝全量刷新引发的 UI 闪烁与性能损耗**：对于笔记本短暂停顿唤醒、网络微抖动或窗口可见性切换（通常仅差 1~2 个事件），仅重放几百字节的增量事件即可使前端毫秒级无感复原；避免频繁调用开销巨大的 `GET /v1/state` 导致整个前端 React 状态树重载、折叠状态重置或输入焦点丢失。
3. **多窗口（Pet 与 Dashboard）强一致性投影**：桌面透明宠物与 Dashboard 独立窗口共享同一 Node Runtime 实例。单调递增的事件序列表为多个独立的 WebView 提供了共同的权威事实时钟，杜绝“宠物窗口看到已完成，Dashboard 看到仍在运行”的视图裂脑。

### 核心表结构规范（Ticket 001）

```sql
CREATE TABLE runtime_event (
  event_seq INTEGER PRIMARY KEY AUTOINCREMENT,
  event_type TEXT NOT NULL,
  payload TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX idx_runtime_event_seq ON runtime_event(event_seq);
```

### 必须请求全量快照（`GET /v1/state`）的边界条件
客户端仅在以下四种场景下**必须**请求全量快照，其余短暂网络中断均优先走 WebSocket 增量重放：
1. **冷启动与白纸加载**：应用首次启动、WebView 独立新窗口打开（如首次拉起 Dashboard）、或用户主动强制刷新页面（Cmd+R / F5），此时前端内存状态为零，必须以全量快照作为状态基准。
2. **游标断档与超期清理（Cursor Gap）**：前端携带的 `lastEventSeq` 早于服务端 `runtime_event` 表的滚动保留窗口（如离线数周），服务端下发 `resync_required` 控制帧，前端必须重新拉取快照。
3. **客户端检测到跳号（Sequence Gap）**：前端接收到的事件序号不满足连续自增（`incomingSeq > currentSeq + 1`），说明传输链路丢单，必须触发快照重同步。
4. **服务端背压缓冲溢出**：重连期间前端网络极度阻塞，导致服务端连接级暂存缓冲队列达到上限阈值被强制重置。

### 备选方案权衡（Considered Options）
* **仅依靠 WebSocket 内存广播，每次重连全量调用 `GET /v1/state`**：无法解决 HTTP 请求完成与 WS 建立之间的几百毫秒并发时差；且休眠唤醒时频繁全量替换导致 React 界面闪烁、开销高昂。
* **基于 Redis / MQTT 等专业消息中间件**：作为单用户轻量桌面应用，引入额外重量级守护进程或网络中间件严重违背资源占用与无依赖原则；SQLite 本地单写者事务是实现自增账本的最高效、可靠手段。
