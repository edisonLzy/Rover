# 本机 Loopback 通信使用 Rust 生成的高熵临时 Bearer 令牌

> 状态：已采纳 · 2026-09-27

Tauri Rust 宿主在启动 Node Runtime sidecar 时，在内存中动态生成一次性高熵令牌（Bearer Token），并通过私有子进程通道传递给 Node；React WebView 仅能通过受限 Tauri 命令从内存获取该令牌，后续所有 loopback HTTP（或 tRPC）请求及 WebSocket 握手均强制鉴权。

做出该决定的原因在于：
1. **杜绝本机恶意进程越权利用特权（Localhost 特权隔离）**：`127.0.0.1` 环回接口对同机所有进程开放，而 Node Runtime 具备派发 Code Agent 执行任意本地命令、读取本地数据与操作 Git 仓库的高级能力。无令牌保护会导致本机任何非受信脚本或木马均可越权操控 Rover。
2. **抵御浏览器跨站与侧信道探测（Drive-by Attacks）**：网页恶意脚本无法伪造或读取仅存于 WebView 进程内存中的自定义 `Authorization` 请求头，强令牌鉴权能直接拦截恶意站点的本地探测与未授权 WebSocket 连接尝试。
3. **即用即弃防端口复用与生命周期绑定**：令牌仅在内存中流转、不写入硬盘配置、不进入 localStorage，且每次随 Rust 启动或 Node 重启自动重置轮换，确保 Rust 宿主与 Node 进程之间建立严格的所有权握手验证，旧会话一旦终止立即作废。
