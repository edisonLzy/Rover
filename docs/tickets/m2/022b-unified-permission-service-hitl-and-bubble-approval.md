# 022b: 统一 PermissionService 门禁与宠物气泡轻量审批 (Unified PermissionService & Bubble HITL)

**Status**: DONE  
**Blocked By**: 022a  
**Blocks**: None  

## Context & Goal

依据 [ADR-0019](../../adr/0019-agent-runtime-callbacks-and-decoupled-lifecycle.md)、[ADR-0022](../../adr/0022-controlled-bash-tool-and-unified-permission-guard.md)，吸收 `divisor-agent` 经过实战检验的 HITL 抽象，启动受控 Bash 工具实施的第二阶段（Two Tickets 方案之 Ticket B）：
1. 落地 `AbstractHumanInTheLoop` 抽象基类，基于 Promise 内存维护挂起请求映射，支持全局唯一 `requestId`、唤醒决算与 `cancelAll` 中断清理；
2. 落地统一门禁 `PermissionService`，在 `AgentRuntime` 的 `beforeToolCall` 统一介入执行三级策略（工作区边界策略、命令 Tier 分级策略、死循环断路策略）；
3. 针对 Tier 2 变更命令及未知自研 CLI（如 `codemons-cli`）触发 Promise 挂起，派发 `onPermissionRequested` 回调；
4. 支持运行期内存前缀放行（`rememberApproval`，应用运行期间常驻内存）及 `.rover/permissions.json` 规则加载；
5. 提供 tRPC 路由（`permissions.resolve`），支持前端桌面宠物气泡以极简 `[允许] / [拒绝]` 二元操作一键决算并唤醒执行。

---

## Affected Components & Directory Structure

```text
packages/runtime/src/
├── modules/
│   └── agent/
│       ├── hitl/
│       │   ├── + [New] abstractHitl.ts              # AbstractHumanInTheLoop Promise 挂起状态机基类
│       │   ├── + [New] workspaceAccessService.ts    # WorkspaceAccessService (地盘准入/越界检查/长期访问控制)
│       │   ├── + [New] permissionService.ts         # PermissionService (动作风控/Tier 策略/死循环策略/运行期内存放行)
│       │   ├── + [New] types.ts                      # HITL 请求与决算载荷契约定义
│       │   └── + [New] index.ts                      # HITL 模块公共导出
│       └── runtime/
│           ├── * [Modified] runtime.ts               # AgentRuntime 集成 beforeToolCall 双门禁流水线与 cancelAll 联动
│           └── * [Modified] factory.ts               # 组装注入 WorkspaceAccessService 与 PermissionService 单例
├── transport/
│   └── trpc/
│       └── routers/
│           └── + [New] permissions.ts                # tRPC 权限决算路由 (permissions.resolve)
└── __tests__/
    └── + [New] hitl_permission.test.ts               # HITL 审批、工作区越界拦截、运行期内存放行与 abort 取消测试
```

---

## Specification & Invariants

1. **HITL 状态机抽象 (`AbstractHumanInTheLoop`)**：
   - 位于 `modules/agent/hitl/abstractHitl.ts`，基于 Promise 维护 `pendingRequests = new Map<string, PendingRequest>()`；
   - `request(payload)`：生成 `requestId`，返回挂起的 Promise，并触发事件派发；
   - `resolve(requestId, result)`：提取挂起项并返回值恢复协程；
   - `cancelAll(reason)`：回合中断（`abortPrompt`）时批量 Reject 所有挂起项，彻底防止幽灵挂起与死锁。
2. **地盘准入与访问控制服务 (`WorkspaceAccessService`)**：
   - 继承 `AbstractHumanInTheLoop<'workspace_access', WorkspacePayload, WorkspaceResolution>`；
   - 彻底解耦工具名称：无任何针对 `dispatch_agent` 的特化；对所有携带 `cwd` 或 `filePath` 的工具一视同仁；
   - 校验目标路径是否落在已授权工作区白名单中；未授权则触发 `kind: 'workspace_access'` 审批；
   - 用户授权并勾选“记住此目录”后，持久化写入受信任工作区表。
3. **动作风控门禁 (`PermissionService`)**：
   - 继承 `AbstractHumanInTheLoop<'permission' | 'doom_loop', ...>`，保留经典命名；
   - 负责操作层面把关：
     - **命令风险与 Tier 2**：若命中 Tier 2（写操作或未知 CLI 如 `codemons-cli`），且未被运行期内存放行（`rememberApproval`）或配置文件放行，触发 `kind: 'permission'` 审批；
     - **死循环断路**：若同一回合内相同参数连续调用 3 次，触发 `kind: 'doom_loop'` 审批；
   - 审批决算支持 `remember`，自动将命令前缀存入当前进程内存 `Set`。
4. **气泡极简交互与 tRPC 决算契约**：
   - 气泡 UI 仅接收 `requestId`、命令文本及审批类型，提供 `[允许]` 与 `[拒绝]` 两个轻量按钮；
   - tRPC 路由暴露 `permissions.resolve({ requestId, approved: boolean, remember?: boolean })`；
   - 批准后唤醒工具继续执行，拒绝后向 Agent 回传短路提示，不执行底层工具。

---

## Acceptance Criteria

- [x] 调用 Tier 2 变更命令（如 `git push`）或未知命令（如 `codemons-cli status`）时，Agent 执行协程自动挂起，Callbacks 派发 `onPermissionRequested`。
- [x] 外部调用 `permissions.resolve(requestId, { approved: true })` 后工具恢复执行并返回结果。
- [x] 外部调用 `permissions.resolve(requestId, { approved: false })` 后工具被阻止，Agent 收到拒绝理由。
- [x] 勾选或设置 `remember` 后，后续同前缀命令自动放行，不再挂起。
- [x] 在挂起期间调用 `runtime.abortPrompt()`，所有 pending Promise 被安全拒绝（`CancelledError`），回路不卡死。

## Visual & Behavioral Demonstration (ASCII Mockups)

### 1. 宠物气泡：Tier 2 命令执行申请卡片 (极简二元审批)
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
状态机交互流:
  1. beforeToolCall 挂起 Promise, 派发 onPermissionRequested({
       requestId: "req_123",
       kind: "permission",
       command: "gh pr merge 42 --squash"
     })
  2. 用户在气泡点击 [ 允许 ]
  3. tRPC permissions.resolve({ requestId: "req_123", approved: true, remember: true })
  4. 唤醒 Promise -> PermissionService 记录 "gh pr" 至内存 Set -> SafeRunner 继续执行
```

### 2. 宠物气泡：未授权工作区目录准入申请卡片 (WorkspaceAccessService)
```text
╭────────────────────────────────────────────────────────╮
│ 🐕 Rover: 检测到命令涉及未授权的外部目录：             │
│                                                        │
│   📂 /Users/zhiyu/Projects/external-service            │
│                                                        │
│   [ 信任并加入工作区 ]            [ 仅本次允许 ]       │
│   [ 拒绝访问 ]                                         │
╰────────────────────────────────────────────────────────╯
状态机交互流:
  1. beforeToolCall 拦截到路径越界 -> 派发 workspace_access 请求
  2. 用户点击 [ 信任并加入工作区 ] -> 持久化写入 trusted_workspaces 表
  3. 后续访问该目录不再弹窗
```

### 3. 宠物气泡：死循环断路器预警卡片 (Doom Loop Guard)
```text
╭────────────────────────────────────────────────────────╮
│ ⚠️ Rover: 检测到可能陷入重复执行的死循环：             │
│                                                        │
│   连续 3 次执行相同参数:                               │
│   $ gh run watch 987123                                │
│                                                        │
│   [ 强制中断流程 ]                [ 继续单次尝试 ]     │
╰────────────────────────────────────────────────────────╯
```

### 4. 中断响应：用户点击取消时的秒级熔断 (No Hanging)
```text
╭────────────────────────────────────────────────────────╮
│ 🐕 Rover: 回合已被主动取消。                           │
│   (挂起中的权限请求已全部安全释放，无孤儿进程残留)     │
╰────────────────────────────────────────────────────────╯
```

---

## Verification Plan

```bash
pnpm --filter @rover/runtime test packages/runtime/src/__tests__/hitl_permission.test.ts
```
