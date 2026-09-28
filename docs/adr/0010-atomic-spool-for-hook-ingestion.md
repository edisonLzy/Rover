# Hook 事件与 Agent 回报采用基于文件系统的原子 Spool 解耦

> 状态：已采纳 · 2026-09-28

Code Agent CLI（如 Claude Code、Codex）的 Hook 事件捕获与显式进展回报（`report` 命令），采用独立原生轻量二进制 `rover-hook-helper` 配合基于文件系统的“原子 Spool”（Atomic Spool）目录暂存与解耦方案。Helper 将事件信封写入临时文件、刷盘（`sync_all`）后原子重命名为 `.json` 文件，Rover 运行时通过目录监听及启动恢复序列中的 Spool 扫描进行去重入库与状态重放。

做出该决定的原因在于：
1. **轻量无 Broker 依赖与亚毫秒极速退出（Zero-broker & Non-blocking）**：CLI Hook 执行对冷启动与延迟有着苛刻的要求（<5ms），绝不能阻断或卡顿用户的终端交互。若依赖网络 MQ、HTTP API 或本地 Socket（UDS / 命名管道），一旦 Rover 桌面主应用处于未启动、崩溃重启或主线程高负载状态，Hook 将面临连接失败、超时等待或挂起阻塞 CLI 的严重风险。文件 Spool 方案无需中心 Broker 进程存活，本地写入完成后立即退出。
2. **天然离线韧性与崩溃恢复（Offline Durability & Crash Replay）**：Rover 主应用生命周期与 Code Agent Session 完全解耦。即便用户在 Rover 完全退出时直接在终端与 Agent 交互，所有关键 Hook 事件与显式回报依然安全落盘暂存于 Spool；待 Rover 下次启动时，依照既定恢复序列（扫描 Spool $\rightarrow$ 幂等去重 $\rightarrow$ 入库消费）完整重放会话状态，杜绝关键事件丢失。
3. **利用 POSIX 原子重命名消除并发半写入（Lock-free Atomicity）**：直接向目标文件流式写入可能因进程崩溃、断电或消费端并发读取而产生破损残缺的数据（Partial / Torn Read），导致 JSON 解析崩溃。此处的 `rename` 绝不仅是语言层面的函数标识符，而是直通操作系统内核的原子系统调用（POSIX `rename(2)` / Windows `MoveFileEx`）。它在文件系统底层（如 APFS、ext4、NTFS）仅原子性地切换目录项元数据（Directory Entry / Inode 索引指针），不涉及实际数据拷贝，微秒级完成且在物理上不可分割。配合“先写临时文件 $\rightarrow$ 强制落盘（`sync_all`） $\rightarrow$ 同目录原子重命名为目标 `.json`”，对外部消费端而言文件在时序上只有“完全不存在”与“一出现即 100% 刷盘完整”两种状态，彻底消除了中间半写态，且无需引入脆弱的跨进程互斥文件锁。

### 备选方案权衡（Considered Options）
* **通过 HTTP / WebSocket 发送至 Rover Loopback 端口**：对 Rover 存活强依赖，未启动会丢事件，加入重试会拖慢 CLI 体验。
* **直接跨进程并发写入本地 SQLite 数据库**：多进程并发写入易引发 `database is locked` 锁争用；在 Helper 原生二进制中集成完整 SQLite 引擎会显著增加二进制体积并拉长冷启动时间。
