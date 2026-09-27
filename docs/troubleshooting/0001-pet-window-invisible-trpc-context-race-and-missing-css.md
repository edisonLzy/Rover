# 0001: 宠物窗口启动不可见（透明窗口叠加 tRPC Provider 首帧竞态崩溃与 CSS 遗漏）

> 日期：2026-09-27 · 里程碑：M0-5 · 涉及模块：`packages/app`（Tauri 2 / React 19 / tRPC / Tailwind CSS 4）

---

## 1. 现象描述 (Symptom)
- 执行 `pnpm dev` 启动桌面端后，macOS 系统状态栏（Menu Bar）正常显示了 Rover 图标，右键菜单包含「打开 Dashboard」「恢复宠物窗口」等项目；
- 点击「打开 Dashboard」，能够正常弹出管理窗口，各项 HTTP/WS 探针正常工作，但**页面无任何 Tailwind 样式**，呈现纯白背景与原生 Times New Roman 黑字；
- 无论如何操作，**透明悬浮宠物窗口完全没有出现在桌面上**，屏幕上无任何可视反应。

---

## 2. 根本原因深度分析 (Root Cause Analysis)

### 根因 1：tRPC React Context 首次渲染的时序竞态崩溃（导致白屏）
- **时序矛盾**：
  - 在 `packages/app/src/context/RuntimeContext.tsx` 中，连接信息 `connection` 是通过异步 IPC `invoke('get_runtime_connection')` 向 Rust 请求的，存在数毫秒的异步等待时间；
  - `RuntimeProvider` 采用了条件渲染：
    ```tsx
    // 错误写法：connection 为空时直接裸渲染 children
    return (
      <RuntimeContext.Provider value={contextValue}>
        {connection && trpcClient ? (
          <trpc.Provider client={trpcClient} queryClient={queryClient}>
            <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
          </trpc.Provider>
        ) : (
          children
        )}
      </RuntimeContext.Provider>
    );
    ```
  - `PetWindow` 作为开机即展示的顶层组件，在组件顶层调用了 Hook：
    ```tsx
    const healthQuery = trpc.health.useQuery(undefined, { enabled: !!connection });
    ```
  - 虽然配置了 `enabled: !!connection`，但这是 React Hook，**组件每次渲染时 Hook 函数内部逻辑都会被无条件执行**；
  - Hook 执行时调用 `useContext(TRPCContext)`，发现上层没有任何 `<trpc.Provider>`，瞬间抛出致命错误：
    > `Error: Could not find tRPC Context. Did you forget to wrap your component with trpc.Provider?`
  - 由于没有 ErrorBoundary 兜底，React 渲染树在第 1 帧彻底崩溃并卸载所有 DOM。

### 根因 2：透明无装饰窗口导致的“视觉隐形”
- 宠物窗口在 `tauri.conf.json` 中配置了：
  - `"transparent": true`（背景完全透明）
  - `"decorations": false`（无系统标题栏和边框）
  - `"shadow": false`（无外发光投影）
- 正常情况下，React 会渲染一个带深色背景和阴影的悬浮卡片（`bg-zinc-900 border border-zinc-700/80 shadow-2xl`）；
- 但一旦 React 崩溃导致 DOM 树为空，整个 Webview 内容就是 0 像素的纯空白；再加上窗口没有边框、没有阴影、没有背景，**在屏幕上就演变成了物理意义上的 100% 透明隐形**，造成“窗口没启动”的错觉。

### 根因 3：`main.tsx` 遗漏 CSS 引入（导致 Dashboard 样式丢失）
- `packages/app/src/main.tsx` 中仅渲染了 `<App />`，遗漏了 `import './App.css'`；
- 这导致 `@import 'tailwindcss';` 完全没有被 Vite 作为样式依赖打包，因此生产与开发产物均丢失了全套 Tailwind 类名与暗黑主题。

### 根因 4：Dashboard 为何此前能打开？
- Dashboard 窗口在 `tauri.conf.json` 中默认为 `"visible": false`；
- 用户在菜单栏点击「打开 Dashboard」时，距离应用启动已经过去数秒，此时异步的 `invoke('get_runtime_connection')` 早已返回并更新了 `connection`；
- 因此 Dashboard 挂载时已经有了 `<trpc.Provider>`，侥幸避开了第 1 帧的竞态崩溃。

---

## 3. 解决方案 (Resolution)

### (1) Provider 保证顶层无条件挂载
修改 `packages/app/src/context/RuntimeContext.tsx`，无论 `connection` 是否已经就绪，`trpcClient`、`<trpc.Provider>` 和 `<QueryClientProvider>` **始终挂载在最外层**：
```tsx
const trpcClient = useMemo(() => {
  const url = connection ? `${connection.http_url}/trpc` : 'http://127.0.0.1:0/trpc';
  const token = connection ? connection.token : '';

  return trpc.createClient({
    links: [
      httpBatchLink({
        url,
        headers: () => (token ? { Authorization: `Bearer ${token}` } : {}),
      }),
    ],
  });
}, [connection]);

return (
  <RuntimeContext.Provider value={contextValue}>
    <trpc.Provider client={trpcClient} queryClient={queryClient}>
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    </trpc.Provider>
  </RuntimeContext.Provider>
);
```
当 `connection` 为空时，`enabled: !!connection` 阻止发起请求，但 Context 始终存在，杜绝 Hook 找不到 Context 的崩溃。

### (2) 导入全局样式
在 `packages/app/src/main.tsx` 中显式导入 `import './App.css'`，使 Tailwind CSS 4 正确打包。

### (3) 窗口属性与唤起健壮性
- 在 `tauri.conf.json` 中为 `main` 窗口增加 `"center": true`，保证窗口初次打开居中可见；
- 在 Rust 端的 `show_window` 与托盘「恢复宠物窗口」事件中增加 `window.unminimize()`，防止窗口被系统最小化后无法响应呼出。

### (4) 目录结构特性化划分 (Feature-Sliced)
彻底移除临时目录 `packages/app/src/windows`，重构为标准特性目录：
- `packages/app/src/features/pet/`：悬浮宠物卡片、拖拽手柄、状态指示；
- `packages/app/src/features/dashboard/`：管理控制台、指标探针、事件流。

---

## 4. 经验教训与防范规约 (Learnings & Guardrails)

1. **透明无边框窗口必须警惕“静默隐形”**：
   - 桌面透明无边框应用（Frameless Transparent Webview）在开发调试期间，任何顶层 JS 异常都会导致界面 100% 隐形。在后续演进中应引入 React ErrorBoundary，并提供统一的本地调试降级日志。
2. **所有 React Hook 的 Provider 必须无条件顶层常驻**：
   - 绝不在顶层 Provider 中使用“拿到网络数据才挂载 Provider”的条件渲染。Provider 必须尽早挂载，数据拉取和等待应交由子组件内部的 `isPending` / `enabled` 控制。
3. **入口文件的样式必须进行打包产物校验**：
   - 每次引入或重构样式体系时，必须检查 `pnpm build` 输出的静态资源列表中是否存在生成的 `.css` 产物。
