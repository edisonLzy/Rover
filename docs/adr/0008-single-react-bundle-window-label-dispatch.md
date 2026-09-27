# 桌面双窗口采用单 React Bundle 与 Tauri Window Label 分发机制

> 状态：已采纳 · 2026-09-27

Rover 桌面端（透明悬浮宠物窗口与管理面板 Dashboard 窗口）采用同一个 React SPA 打包产物（单 Vite Bundle），在前端根组件中通过 Tauri 同步注入的 `getCurrentWindow().label` 进行顶层视图形态分发；两个窗口在 `tauri.conf.json` 中静态声明，Dashboard 默认隐藏并常驻，macOS 菜单栏唤出时秒级显示，关闭时仅隐藏。

做出该决定的原因在于：
1. **多进程物理隔离由操作系统保障，无需拆分多页面应用（MPA）**：在 macOS 下，Tauri 的每个窗口底层均为独立的 `WKWebView` 进程，拥有隔离的 JS 运行时与 DOM 上下文，互不影响主线程与内存。单 Bundle 模式彻底免去了维护多份 HTML 入口和重复打包公共依赖（React、Tailwind、tRPC/WS 客户端）的开销。
2. **窗口标签是宿主对齐的最简单一事实来源（SSOT）**：窗口的透明度、无边框、置顶等系统级物理属性本就由 Rust 严格绑定在 `label`（`main` 与 `dashboard`）上。Tauri 2 在 Webview 初始化时同步注入窗口元数据，React 无需引入额外的客户端路由库（如 React Router）即可在第一时间同步判定身份，且保持干净的 URL。
3. **静态常驻与隐藏关闭消除白屏冷启等待**：动态在前端 `new WebviewWindow` 会导致可见的初始化白屏与延迟。在配置文件中静态声明并在托盘点击时通过 Rust 调用 `show()` / `set_focus()`，配合关闭时 `hide()`，实现了极致流畅的瞬时响应体验。
