# Node Runtime Sidecar 双模调度架构与跨平台 CI/CD 自动化流水线

> 状态：已采纳 · 2026-09-27

Rover 桌面端由 **Tauri 2 / Rust 原生宿主壳**与 **Node.js Runtime 业务层（`@rover/runtime`）**构成双层架构。为兼顾开发阶段的敏捷调试与生产分发时的开箱即用，我们在 Sidecar 运行处理与 CI/CD 流水线上确立了如下核心架构决策：

---

## 决策内容

### 一、Node Runtime Sidecar 双模调度处理方案

针对 Sidecar 的生命周期管理与分发依赖，采用**“开发态源码调用、发布态单二进制内置”**的条件编译双模架构：

1. **开发模式（`debug_assertions` 生效）**：
   - **启动机制**：开发者执行 `pnpm dev` 时，Rust 端通过 `#[cfg(debug_assertions)]` 逻辑，直接通过 `app.shell().command("node")` 唤起本地 Node 解释器执行 `packages/runtime/dist/index.js`；
   - **敏捷性保障**：前端 Vite 保持热重载（HMR），修改 Runtime 代码后仅需重新启动前端，无需经历耗时的单二进制打包（SEA 注入）过程；
   - **配置解耦**：基础配置文件 `tauri.conf.json` 不声明 `bundle.externalBin`，避免本地缺少预编译二进制时阻断日常开发。

2. **生产发布模式（`not(debug_assertions)` 生效）**：
   - **Standalone 单二进制封装**：通过 `packages/runtime/scripts/build-sea.mjs`，利用 `esbuild` 预打包、Node.js 官方 `--experimental-sea-config` 生成 blob，并用 `postject` 将其注入当前系统的官方 Node 二进制，构建出独立的单文件可执行体 `packages/app/src-tauri/binaries/rover-runtime-${TARGET}`；
   - **目标三元组强校验（拒绝改名伪装）**：本地打包（`pnpm package:mac:arm64`、`pnpm package:mac:x64`、`pnpm package:win`）必须在 `rustc --print host-tuple` 与目标架构严格匹配的原生宿主机上执行。SEA 构建器若检测到目标三元组与当前 host-tuple 不一致，**直接抛错拒绝构建，严禁将当前宿主架构的二进制文件改名重标（Relabeling）为目标架构产物**；
   - **严格构建顺序与发布配置绑定**：打包命令显式采用“先构建 SEA 二进制，后执行 Tauri 打包”的时序，并指定 `tauri.release.conf.json`，配置 `bundle.externalBin: ["binaries/rover-runtime"]`，由 Tauri 自动将其打入安装包受保护目录（macOS `Contents/MacOS/`，Windows 安装根目录）；
   - **宿主进程调起**：Rust 端通过 `app.shell().sidecar("rover-runtime")` 直接启动内嵌的 Sidecar，**严禁且无需在终端用户电脑上搜索任何 Node.js 路径**，彻底根除 macOS (Launchd) 与 Windows (Explorer) 双击启动时丢失 `.zshrc`/`.bashrc` 环境变量导致的闪退问题。
   - **App 拥有内置 Skill 资源**：[ADR-0016](./0016-app-owned-builtin-skills.md) 将 Skill 源码放在 `packages/app/resources/skills/`，通过 Tauri resources 随包携带；Rust 在开发与发布时解析对应资源目录并传入 `--skills-dir`。SEA 自带 Node，产品 Skill 正文及附件由 App 交付，单独运行 Sidecar 时必须显式提供资源目录。

3. **版本同构与安全通信保障**：
   - **运行时版本严格锚定**：仓库根目录建立 `.node-version`（如 `22.13.1`），开发者本地与 GitHub Actions CI 严格基于该单一数据源锁定 Node 版本，并通过 `pnpm install --frozen-lockfile` 保证依赖确定性；
   - **内核原子端口分配**：无论开发态还是生产态，Rust 均向 Sidecar 传入 `--port=0`。Node 端 `http.Server.listen(0, '127.0.0.1')` 由操作系统内核原子挑选并分配空闲随机端口（Ephemeral Port），彻底杜绝静态端口冲突与检查-绑定间的 TOCTOU 竞争；
   - **高熵令牌与握手就绪通知**：Rust 生成一次性 `rover_<uuid>` 内存令牌随命令行传入，Node 成功绑定后向标准输出写入 `[READY] port=... host=127.0.0.1 token=...`，Rust 解析校验无误后方标记就绪，并通过 Tauri IPC `get_runtime_connection` 向 React 注入动态端口与鉴权头。

---

### 二、跨平台 CI/CD 自动化流水线（`.github/workflows/release.yml`）

流水线采用“分层质量前置阻断、全平台原生构建验证与去环境冒烟测试”的三阶段设计：

1. **第一阶段：前置轻量质量门禁（`check-and-test`，运行于 `macos-14`）**：
   - 并行执行 TypeScript 全量严格类型推导（`pnpm typecheck`）、Oxlint 零警告扫描（`pnpm lint:check`）、Oxfmt 格式规范核验（`pnpm format:check`）；
   - 执行前端与 Runtime 双向通信单元测试（`pnpm test`）；
   - 执行 Sidecar 编译与本地预检冒烟测试（`pnpm build:sea && pnpm smoke:sea`）；
   - 执行 Rust 后端单元测试（`cargo test`）。
2. **第二阶段：多平台原生矩阵构建与无环境验证（`build-desktop`）**：
   - **原生宿主矩阵**：`macOS-arm64`（`macos-14`）、`macOS-x64`（`macos-15-intel`）、`Windows-x64`（`windows-latest`），杜绝跨系统交叉编译造成的专有 SDK 缺失；
   - **无环境双重冒烟校验（剥离 Node）**：各 Runner 独立构建对应平台的 SEA 二进制与 Tauri 桌面包；在空 PATH、临时工作目录和独立数据库中运行 Sidecar，校验 `GET /api/v1/health`、Skill 列表及正文。打包前注入复制后的 App 资源树，打包后只能注入安装包内的资源树，并比较全部资源文件的相对路径和 SHA-256；
   - **产物归档**：macOS 采用 `--bundles app` 产出完整 `Rover.app` 并归档为 `.tar.gz` 保证 Unix 可执行权限；Windows 生成 NSIS `.exe` 与 `.msi` 双安装程序。
3. **第三阶段：自动化 Release 发布（`create-release`）**：
   - 当向仓库推送版本标签（`v*`）时自动激活；
   - 汇总全平台安装包，自动检测预发布标识（如 `v0.1.0-rc.1`）标记 Prerelease，并调用 GitHub API 创建 Release 草稿和发布日志；
   - 仅在所有平台构建和冒烟全部成功后才创建 Release 草稿。

---

### 三、macOS 签名、公证与安全分发边界

1. **本地测试与 CI 产物定位**：
   - CI 流水线默认在无发布凭据（Apple Developer ID 与证书）下完成构建，生成的安装包与归档产物专门用于全流程架构验证与自动化冒烟测试；
   - 未签名的 `.app` 在本地测试之外的外部 macOS 环境分发时，会触发 Gatekeeper 安全阻断（提示“已损坏”或“未知来源”）。
2. **正式分发强制签名与公证**：
   - 正式分发构建必须配置 Apple Developer ID 证书并在构建脚本中集成 `notarytool` 进行代码签名（Code Signing）与公证（Notarization）；在公证通过前，严禁将未签名安装包面向最终用户发布。

---

## 做出该决定的原因在于

1. **彻底解决“开发体验敏捷度”与“终端用户开箱即用”的根本矛盾**：如果开发环境也强制每次编译 140MB 的 SEA，会使开发调试极度缓慢；如果生产环境不打包 Node，又会导致小白用户或无全局 Node 的开发者无法启动。通过条件编译将开发态与打包态干净解耦，是最高效平衡的解法。
2. **消灭 GUI 桌面环境下的“PATH 环境变量丢失陷阱”**：用户从 Dock 或开始菜单启动 GUI 应用不会继承用户 shell 环境，大量桌面应用因“找不到宿主 node”产生客诉。生产包自带经过代码签名的 Native Sidecar，使应用成为真正的自包含绿色软件。
3. **冒烟测试剥离 PATH 严防假成功陷阱**：在 CI 机器上往往残留有安装步骤注入的全局 Node，若直接启动测试极易掩盖打包缺失。主动清理 PATH 并在打包前后双重验证 `GET /api/v1/health`，确保了每一个交付到 Release 的安装包都具备真实的离线可用性。
4. **禁止跨架构改名，维护构建权威性**：SEA 注入依赖宿主 Node 二进制的机器码结构，在 x86 宿主上生成的二进制重命名为 arm64 必定崩溃。通过 `rustc --print host-tuple` 强制校验，从机制上杜绝了人为或脚本失误引发的架构不兼容。
5. **明确代码签名与公证边界**：区分 CI 验证产物与最终用户交付产物，既不阻塞无证书下的持续集成验证，又为生产发布设定了清晰的安全合规门禁。

---

## 关联文档与实施参考

- 根目录依赖与工具链锁定：`.node-version`、`pnpm-workspace.yaml` 与 `turbo.json`
- 架构需求文档基线：[docs/architecture/Rover MVP TRD.md](../architecture/Rover%20MVP%20TRD.md)
