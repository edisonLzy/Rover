# 022c: 宠物气泡紧凑二态交互与轻量 HITL 审批 (PetBubble Compact Phases & Lightweight HITL Approval)

**Status**: DONE  
**Blocked By**: 022b  
**Blocks**: None  

## Context & Goal

在 Ticket 022b 中，底层已经完整交付了 `PermissionService`、`WorkspaceAccessService`、tRPC 决算路由（`permissions.resolve`）以及全套 WebSocket 广播通信链路（`permission.requested`、`turn.tool_call`、`turn.tool_result`）。

本票针对前端桌面悬浮宠物气泡（`PetBubble`）进行现代化紧凑重构：
1. **废弃冗余顶部 Header**：移除原本占位的“Rover 回答 / 正在判断”整行状态栏，将状态图标与微型关闭叉直接内联，大幅压缩桌面垂直空间占用；
2. **落地紧凑二态交互模型 (Two-Phase Bubble)**：
   - **处理中态 (Processing)**：保持极简单行/双行展示。
     - **思考阶段 (Thinking)**：采用高层状态收敛，展示优雅的 `◌ 正在思考中…`；
     - **工具执行阶段 (Tool Call)**：展示单行工具胶囊 `⚡ <toolName>: <summary>`；
     - **审批阶段 (Approval)**：单行展示目标内容（命令或工作区路径），下方展开等宽二元操作按钮 `[ 允许 ]` 与 `[ 拒绝 ]`；
   - **出结果态 (Result)**：回合完成（`turn.end`），直接呈现多行回答正文与原会话入口；
3. **数据模型采用顶层可辨识联合类型 (Discriminated Union)**：
   - 彻底废弃单一可选字段对象，定义强类型的 `BubbleState`（`idle` | `thinking` | `tool_call` | `approval` | `result`），在 React 中实现 100% 精确的类型收窄；
4. **统一场景与决算闭环**：
   - 统一处理 `permission`（高危命令单次允许）与 `workspace_access`（外部工作区信任并持久化）两类审批；
   - 审批未决期间严禁 10 秒自动消失；点击右上角 `✕` 视同拒绝并释放挂起协程。

---

## Affected Components & Directory Structure

```text
packages/app/src/
├── features/
│   └── pet/
│       └── PetBubble/
│           ├── * [Modified] index.tsx                  # 接入 Discriminated Union 状态机、二态渲染与事件驱动
│           ├── + [New] types.ts                         # BubbleState 顶层可辨识联合类型契约与映射 helper
│           ├── + [New] ProcessingView.tsx               # 紧凑处理中组件 (思考态 / 工具胶囊 / 审批卡片)
│           └── * [Modified] BadgeShelf.tsx             # 保持 follow-up 待办徽章架兼容
└── __tests__/
    └── + [New] PetBubble.approval.test.tsx             # 紧凑状态机转换、HITL 审批交互与 tRPC 决算单测
docs/tickets/m2/
├── + [New] 022c-pet-bubble-compact-phases-and-hitl-approval.md # 本工单
└── * [Modified] README.md                              # 更新 M2 DAG 依赖图与任务列表
```

---

## Specification & Invariants

1. **顶层可辨识联合类型契约 (`types.ts`)**：
   ```typescript
   export type BubbleState =
     | { status: 'idle' }
     | { status: 'thinking' }
     | { status: 'tool_call'; toolName: string; summary: string }
     | { 
         status: 'approval'; 
         requestId: string; 
         kind: 'permission' | 'workspace_access' | 'doom_loop';
         summary: string;
         icon: '⚡' | '📂' | '⚠️';
       }
     | { status: 'result'; content: string; isError?: boolean };

   export function isProcessing(state: BubbleState): boolean {
     return state.status === 'thinking' || state.status === 'tool_call' || state.status === 'approval';
   }
   ```

2. **通信事件驱动状态机流转 (`index.tsx`)**：
   - `turn.started` / `turn.delta(isThinking: true)` -> `status: 'thinking'`；
   - `turn.tool_call` -> `status: 'tool_call'`，解析参数为单行摘要；
   - `permission.requested` -> `status: 'approval'`，提取命令或路径，暂停 autoClose 计时器；
   - `permissions.resolve` 成功或 `turn.tool_result` -> 恢复为 `tool_call` 运行态；
   - `turn.delta(isThinking: false)` 累加正文回答；
   - `turn.end` -> `status: 'result'`，展示最终正文。

3. **二元审批决策分发规则**：
   - 点击 `[ 允许 ]`：
     - 若 `kind === 'workspace_access'`：调用 `trpc.permissions.resolve.mutate({ requestId, approved: true, trustWorkspace: true })`；
     - 若 `kind === 'permission'`：调用 `trpc.permissions.resolve.mutate({ requestId, approved: true })`；
   - 点击 `[ 拒绝 ]` 或气泡右上角 `✕`：
     - 调用 `trpc.permissions.resolve.mutate({ requestId, approved: false })`。

---

## Acceptance Criteria

- [x] `BubbleState` 契约定义清晰，包含 `idle`, `thinking`, `tool_call`, `approval`, `result` 五种状态的 Discriminated Union。
- [x] 收到思考流时，气泡以单行极简高度展示 `◌ 正在思考中…`。
- [x] 收到工具调用时，气泡以单行极简高度展示 `⚡ <toolName>: <summary>`。
- [x] 收到危险命令拦截或工作区越界时，气泡展开为双行紧凑结构，展示单行目标信息与 `[ 允许 ]` / `[ 拒绝 ]` 按钮。
- [x] 处于审批挂起状态时，10 秒无交互自动隐藏计时器被完全禁用。
- [x] 点击 `[ 允许 ]` 准确区分工作区信任（`trustWorkspace: true`）与命令放行，并成功恢复 Agent 协程。
- [x] 点击 `[ 拒绝 ]` 或 `✕` 正确向后端回传阻断，回合不发生孤儿挂起。
- [x] 回合完成时，气泡切换为 `result` 状态并正确展示完整回答文本。
- [x] 完整的单测用例覆盖以上状态转换与交互动作。

---

## Visual & Behavioral Demonstration (ASCII Mockups)

### 1. 思考中 (Thinking - 单行极简)
```text
┌──────────────────────────────────────────┐
│ ◌ 正在思考中…                          ✕ │  ← 高度 ~36px, 干净专业
└──────────────────────────────────────────┘▷
```

### 2. 工具调用中 (Tool Call - 单行胶囊)
```text
┌──────────────────────────────────────────┐
│ ⚡ bash: git diff --stat               ✕ │  ← 单行工具调用
└──────────────────────────────────────────┘▷
```

### 3. 工具或工作区审批 (Approval - 紧凑双行)
```text
┌──────────────────────────────────────────┐
│ ⚡ bash: rm -rf ./dist                 ✕ │  ← 目标操作 (或 📂 访问: /path)
│ ┌──────────────┐      ┌──────────────┐   │
│ │   [ 允许 ]   │      │   [ 拒绝 ]   │   │▷ ← 等宽二元操作按钮
│ └──────────────┘      └──────────────┘   │
└──────────────────────────────────────────┘
```

### 4. 出结果 (Result - 完整回答)
```text
┌──────────────────────────────────────────┐
│ 项目构建成功！所有产物已输出至 dist。  ✕ │  ← 直接呈现结果，无多余 Header
│ 共计 12 个 bundle 文件。                 │
│                                          │
│ [ 打开原会话 ↗ ]                         │▷
└──────────────────────────────────────────┘
```

---

## Verification Plan

```bash
pnpm --filter @rover/app test packages/app/src/__tests__/PetBubble.approval.test.tsx
pnpm typecheck
pnpm lint:check
pnpm format:check
```
