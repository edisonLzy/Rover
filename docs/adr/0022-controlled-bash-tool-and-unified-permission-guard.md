# ADR-0022: 受控 Bash 工具架构、安全执行沙箱与统一门禁守卫

> 状态：已采纳 · 2026-10-09  
> 关联决策：[ADR-0019](./0019-agent-runtime-callbacks-and-decoupled-lifecycle.md)、[ADR-0020](./0020-modular-monolith-domain-refactoring-and-container.md)、[ADR-0021](./0021-gui-desktop-environment-resolution-and-sidecar-fallback.md)  
> 需求关联：[Rover MVP TRD](../architecture/Rover%20MVP%20TRD.md)（第 162 条受控边界演进）、[Rover 受控 Bash 工具设计方案](../architecture/Rover%20受控%20Bash%20工具设计方案.md)

---

## 背景与问题

Rover MVP TRD 最初为规避越权与破坏性风险，规定伴侣 Agent 仅能通过派发独立 Session 执行重度编码任务。然而在日常协同中，大量高频轻量任务（如 `gh pr view`、`glab mr list`、`git status`、`curl -I` 探测服务、本地环境检查等）若全部拉起外部会话（如 Claude Code），会带来极高的进程冷启动开销与交互割裂。

为此，Rover 演进引入**受控 Bash 工具（Controlled Bash Tool）**。但在落地过程中，结合行业成熟 Harness（如 OpenCode 与 pi-coding-agent）的实战经验，面临四大核心架构与安全挑战：

1. **工作区逃逸与目录污染风险（Workspace Escape）**：
   - Rover 是常驻桌面伴侣，其主进程固定锚定在 `~/.rover/`（或 App Data 目录）。若允许 Bash 工具任意漫游，模型可能读写宿主敏感目录（如 `~/.ssh`、`/etc`）；
   - 必须设立明确的项目根目录边界（Project Root），越界访问（External Directory）需严格把关。
2. **命令注入与黑名单防御失效（Command Injection & Denylist Pitfall）**：
   - 依赖单纯的正则或黑名单（如禁止 `rm`）极易被 Shell 语法绕过（如 `bash -c "..."`、管道 `|`、逻辑连接符 `&&`、子 Shell `$()`）；
   - 必须采用**低熵白名单优先（Fail-Closed Allowlist）**与**分层分级（Tier 1 只读 / Tier 2 变更 / Tier 3 阻断）**治理。
3. **输出上下文爆炸与终端假死（Context Explosion & Terminal Hang）**：
   - 冗长输出（如 `curl` 大文件或几千行日志）会耗尽 LLM Token 预算；彩色 ANSI 转义符会干扰模型语义理解；交互式提示（如 `[y/N]`）会导致后台子进程死锁。
4. **门禁机制政出多门与架构割裂（Fragmented Interceptors）**：
   - 若针对工作区越界、死循环检测、高危审批分别构建独立的 Middleware，会导致挂起状态机重复、事件协议分裂，与 ADR-0019 规划的 `PermissionService` 发生冲突。

---

## 架构决策

借鉴 OpenCode 的规则引擎与越界检测、以及 pi-coding-agent 与 divisor-agent 的统一 Hook 拦截思想，做出以下核心架构决策：

```mermaid
flowchart TD
    LLM[Agent 决策调用 bash / 文件工具] --> BeforeHook[pi-agent-core / beforeToolCall 统一前置钩子]
    
    subgraph Gate1 [门禁 1: WorkspaceAccessService (地盘准入 / 路径访问控制)]
        BeforeHook --> Step1{工作区边界审查\nTarget Path 是否允许访问?}
        Step1 -->|未授权 / 逃逸外部目录| Req1[挂起并派发 workspace_access 审批]
        Step1 -->|已授权路径 / 无路径参数| Step2Gate
    end
    
    subgraph Gate2 [门禁 2: PermissionService (动作风控 / 运行期内存命令权限)]
        Step2Gate[通过地盘准入] --> Step2{命令风险 Tier 分级策略}
        Step2 -->|Tier 3: 绝对黑名单\nsudo / rm -rf /| Deny[硬拦截阻断并报错]
        Step2 -->|Tier 2: 变更 / 未知 CLI\ngit push / codemons-cli| Req2[挂起并派发 permission 审批]
        
        Step2 -->|Tier 1: 只读白名单\ngit status / gh pr view| Step3{死循环断路策略\nDoom Loop Policy}
        Step3 -->|连续 3 次相同调用| Req3[挂起并派发 doom_loop 警告解除]
        Step3 -->|正常通过| Pass[全票放行通过]
    end
    
    Req1 & Req2 & Req3 --> HITL[触发 onPermissionRequested 挂起协程\n桌面宠物气泡弹出极简卡片]
    
    HITL -->|气泡点击 [允许]| Pass
    HITL -->|气泡点击 [拒绝]| Reject[返回 { block: true, reason } 短路]
    
    Pass --> SafeRunner[SafeRunner 执行沙箱]
    SafeRunner --> Env[注入 ADR-0021 UserEnvResolver 环境变量\n重置 CI=1, TERM=dumb, PAGER=cat]
    Env --> Spawn[child_process.spawn 非交互执行\n30s 超时熔断 / SIGTERM->SIGKILL 进程树]
    Spawn --> Guard[输出防爆与清洗\n剥离 ANSI 码 / 30KB 首尾截断 Head-Tail]
    Guard --> Result[返回标准 AgentToolResult]
```

### 1. 架构正交：工作区准入与操作风控解耦为双独立服务（皆继承 AbstractHumanInTheLoop）
- **绝不针对工具名称硬编码特化**：彻底摒弃诸如 `toolName === 'dispatch_agent' ? 'full_access' : 'read_only'` 的坏味道。工作区准入是一个**纯粹的地盘准入二元判定**（该目录是否被用户授权允许 Rover 访问），对所有携带路径参数的工具一视同仁；
- **双服务各司其职，命名统一清晰**：
  1. **`WorkspaceAccessService`**（继承 `AbstractHumanInTheLoop`）：专注**“地盘准入与访问控制（Resource / Where）”**。负责规范化路径越界检测（`path.resolve`）、受信任工作区表维护与长期持久化授权（SQLite/JSON 配置）。
  2. **`PermissionService`**（继承 `AbstractHumanInTheLoop`，保留经典命名，对齐 ADR-0019 与 Ticket 014d）：专注**“操作行为（Action / What）”**。负责工具执行权限、命令 Tier 1/2/3 判定、死循环熔断、运行期内存前缀记忆（`rememberApproval`，即本次应用运行期间常驻内存放行，进程重启后重置）。
- **统一生命周期管理**：两者均由 `AgentRuntime` 持有并在 `beforeToolCall` 中组成前后流水线，且在 `abortPrompt` 时统一执行 `cancelAll()`，杜绝幽灵挂起。
- **工具代码纯粹性**：`bash` 工具自身不承担任何 UI 弹窗与权限协商逻辑，仅专注安全子进程执行。

### 2. 命令风险三级划分（Tier 1 / 2 / 3）
| 分级 | 判定特征与典型命令 | 执行动作 |
| :--- | :--- | :--- |
| **Tier 1 (只读白名单)** | 纯信息查询、零状态副作用：<br>• `gh pr/issue/run view/list`<br>• `glab mr/issue view/list`<br>• `git status/log/diff/branch`<br>• `curl -I`, `curl -s` (无 `-X POST/PUT/DELETE`, 无 `-d`)<br>• `ls`, `cat`, `head`, `which`, `pwd` | **静默自动放行**，直接执行不弹窗打扰。 |
| **Tier 2 (变更与未知命令)** | 具有状态写操作或外部系统副作用；以及所有未在白名单声明的自研/第三方 CLI（如 `codemons-cli`）：<br>• `gh pr merge`, `git push`, `git commit`<br>• 未知命令（如 `codemons-cli status`） | **挂起当前协程**，触发桌面气泡轻量审批；支持运行期内存前缀放行记忆（`rememberApproval`）及 `.rover/permissions.json` 规则持久化配置。 |
| **Tier 3 (绝对黑名单)** | 破坏性或系统级越权命令：<br>• `rm -rf /` 或系统根目录破坏<br>• `sudo` 提权操作<br>• 磁盘格式化/分区命令 | **硬阻断拦截**，直接向模型返回安全策略拒绝，不提供确认选项。 |

### 3. 工作区越界防御（Workspace Guard）
- **路径解析与越界判定**：命令中涉及的 `cwd` 或文件路径通过 `path.resolve(projectRoot, targetPath)` 解析为标准绝对路径；
- **受信工作区机制**：默认仅信任当前配置的受管工作区目录；一旦检测到跳出项目根目录的越界行为，强制提升至 Tier 2 触发气泡审批（`workspace_access`），用户可选择“仅本次访问”或“加入受信目录”。

### 4. 死循环断路器（Doom Loop Guard）
- **判定规则**：当同一个回合或短期交互中，检测到模型以完全相同的参数连续第 3 次调用同名工具；
- **响应动作**：自动熔断并触发 `doom_loop` 确认，防止模型陷入无效自旋浪费 Token 与资源。

### 5. 防爆安全执行沙箱 (`SafeRunner`)
- **环境自适应注入**：集成 [ADR-0021](./0021-gui-desktop-environment-resolution-and-sidecar-fallback.md) 的 `UserEnvResolver`，确保在 macOS GUI 下完整继承 Homebrew 与凭据；
- **非交互式强制标志**：强制设置 `CI=1`、`TERM=dumb`、`DEBIAN_FRONTEND=noninteractive`、`PAGER=cat`、`GIT_PAGER=cat`；
- **输出截断（Head/Tail Truncation）**：单次输出上限为 **30 KB 或 500 行**；超限时保留头部 250 行与尾部 100 行，中间插入截断提示并落盘至 `~/.rover/tmp/`；
- **ANSI 清洗**：剥离终端彩色控制符（`\x1b[...m`）；
- **超时与进程树熔断**：默认超时 30 秒；超时后先向进程组发送 `SIGTERM`，宽限 3 秒后升级为 `SIGKILL`，杜绝僵尸进程。

### 6. 宠物气泡轻量 HITL 契约（极简双态）
- 受限于桌面宠物气泡的紧凑尺寸，前端仅渲染单行操作条：展示待执行命令，辅以极简的 `[允许]` 与 `[拒绝]` 两个紧凑按钮；
- 决算协议保持纯粹布尔值（`{ approved: boolean }`），彻底对齐 `divisor-agent` 的 `AbstractHumanInTheLoop` 契约。

---

## 推进路线：Two-Tickets 切片规范

按照 Matt Pocock 的 Tracer-Bullet Tickets 规范，将整体工程实施拆解为两条垂直切片：

1. **Ticket 022a：受控 Bash 工具执行沙箱与只读安全基线 (Controlled Bash Tool & SafeRunner Baseline)**
   - 目标：交付零外部依赖的 `UserEnvResolver`、`SafeRunner` 与 `bash` 工具，实现 Tier 1 只读命令的静默放行、非交互执行、输出防爆截断与超时熔断；Tier 2 默认提示安全拦截。
2. **Ticket 022b：统一 PermissionService 门禁与宠物气泡轻量审批 (Unified PermissionService & Bubble HITL)**
   - 目标：交付对齐 `divisor-agent` 的 `AbstractHumanInTheLoop` 与 `PermissionService`，串联工作区边界、Tier 2 变更命令及死循环策略；打通前端气泡 `[允许]/[拒绝]` 双态审批与运行期内存记忆。

---

## 收益与结果

- **安全底线牢固**：白名单优先 + 绝对黑名单硬阻断 + 路径越界检测，彻底封死命令注入与逃逸；
- **体验极简丝滑**：常用只读命令零弹窗干扰；高危操作在气泡内一键允许/拒绝；未知自研 CLI（如 `codemons-cli`）不阻断且支持运行期内存放行；
- **架构高度正交**：统一由 `PermissionService` 集中把关，工具自身干净纯粹，完全兼容 Release Node SEA 打包。
