# ADR-0021: macOS 桌面 GUI 环境自适应解析与 Sidecar 路径容错降级

> 状态：已采纳 · 2026-10-09  
> 关联决策：[ADR-0019](./0019-agent-runtime-callbacks-and-decoupled-lifecycle.md)、[ADR-0020](./0020-modular-monolith-domain-refactoring-and-container.md)  
> 方案关联：[Rover 受控 Bash 工具设计方案](../architecture/Rover%20受控%20Bash%20工具设计方案.md)

---

## 背景与问题

Rover 作为常驻桌面的 AI 伴侣，由 Tauri（Rust 桌面框架）拉起 Node.js Sidecar（开发态为 `node dist/index.js`，生产态为 Node.js SEA 单二进制可执行文件）来承载 Agent 运行时。

随着 Rover 受控 Bash 工具及研发自动化能力引入，Agent 需要在本地执行 CLI 工具（如 `gh`、`glab`、`git`、`curl` 以及团队自研的 `codemons-cli` 等）。然而，在 macOS 桌面环境下运行的进程面临严重的**环境变量缺失**问题：

1. **Launch Services / launchd 启动陷阱**：
   - 用户在 macOS 的访达（Finder）、程序坞（Dock）或聚焦搜索（Spotlight）中双击启动 `Rover.app` 时，操作系统是由 `launchd` 拉起应用的；
   - `launchd` 不会加载任何用户终端配置（不会执行 `/etc/profile`、`~/.zprofile`、`~/.zshrc` 或 `~/.bash_profile`）；
   - 因此，**Tauri 主进程** 仅能继承系统最基础的骨架环境变量，`PATH` 通常仅为 `/usr/bin:/bin:/usr/sbin:/sbin`。
2. **Sidecar 子进程继承恶化**：
   - Tauri 在启动 Sidecar 进程时直接沿用主进程环境，导致 Node.js Sidecar 内的 `process.env.PATH` 同样缺少 `/opt/homebrew/bin`、`~/.cargo/bin`、nvm/Node 路径以及用户的局部 CLI 目录；
   - 用户在 Shell 中配置的身份凭据与 API Token（如 `GITHUB_TOKEN`、`GLAB_TOKEN`、`SSH_AUTH_SOCK`）亦全部丢失；
   - 导致 Agent 尝试调用 `gh` 或用户私有 CLI 时，直接遭遇 `command not found` 致命异常。
3. **启动握手阻塞风险（Sidecar [READY] 协议）**：
   - Tauri 与 Sidecar 之间通过标准输出的 `[READY]` 文本行执行生命周期握手；
   - 若直接在 Sidecar 启动入口以同步阻塞方式唤起用户登录 Shell 提取环境变量，一旦遇到臃肿的 `.zshrc`（如加载繁重的 oh-my-zsh 插件、Conda、或有等待输入的脚本），耗时可能长达数秒甚至死锁，造成 Tauri 误判 Sidecar 启动超时而直接退出。

---

## 考量方案对比

### 选项 1：直接引入 npm 社区库（如 `fix-path` / `shell-env`）
- **优点**：开源社区广泛使用，开箱即用。
- **缺点与风险**：
  1. **握手死锁风险**：`fix-path` 内部采用同步 `execFileSync`，无法精细化设置超时中断与软降级，容易在臃肿的 `.zshrc` 场景下导致 Sidecar 启动握手超时崩溃；
  2. **Node SEA 打包兼容性阻碍**：Sindre Sorhus 维护的现代版本（v4+）均为 Pure ESM 规范，而 Rover Release 管道（`scripts/build-sea.mjs`）使用 esbuild 将全量代码打包为 CommonJS 格式的单二进制可执行文件，Pure ESM 依赖打包进 CJS 容易引入动态导入解析异常与打包体积膨胀；
  3. **缺乏安全性清洗**：未对非交互式执行标志（如 `CI=1`、`TERM=dumb`）做统一强制覆盖，下游 CLI 仍可能尝试触发终端交互。

### 选项 2：自研轻量、零依赖的 `UserEnvResolver` 基础设施（采纳）
- **优点**：
  1. **零外部依赖与 100% SEA 兼容**：仅使用 Node.js 内置 `node:child_process`，完全契约原生适配 CommonJS 与 SEA 打包；
  2. **异步预热与解耦**：可在 Sidecar 成功打印 `[READY]` 后在后台异步预热提取，或者在 Bash 工具首次调用时懒加载，绝对不阻塞 Tauri 启动握手；
  3. **超时熔断与静态路径兜底**：设置严格的探测超时（如 2000ms），探测超时或抛错时自动触发 Fallback 机制，拼装常见的系统与包管理器路径；
  4. **全量关键变量提权 + 安全环境重写**：既能提取 `PATH`、`GITHUB_TOKEN`、`SSH_AUTH_SOCK`，又能强制重置 `CI=1`、`TERM=dumb` 杜绝终端挂起。

---

## 架构决策

在 `@rover/runtime` 的基础设施层落地自研环境解析器 `UserEnvResolver`（位于 `packages/runtime/src/infrastructure/env/resolver.ts`）。

### 1. 架构与决策流图

```mermaid
flowchart TD
  Init[Sidecar 启动 / 首调 Bash 工具] --> CacheCheck{已存在有效内存缓存?}
  CacheCheck -->|是| ReturnCached[返回已解析环境字典]
  CacheCheck -->|否| OSCheck{当前操作系统为 macOS / Darwin?}
  
  OSCheck -->|否| FallbackDirect[直接返回 process.env 基础副本]
  OSCheck -->|是| ShellDetect[获取用户默认 Shell: process.env.SHELL || /bin/zsh]
  
  ShellDetect --> SpawnProbe[以 -i -l -c 参数异步执行 env 命令\n设置 2000ms 严格超时]
  
  SpawnProbe --> ProbeResult{执行状态}
  
  ProbeResult -->|成功返回| ParseEnv[正则解析键值对提取真实 PATH 及凭据]
  ProbeResult -->|超时 / 异常报错| FallbackMerge[触发静态路径兜底 Fallback]
  
  FallbackMerge --> BuildFallbackPath["向 process.env.PATH 补齐常见路径:\n/opt/homebrew/bin\n/usr/local/bin\n$HOME/.local/bin\n$HOME/.cargo/bin\n$HOME/.nvm/..."]
  
  ParseEnv --> SecuritySanitize[安全清洗与标志覆盖:\n覆盖 CI=1, TERM=dumb, DEBIAN_FRONTEND=noninteractive]
  BuildFallbackPath --> SecuritySanitize
  
  SecuritySanitize --> CacheStore[存入进程内内存缓存 Map/Object]
  CacheStore --> SyncProcessEnv[安全更新当前进程 process.env.PATH]
  SyncProcessEnv --> Ready[返回最终环境表供子进程使用]
```

### 2. 核心机制规范

#### A. 登录式交互 Shell 探测机制
在 macOS 下通过系统 Shell 的 `-i`（Interactive）与 `-l`（Login）参数启动探测子进程：
```ts
const shell = process.env.SHELL || '/bin/zsh';
const command = 'echo "__ROVER_ENV_START__"; env; echo "__ROVER_ENV_END__"';
```
- `-l` 强制加载系统的 `/etc/profile`、`~/.zprofile` 以及 `~/.bash_profile`；
- `-i` 强制执行用户的 `~/.zshrc` / `~/.bashrc`，确保由用户配置的 Homebrew、nvm、cargo、环境变量及私有 CLI（如 `codemons-cli`）全部就绪；
- 探测输出通过边界哨兵（Sentinel Token）精确定位输出切片，杜绝因 `.zshrc` 中有 `echo` 欢迎语导致的干扰。

#### B. 静态兜底路径表（Fallback Paths）
当用户未配置特定 Shell、或探测因任何原因（超时、脚本错误、权限受限）失败时，系统**绝对不直接崩溃**，而是自动合成高频研发目录：
```ts
const DEFAULT_MAC_FALLBACK_PATHS = [
  '/opt/homebrew/bin',
  '/opt/homebrew/sbin',
  '/usr/local/bin',
  '/usr/bin',
  '/bin',
  '/usr/sbin',
  '/sbin',
  `${homeDir}/.local/bin`,
  `${homeDir}/.cargo/bin`,
];
```
去重后拼装回 `PATH`，确保最基础的 `brew`、`git`、`gh` 工具在降级时依然可被正确定位。

#### C. 安全隔离与非交互式环境覆盖
探测完成合并后，强制覆盖以下控制变量以防止子进程交互式死锁：
```ts
const sanitizedEnv = {
  ...probedEnv,
  CI: '1',
  TERM: 'dumb',
  DEBIAN_FRONTEND: 'noninteractive',
  PAGER: 'cat',
  GIT_PAGER: 'cat',
};
```

#### D. 单例缓存与更新策略
- **内存单例**：环境解析结果为进程生命周期单例，首次解析后驻留内存；
- **进程级同步**：将解析得到的最新 `PATH` 同步写回 `process.env.PATH`，使 Sidecar 本身后续调用 `which` 或其它同步探测逻辑时也能收益。

---

## 模块结构与受影响文件

```text
packages/runtime/src/
├── infrastructure/
│   └── env/
│       ├── + [New] resolver.ts                  # UserEnvResolver 实现
│       ├── + [New] index.ts                     # 统一公开门面
│       └── __tests__/
│           └── + [New] resolver.test.ts         # 单元测试（模拟 Shell 成功、超时降级与兜底验证）
```

---

## 收益与结果（Consequences）

- **无缝支持 macOS GUI**：用户无需专门在终端里通过命令行启动 Rover，直接在 Dock 双击即可完整识别本地 Homebrew 与私人 CLI；
- **100% 免疫死锁与握手超时**：严格的 2000ms 熔断与静态路径兜底，确保无论用户 `.zshrc` 多么繁重，Sidecar 均能毫秒级就绪；
- **零 npm 依赖与打包友好**：完全依靠 Node.js 标准库，彻底规避 Pure ESM 与 Node SEA CommonJS 打包之间的兼容摩擦。
