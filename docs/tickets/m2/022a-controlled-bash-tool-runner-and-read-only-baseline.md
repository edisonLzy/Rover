# 022a: 受控 Bash 工具执行沙箱与只读安全基线 (Controlled Bash Tool & SafeRunner Baseline)

**Status**: TODO  
**Blocked By**: None (Frontier)  
**Blocks**: 022b  

## Context & Goal

依据 [ADR-0021](../../adr/0021-gui-desktop-environment-resolution-and-sidecar-fallback.md) 与 [ADR-0022](../../adr/0022-controlled-bash-tool-and-unified-permission-guard.md)，启动受控 Bash 工具实施的第一阶段（Two Tickets 方案之 Ticket A）：
1. 落地 `UserEnvResolver`：在基础设施层解决 macOS 桌面 GUI 下缺失用户终端 PATH 与 Token 的问题，内置 2000ms 超时熔断与静态路径兜底；
2. 落地 `CommandClassifier`：内置 Tier 1 只读白名单（`git status/diff/log/branch`、`gh pr/issue/run view/list`、`glab mr/issue view/list`、`curl -I/-s`、`ls/cat/head/pwd`）与 Tier 3 绝对黑名单（`rm -rf /`、`sudo`），对管道符与复合命令实施严格安全检查；
3. 落地 `SafeRunner`：子进程非交互执行（`CI=1`, `TERM=dumb`）、30s 执行超时熔断、ANSI 终端转义清洗与 30KB 首尾防爆截断（Head/Tail Truncation）；
4. 装配 `bash` 工具至 `@rover/runtime` 的 `factory.ts`；阶段一针对 Tier 1 自动放行执行，Tier 3 硬阻断，Tier 2 默认安全拦截并友好提示。

---

## Affected Components & Directory Structure

```text
packages/runtime/src/
├── infrastructure/
│   └── env/
│       ├── + [New] resolver.ts                  # macOS 登录 Shell 环境变量探测、缓存与静态兜底
│       ├── + [New] index.ts                     # 环境解析基础设施公开导出门面
│       └── __tests__/
│           └── + [New] resolver.test.ts         # 环境变量解析测试 (探测成功/超时熔断/静态兜底)
├── modules/
│   └── agent/
│       └── runtime/
│           ├── tools/
│           │   ├── bash/
│           │   │   ├── + [New] classifier.ts    # 命令风险分类器 (Tier 1/2/3 判定与复合命令防御)
│           │   │   ├── + [New] runner.ts        # 子进程安全执行沙箱 (超时/截断/ANSI/环境变量注入)
│           │   │   ├── + [New] types.ts         # 执行参数与分类结果契约类型
│           │   │   └── + [New] index.ts         # createBashTool 契约与执行装配
│           │   ├── + [New] bash.ts              # 兼容导出门面
│           │   └── * [Modified] factory.ts      # 默认装配 bash 工具
└── __tests__/
    └── + [New] bash_tool.test.ts                # 端到端工具测试 (Tier 1 执行、Tier 3 阻断、截断防爆)
```

---

## Specification & Invariants

1. **环境解析器 (`UserEnvResolver`)**：
   - 位于 `infrastructure/env/resolver.ts`，单例缓存解析结果；
   - 在 macOS 下调用 `$SHELL -ilc 'env'` 提取真实变量，设置严格 2000ms 超时熔断；
   - 若超时或异常，自动合并 `DEFAULT_MAC_FALLBACK_PATHS`（`/opt/homebrew/bin` 等）并补齐 `process.env.PATH`；
   - 绝不引入任何外部 npm 依赖，100% 保持与 Node.js SEA（CommonJS）打包兼容。
2. **命令分类器 (`CommandClassifier`)**：
   - 位于 `modules/agent/runtime/tools/bash/classifier.ts`；
   - 严格阻断 `rm -rf /`、`sudo`、格式化硬盘等 Tier 3 黑名单；
   - 针对包含 `|`、`;`、`&&`、`||`、`>`、`>>`、`$()` 的复合命令，默认不予静默放行；
   - 仅对确定无副作用的只读命令放行为 Tier 1。
3. **安全执行沙箱 (`SafeRunner`)**：
   - 位于 `modules/agent/runtime/tools/bash/runner.ts`；
   - 使用 `child_process.spawn`，强制注入 `CI=1`、`TERM=dumb`、`PAGER=cat`、`DEBIAN_FRONTEND=noninteractive`；
   - 默认超时 30 秒，超时后向子进程组发送 `SIGTERM`，3 秒后升级为 `SIGKILL`；
   - 输出超限（> 30 KB 或 > 500 行）时，执行 Head/Tail 截断（保留前 250 行 + 后 100 行），完整日志写入临时文件；剥离 ANSI 颜色代码。
4. **工具装配与降级行为**：
   - 在 `factory.ts` 中注册 `createBashTool()`；
   - 阶段一针对 Tier 2 命令，返回明确的提示：`"Command requires interactive approval or contains mutations, currently blocked in read-only baseline."`。

---

## Acceptance Criteria

- [ ] `UserEnvResolver` 能够成功识别 macOS 本地 Homebrew 目录与 Token；在模拟 Shell 挂起超时场景下能降级至 Fallback 路径。
- [ ] Tier 1 只读命令（如 `git status`、`gh pr view`、`pwd`）正常执行并返回 stdout。
- [ ] Tier 3 黑名单命令（如 `sudo ls`、`rm -rf /`）被硬阻断并报错，不启动子进程。
- [ ] 输出超过 30KB 或 500 行时，结果被正确截断并附带提示，ANSI 彩色控制符被彻底清除。
- [ ] 长时间运行命令在超时后被安全终止，子进程不残留。

## Visual & Behavioral Demonstration (ASCII Mockups)

### 1. Tier 1 只读查询：静默执行与干净输出（无 ANSI 乱码）
```text
╭──────────────────────────────────────────────────╮
│ 🐕 Rover: 当前仓库处于分支 feat/2-controlled-bash-tool │
│   最新提交为 46bf631，工作区干净无未提交文件。   │
╰──────────────────────────────────────────────────╯
底层 Tool Call:
  -> bash({ command: "git status" })
  <- { stdout: "On branch feat/2-controlled-bash-tool\nnothing to commit, working tree clean", exitCode: 0 }
```

### 2. 输出上下文防爆截断（Head/Tail Truncation 效果）
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

### 3. Tier 3 破坏性命令：绝对黑名单硬阻断（零子进程启动）
```text
底层 Tool Call:
  -> bash({ command: "sudo rm -rf /var/log" })
  <- {
       isError: true,
       error: "CommandBlockedError: 'sudo rm -rf /var/log' matches Tier 3 forbidden blacklists. Escalation or destruction commands are strictly blocked.",
       details: { tier: "tier_3", blocked: true }
     }
```

### 4. Tier 2 变更命令：阶段一安全模式兜底拦截
```text
底层 Tool Call:
  -> bash({ command: "git push origin feat/test" })
  <- {
       isError: true,
       error: "PermissionRequiredError: Command 'git push origin feat/test' involves mutations (Tier 2). Interactive HITL approval will be enabled in Ticket 022b.",
       details: { tier: "tier_2", blocked: true }
     }
```

---

## Verification Plan

```bash
pnpm --filter @rover/runtime test packages/runtime/src/infrastructure/env/__tests__/resolver.test.ts
pnpm --filter @rover/runtime test packages/runtime/src/__tests__/bash_tool.test.ts
```
