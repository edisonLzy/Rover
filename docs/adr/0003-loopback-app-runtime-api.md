# React 直连 Node Runtime 的本机 API

MVP 的 React WebView 直接通过 `127.0.0.1` 上的 HTTP API 与 WebSocket 事件流访问 Node Runtime；Tauri Rust 负责选择端口、启动和监督 sidecar、传递临时连接凭据及执行桌面系统能力。相比让 Rust 转发每个业务请求，这使 Runtime 的 API、流式事件和未来 Windows 客户端共用一套协议；代价是需要处理端口竞争、启动握手、仅绑定 loopback、每次启动轮换的鉴权令牌、CORS/Origin/CSP、重连与本机其他进程的访问尝试。Sidecar 的 stdio 仅用于启动就绪和少量后台系统事件，不承载常规业务 API。
