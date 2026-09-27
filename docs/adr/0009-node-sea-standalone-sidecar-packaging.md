# ADR-0009: Node.js 官方 SEA (Single Executable Application) 单二进制 Sidecar 打包

- **状态**: Accepted
- **日期**: 2026-09-27
- **决策人**: Core Architecture Team / Rover Core

## 背景与问题

Rover 采用双层架构：
1. **Desktop Shell 层**：Tauri 2 + Rust，负责系统托盘、多窗口管理及原生系统接入。
2. **Runtime 业务层**：Node.js + TypeScript (`@rover/runtime`)，承载 tRPC 服务、WebSocket 传输、AI Agent 会话及工具调度。

在桌面应用对外分发时，面临如下关键挑战：
1. **终端环境依赖问题**：终端用户电脑上不一定安装了 Node.js，或者安装的版本不符合要求（要求 `>= 22.0.0`）。
2. **GUI 环境变量丢失陷阱**：在 macOS (Launchd) 和 Windows (Explorer) 下双击启动 GUI 应用时，不会加载用户的 `.zshrc` / `.bashrc`，导致常规环境变量（如 nvm, fnm, asdf 配置的 Node 路径）无法被桌面应用识别。
3. **开发与生产一致性 (Dev/Prod Parity)**：如果开发态使用 Node.js，而打包态使用异构运行时（如 Bun JSC 引擎），会造成底层 JS 引擎和事件循环的分裂，埋下线上难以复现的隐患。

## 决策内容

我们决定在当前阶段（Milestone M0 收尾与正式构建流）全面采用 **Node.js 官方原生 SEA (Single Executable Applications)** 架构：

### 1. 双模设计（Dev / Production Parity）
- **本地开发态 (`pnpm dev`)**：
  - 由本地宿主的 Node.js 22 直接运行 `packages/runtime/src/index.ts` 源码。
  - 支持即时热重载（HMR）、源码断点调试与极速迭代。
- **生产打包态 (`pnpm build:sea` & `tauri build`)**：
  - 通过 `esbuild` 将 `@rover/runtime` 打包为单一 CommonJS 文件 (`dist/bundle.cjs`)。
  - 利用 Node.js 22 内置的 `--experimental-sea-config` 生成注入 Blob (`sea-prep.blob`)。
  - 利用 `postject` 将 Blob 注入到对应平台的官方 Node.js 可执行文件中，并完成 Mach-O / PE 格式签名。
  - 输出到 `packages/app/src-tauri/binaries/rover-runtime-${targetTriple}`。

### 2. Tauri Bundle 配置
在 `tauri.conf.json` 中注册 `bundle.externalBin: ["binaries/rover-runtime"]`。Tauri 打包时会自动将对应架构的单二进制复制至安装包中（macOS `Contents/MacOS/rover-runtime`，Windows 根目录 `rover-runtime.exe`）。

### 3. Rust Sidecar 进程优先判定
在 `packages/app/src-tauri/src/sidecar.rs` 中：
- **优先**检测应用执行目录是否存在打包好的独立 `rover-runtime` 二进制；若存在，则直接以子进程方式调起，**完全不依赖用户机器的 Node.js 环境**。
- **回退**：若独立二进制不存在（开发环境），则自动回退至宿主系统的 Node 探测器 (`resolve_node_binary`) 执行源码。

## 效果与影响

1. **零外部环境依赖**：生成真正的 Standalone 安装包（`.app` / `.exe`），普通用户无需安装任何前置环境，开箱即用。
2. **同构安全**：开发与生产均运行在标准 Node.js 22 V8 运行时中，100% 消除引擎异构风险。
3. **体积与压缩**：
   - 未压缩 Node SEA 二进制约为 138MB。
   - 经 Tauri 与系统级压缩（DMG / NSIS / `.tar.gz`）后，**最终下载安装包仅约 45MB**，依然远小于同类 Electron 应用（120MB+）。
4. **CI/CD 自动化**：
   - GitHub Actions 矩阵（`macos-14`, `macos-13`, `windows-latest`）分别使用平台原生 Node 22 执行 `pnpm build:sea`，实现全平台原生构建，无需复杂的外部交叉编译。
