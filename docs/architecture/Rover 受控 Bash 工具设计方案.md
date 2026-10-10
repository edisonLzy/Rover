# Rover 伴侣 Agent 受控 Bash 工具设计方案

**状态**：讨论稿 / 方案设计  
**所属模块**：`@rover/runtime`（Agent 执行回路、受控工具链）  
**相关标准与工单**：[ADR-0019](../adr/0019-agent-runtime-callbacks-and-decoupled-lifecycle.md)、[Ticket 014d](../tickets/m2/014d-human-in-the-loop-permission-and-question.md)、[Rover MVP TRD](./Rover%20MVP%20TRD.md)

---

## 一、 背景与动因

### 1.1 现状与冲突
在 Rover MVP 最初的架构规范（TRD 第 162 条）中，为了规避系统破坏与命令逃逸风险，制定了严格的受控工具边界：*“Rover Agent 不得到任意 shell、通用文件写入或任意网络请求工具；代码修改交由 Code Agent 原 Session”*。

然而，随着 Rover 技能（Skill）体系向真实研发协同场景扩展，大量高频轻量任务对本地已配置的成熟 CLI 工具有强依赖：
- **代码审查与流转**：通过 `gh pr view`、`gh pr list`、`glab mr view` 查看 PR/MR 状态与评审意见；
- **DevOps 与发布检查**：通过 `gh run list` 查询 CI 工作流执行结果；
- **环境与接口健康探测**：通过 `curl -I` 探测本地/开发环境服务状态；
- **本地仓库感知**：通过 `git status`、`git branch`、`git log` 了解当前工作区状态。

若将这些秒级操作全部作为重度任务派发给外部 CLI（如启动一个 Claude Code 或 OpenCode 会话），会带来极高的进程开销、漫长的模型冷启动延迟以及割裂的交互体验。

### 1.2 目标定位：伴侣 Agent vs 编码 Agent
- **编码 Agent（Code Agent，如 Claude Code、OpenCode）**：拥有完整终端与文件读写权限，专注长程代码编写、大型重构与测试修复。
- **伴侣 Agent（Rover Agent）**：作为桌面的**协同调度者与辅助决策者**，其 Bash 执行是**轻量、瞬态、辅助决策与 DevOps 衔接**。

因此，演进方向并非无条件开放任意 Shell，而是构建一个**“环境自适应、只读静默 + 变更受控、上下文防爆”的受控 Bash 工具链**。

---

## 二、 核心技术挑战

1. **macOS GUI 环境变量丢失（LaunchAgent 陷阱）**：  
   Rover 是由 Tauri 桌面应用拉起的 Node.js Sidecar。在 macOS GUI 环境下启动的进程仅具备最基础的系统路径（如 `/usr/bin:/bin:/usr/sbin:/sbin`），用户在 `~/.zshrc` 或 `~/.bash_profile` 中配置的 Homebrew 路径（`/opt/homebrew/bin`）、版本管理路径（nvm、asdf）以及认证 Token（`GITHUB_TOKEN`、SSH Key 等）完全丢失，导致命令直接报 `command not found`。
2. **安全边界与权限控制**：  
   必须防范误操作与注入攻击（如模型意外执行 `rm -rf` 或写覆盖关键文件），同时支持具有外部影响的写操作（如合入 PR、提交 Issue）在用户可控的前提下安全执行。
3. **LLM 上下文防爆（Context Explosion）**：  
   CLI 命令（如 `gh api` 或 `curl`）若返回几百 KB 的冗长 JSON/HTML，会直接耗尽模型上下文预算；此外，终端彩色 ANSI 控制符会严重干扰模型的语义理解。
4. **交互式挂起防范（Hanging Prevention）**：  
   若 CLI 触发了交互式询问（如确认提示 `[y/N]` 或 Git 密码输入），在无标准输入的后台进程中会导致永久假死。

---

## 三、 架构设计与技术方案

整体架构分为 **环境解析层**、**命令审计分类层**、**执行与防爆治理层** 以及 **HITL 审批状态机**：

```mermaid
flowchart TD
  Agent[Agent 决策调用 bash] --> Classifier{命令风险分类器\nCommand Classifier}
  
  Classifier -->|Tier 1: 只读操作| Runner[防爆执行器 SafeRunner]
  Classifier -->|Tier 2: 变更/副作用| HITL[Ticket 014d: PermissionService]
  Classifier -->|Tier 3: 破坏性/系统级| Deny[直接阻断安全拦截]
  
  HITL -->|用户界面批准| Runner
  HITL -->|用户拒绝| Reject[返回权限拒绝给 Agent]
  
  Runner --> Env[注入 UserEnvResolver 环境变量]
  Env --> Spawn[子进程非交互执行\nCI=1 / 超时熔断]
  Spawn --> Guard[输出清洗与防爆截断\nStrip ANSI / Truncate]
  Guard --> Result[返回标准 AgentToolResult]
```

### 3.1 工具契约（Tool Schema）

定义于 `packages/runtime/src/modules/agent/runtime/tools/bash.ts`：

```ts
import { Type, type Static } from '@earendil-works/pi-ai';
import type { AgentTool } from '@earendil-works/pi-agent-core';

export const ExecBashParams = Type.Object({
  command: Type.String({
    description:
      'The bash/zsh command line to execute (e.g. "gh pr view 123", "curl -s ...", "git status"). Non-interactive commands only.',
  }),
  cwd: Type.Optional(
    Type.String({
      description: 'Absolute path to target working directory. Defaults to active workspace.',
    })
  ),
  timeoutMs: Type.Optional(
    Type.Integer({
      description: 'Execution timeout in milliseconds. Default 30000 (30s), max 120000 (2min).',
    })
  ),
});

export type ExecBashParamsType = Static<typeof ExecBashParams>;
```

### 3.2 用户登录 Shell 环境预热解析器 (`UserEnvResolver`)

在 Runtime 启动时预先探查并解析一次用户的完整 Shell 环境变量，并安全缓存：

- **探测原理**：执行 `$SHELL -ilc 'env'`（交互式登录 Shell 模式），提取加载了用户配置后的完整变量表；
- **保留与安全清洗**：
  - 核心保留：`PATH`、`HOME`、`USER`、`SHELL`、`SSH_AUTH_SOCK`、`GITHUB_TOKEN`、`GLAB_TOKEN` 等常用凭据与路径；
  - 覆盖安全标志：强制重置 `CI=1`、`TERM=dumb`、`DEBIAN_FRONTEND=noninteractive`。

### 3.3 命令分级与权限规则架构（分层配置体系）

借鉴 Claude Code 与工业界成熟实践，Rover 的命令安全检查**并非单纯在代码中写死**，而是采用**“内置开箱基线 + 运行期会话记忆 + 用户/项目持久化配置 + 全局安全模式”**的四层分层治理架构：

```mermaid
flowchart TD
  Cmd[待执行 Bash 命令] --> ModeCheck{是否开启无权限跳过模式?}
  ModeCheck -->|是| Exec[执行命令]
  ModeCheck -->|否| BlacklistCheck{命中 Tier 3 黑名单?}
  
  BlacklistCheck -->|是 (如 rm -rf /)| Deny[硬拦截并向模型报错]
  BlacklistCheck -->|否| SessionMem{命中本次会话记忆白名单?\nrememberApproval}
  
  SessionMem -->|是| Exec
  SessionMem -->|否| ConfigAllow{命中用户/项目配置白名单?\n~/.rover/permissions.json}
  
  ConfigAllow -->|是| Exec
  ConfigAllow -->|否| BuiltinTier1{命中内置 Tier 1 只读基线?}
  
  BuiltinTier1 -->|是| Exec
  BuiltinTier1 -->|否 (Tier 2 变更/未知)| HITL[挂起并触发 Ticket 014d\nPermissionService 审批]
  
  HITL -->|单次允许| Exec
  HITL -->|本次会话记住| Remember[写入内存 rememberApproval] --> Exec
  HITL -->|拒绝| Reject[向模型返回拒绝理由]
```

#### 1. 风险分级矩阵

| 分级 | 判定依据与典型命令 | 执行动作 |
| :--- | :--- | :--- |
| **Tier 1: 只读白名单** | 纯查询、无写副作用：<br>• `gh pr view`, `gh pr list`, `gh issue view`, `gh run list`<br>• `glab mr view`, `glab mr list`, `glab issue view`<br>• `git status`, `git log`, `git diff`, `git branch`<br>• `curl -I`, `curl -s`（无 `-X POST/PUT/DELETE`，无 `-d`）<br>• `ls`, `cat`, `head`, `which`, `pwd` | **静默自动放行**，直接执行。 |
| **Tier 2: 变更/副作用** | 具有外部状态写操作或代码修改：<br>• `gh pr merge`, `gh pr close`, `gh issue create`<br>• `glab mr merge`<br>• `git push`, `git checkout -b`, `git commit`<br>• `curl -X POST`, `curl -d ...` | **挂起当前协程**，触发 `onPermissionRequested`，桌面气泡/通知弹出审批卡片供用户单次或会话授权。 |
| **Tier 3: 绝对黑名单** | 破坏性或系统级命令：<br>• `rm -rf /` 或针对系统根目录的操作<br>• `sudo` 提权命令（桌面伴侣严禁提权）<br>• 破坏性磁盘/分区操作 | **硬阻断拦截**，不请求用户，直接向模型报错返回安全阻断说明。 |

#### 2. 四层规则决策流（Rule Hierarchy）

1. **第一层：内置开箱基线（Built-in Baseline）**：
   - 代码内置默认的 Tier 1 只读安全前缀表，保障用户在未配置任何规则时，最常用的查询类 Skill 即可无缝开箱运行。
2. **第二层：运行期会话记忆（Session Memory - Ticket 014d 联动）**：
   - 当遇到 Tier 2 变更命令被拦截时，前端气泡/通知卡片提供两组决算按钮：
     - `[仅允许本次]`：单次放行；
     - `[本次会话记住 (Remember Approval)]`：将该命令或其前缀（如 `gh pr *`）追加至内存 `Set<string>` 中，在当前 Rover 运行时或该轮任务中后续自动放行，避免高频打扰。
3. **第三层：用户与项目持久化配置（User & Project Config）**：
   - 支持从配置文件加载用户自定义规则（例如用户团队自研的 CLI 或定制测试脚本）：
     - **用户全局配置**：`~/.rover/permissions.json`；
     - **项目级配置**：工作区 `.rover/permissions.json`；
     - 配置契约示例：
       ```json
       {
         "autoApprove": [
           "pytest *",
           "go test *",
           "my-internal-cli status *",
           "curl https://api.mycompany.internal/*"
         ],
         "deny": [
           "git push --force *"
         ]
       }
       ```
4. **第四层：全局模式覆写（Execution Modes）**：
   - **默认交互模式（Interactive / Safe）**：严格遵循前述规则与 HITL 确认；
   - **全自动/无人值守模式（Bypass Mode）**：支持测试场景或后台全自动模式（对应类似 `--dangerously-skip-permissions` 的配置），此时除 Tier 3 黑名单外全量放行。

### 3.4 输出防爆与治理（Output Guard）

1. **防爆截断（Head/Tail Truncation）**：
   - 限制单次输出上限为 **30 KB 或 500 行**；
   - 超限时保留头部前 250 行与尾部 100 行，中间插入截断提示：
     ```text
     [... Rover Output Guard: 截断 3420 行 (480 KB)。完整日志已保存至 ~/.rover/tmp/bash_xyz.log ...]
     ```
2. **ANSI 彩色转义码清洗**：
   - 剥离 CLI 输出中包含的颜色转义序列（`\x1b[...m`）与终端光标重置码，防止大模型误读导致幻觉。
3. **超时熔断与进程树清理**：
   - 默认超时 30 秒；
   - 超时后先向子进程组发送 `SIGTERM`，宽限 3 秒后升级为 `SIGKILL`，杜绝孤儿/僵尸进程。

---

## 四、 影响组件与目录规划

按照 Tracer-Bullet Ticket 规范，在 `@rover/runtime` 中规划如下模块结构：

```text
packages/runtime/src/
├── infrastructure/
│   └── env/
│       ├── + [New] resolver.ts                  # macOS 登录 Shell 环境变量探测与缓存
│       └── __tests__/
│           └── + [New] resolver.test.ts
├── modules/
│   └── agent/
│       └── runtime/
│           └── tools/
│               ├── + [New] bash.ts              # ExecBash 工具实现、分类器与防爆执行器
│               └── * [Modified] factory.ts      # 默认装配 bash 工具
└── __tests__/
    └── + [New] bash_tool.test.ts                # 单元测试（分类判定、截断防爆、超时中断）
```

---

## 五、 实施路线与工单分解（Tracer-Bullet Tickets）

整体方案已收敛入 **[ADR-0021](../adr/0021-gui-desktop-environment-resolution-and-sidecar-fallback.md)** 与 **[ADR-0022](../adr/0022-controlled-bash-tool-and-unified-permission-guard.md)**，并分解为两条垂直工单：

1. **[Ticket 022a (阶段一：只读沙箱闭环)](../tickets/m2/022a-controlled-bash-tool-runner-and-read-only-baseline.md)**：
   - 实现零依赖 `UserEnvResolver` 解决 macOS GUI 环境变量丢失（带 2000ms 超时熔断与静态路径兜底）；
   - 实现 `SafeRunner`（非交互模式、30s 超时熔断、ANSI 清洗与 30KB 首尾防爆截断）；
   - 实现 `CommandClassifier`（Tier 1 只读白名单放行，Tier 3 黑名单阻断，复合命令防御）；
   - 默认装配 `bash` 工具至 `factory.ts`。
2. **[Ticket 022b (阶段二：统一门禁与气泡轻量审批)](../tickets/m2/022b-unified-permission-service-hitl-and-bubble-approval.md)**：
   - 移植 `divisor-agent` 的 `AbstractHumanInTheLoop` 状态机；
   - 落地 `WorkspaceAccessService`（地盘准入与长期授权，彻底脱敏工具名）；
   - 落地 `PermissionService`（动作风控、Tier 2 变更命令审批、死循环断路、运行期内存前缀放行 `rememberApproval`）；
   - 挂载 `beforeToolCall` 统一前门流水线，打通前端桌面气泡 `[允许]/[拒绝]` 二元操作卡片与 tRPC 路由。

---

## 六、 实际效果与交互表现（ASCII Mockups）

### 6.1 Tier 1 只读查询：静默放行与干净输出
```text
╭──────────────────────────────────────────────────╮
│ 🐕 Rover: 当前仓库处于分支 feat/2-controlled-bash-tool │
│   最新提交为 46bf631，工作区干净无未提交文件。   │
╰──────────────────────────────────────────────────╯
底层 Tool Call:
  -> bash({ command: "git status" })
  <- { stdout: "On branch feat/2-controlled-bash-tool\nnothing to commit, working tree clean", exitCode: 0 }
```

### 6.2 冗长输出：防爆截断保护（Head/Tail Truncation）
```text
底层 Tool Call:
  -> bash({ command: "curl -s https://example.com/massive_log.json" })
  <- {
       stdout: "[Line 1..250 output...]\n\n"
             + "[... Rover Output Guard: 截断 3420 行 (480 KB)。完整日志已保存至 ~/.rover/tmp/bash_8f2a.log ...]\n\n"
             + "[Line 3321..3420 tail output...]",
       exitCode: 0
     }
```

### 6.3 Tier 2 变更命令：宠物气泡轻量二元审批卡片
```text
╭────────────────────────────────────────────────────────╮
│ 🐕 Rover: 我需要执行以下命令来推进当前任务：           │
│                                                        │
│   ┌────────────────────────────────────────────────┐   │
│   │ $ gh pr merge 42 --squash                      │   │
│   └────────────────────────────────────────────────┘   │
│                                                        │
│   [ 允许 (Approve) ]              [ 拒绝 (Reject) ]    │
│   ☑ 本次运行期间记住该前缀 (Remember for current run)  │
╰────────────────────────────────────────────────────────╯
```

### 6.4 未授权目录：工作区访问准入卡片 (WorkspaceAccessService)
```text
╭────────────────────────────────────────────────────────╮
│ 🐕 Rover: 检测到命令涉及未授权的外部目录：             │
│                                                        │
│   📂 /Users/zhiyu/Projects/external-service            │
│                                                        │
│   [ 信任并加入工作区 ]            [ 仅本次允许 ]       │
│   [ 拒绝访问 ]                                         │
╰────────────────────────────────────────────────────────╯
```

### 6.5 Tier 3 破坏性命令：绝对黑名单硬阻断（零子进程启动）
```text
底层 Tool Call:
  -> bash({ command: "sudo rm -rf /var/log" })
  <- {
       isError: true,
       error: "CommandBlockedError: 'sudo rm -rf /var/log' matches Tier 3 forbidden blacklists. Escalation or destruction commands are strictly blocked.",
       details: { tier: "tier_3", blocked: true }
     }
```
