# M2 Rover 核心 (Rover Core) 任务清单

本目录记录按照 Matt Pocock 的 **Tracer-Bullet Tickets** 方法论拆解的 M2（Rover 核心）工程任务。
每个 Ticket 均为一条端到端可验证的垂直切片，受限于单个 Agent 上下文窗口容量，并声明了精确的前置阻塞依赖（`Blocked By`）。

History、消息写入粒度与 Compaction 以 [ADR-0014](../../adr/0014-linear-rover-entries-and-compaction.md) 为准，替代 ADR-0012 中相应的旧设计。回合生命周期与恢复策略仍需在存储实施前定稿。

宠物交互重构拆为 012–015 四条可验收切片，修订已完成的 010 中的交互；010 保留历史完成状态。新票均从 TODO 开始，已有局部代码不等同于完成验收。执行时只补齐差异，沿用现有 Tailwind、编辑器、Task 接管及 compact 尺寸设置；SQLite Inbox 与外部告警仍属于 M3。

## 任务依赖拓扑（DAG Frontier）

```mermaid
flowchart TD
  T001["001: SQLite 存储层与迁移机制"]
  T002["002: Tiptap 3 输入栏与 PromptDocumentV1"]
  T003["003: 模型配置管理与 Pi AI 契约对齐"]

  T004["004: 全局 History 与 Compaction 存储"]
  T001 --> T004

  T005["005: Pi Agent Loop 回合引擎与流式响应"]
  T001 --> T005
  T002 --> T005
  T003 --> T005
  T004 --> T005


  T006["006: 受控工具与 Task 事务创建"]
  T001 --> T006
  T005 --> T006

  T007["007: 任务事件投影与状态生命周期"]
  T001 --> T007
  T006 --> T007

  T008["008: 任务摘要回忆 (task-recall) 与最近活动"]
  T001 --> T008
  T006 --> T008
  T007 --> T008

  T009["009: Skill 目录管理与安全安装"]
  T001 --> T009
  T006 --> T009

  T010["010: 宠物窗口完整交互 UI 与终端接管"]
  T002 --> T010
  T005 --> T010
  T006 --> T010
  T007 --> T010

  T011["011: Dashboard 管理面板完整 UI"]
  T003 --> T011
  T007 --> T011
  T008 --> T011
  T009 --> T011

  T012["012: 宠物待命、工具栏与输入交互"]
  T002 --> T012
  T010 --> T012
  T013["013: Task 堆叠/展开与 Panel 滚动"]
  T012 --> T013
  T014["014: 本地 Inbox 与 Loop follow-up"]
  T005 --> T014
  T013 --> T014
  T015["015: LLM 气泡职责收敛"]
  T012 --> T015
```

## Ticket 列表与状态

| ID                                                             | 任务标题                                  | 阻塞项 (Blocked By) | 状态 | 核心产物 / 涉及层                                                                          |
| :------------------------------------------------------------- | :---------------------------------------- | :------------------ | :--- | :----------------------------------------------------------------------------------------- |
| [001](./001-sqlite-storage-and-migrations.md)                  | SQLite 存储层与版本迁移机制               | _None (Frontier)_   | DONE | `packages/runtime` (better-sqlite3, migrations)                                            |
| [002](./002-tiptap-prompt-input-and-prompt-document-v1.md)     | Tiptap 3 输入栏与 PromptDocumentV1 契约   | _None (Frontier)_   | DONE | `packages/app` (Tiptap 3, Suggestion), `packages/runtime` (Zod schema)                     |
| [003](./003-pi-models-config-and-keychain-bridge.md)           | 模型配置管理与 Pi AI 契约对齐             | _None (Frontier)_   | DONE | `packages/runtime` (~/.rover/models.json, tRPC), `packages/app`                            |
| [004](./004-rover-history-and-compaction.md)                   | 全局 History 与 Compaction 存储           | 001                 | DONE | `packages/runtime` (rover_entry, compaction)                                               |
| [005](./005-pi-agent-loop-and-turn-engine.md)                  | Pi Agent Loop 回合引擎与流式响应          | 001, 002, 003, 004  | DONE | `packages/runtime` (Pi Agent loop, turn protocol, WS stream)                               |
| [006](./006-controlled-tools-and-task-transaction-creation.md) | 受控工具链与 Task 事务原子创建            | 001, 005            | DONE | `packages/runtime` (dispatch_attempt, session_ref, task, agent-dispatch)                   |
| [007](./007-task-event-projection-and-status-lifecycle.md)     | 任务事件投影与状态生命周期管理            | 001, 006            | DONE | `packages/runtime` (observe/spool consumer, task_event, state projection)                  |
| [008](./008-task-recall-and-activity-ledger.md)                | 任务摘要回忆 (task-recall) 与最近活动台账 | 001, 006, 007       | TODO | `packages/runtime` (n-gram index, task_summary, activity)                                  |
| [009](./009-skill-management-and-safe-installation.md)         | 内置 Skill 发现与加载机制                 | 001, 006            | DONE | `packages/app/resources/skills` (内容与附件), `packages/runtime` (loader, SKILL.md parser) |
| [010](./010-pet-window-ui-and-task-interaction.md)             | 宠物窗口交互展开态、任务卡片与终端接管    | 002, 005, 006, 007  | DONE | `packages/app` (PetWindow, cards, queue), `src-tauri` (open_task)                          |
| [011](./011-dashboard-window-ui.md)                            | Dashboard 管理面板完整功能视图            | 003, 007, 008, 009  | TODO | `packages/app` (DashboardWindow, skills, models, activity, attention)                      |
| [012](./012-pet-toolbar-and-prompt-interaction.md) | 宠物待命、工具栏与输入交互重构 | 002, 010 | TODO | `packages/app` (Pet, PetToolbar, PromptInput, PetWindow) |
| [013](./013-pet-task-panel-and-scroll.md) | Task 堆叠、展开与 Panel 滚动 | 012 | TODO | `packages/app` (PetPanel/tasks, useActivePanel) |
| [014](./014-local-inbox-and-agent-follow-up.md) | 本地 Inbox 与 Agent Loop follow-up | 005, 013 | TODO | `packages/app` (PetPanel/inbox), `packages/runtime` (Agent 提交) |
| [015](./015-pet-bubble-output-isolation.md) | PetBubble 的 LLM 输出职责收敛 | 012 | TODO | `packages/app` (PetBubble, 类型化事件订阅) |

## 宠物重构执行边界

- 每个独立功能对应一个目录，主实现放在该目录的 `index.tsx`：气泡使用 `pet/PetBubble/index.tsx`，工具栏使用 `pet/PetToolbar/index.tsx`，面板沿用 `pet/PetPanel/`；`pet/index.tsx` 是窗口组合入口。组件专用的子组件、事件处理和私有 Hook 留在所属功能内，不为它们另建功能目录。
- 建议顺序：012 → 013 → 014；015 在 012 完成后可独立进行，不要求并行执行。
- 每票同时交付实际交互与对应验证，避免先做一次全量机械拆文件，再集中补交互。
- 按 TRD §2.1 将私有逻辑留在所属组件内，仅提取真实共享状态或有独立生命周期的接口；不扩大为 Dashboard、Task 服务或全局状态重构。
- 已有未提交实现先保留，按对应票逐项核对；后续实施只迁移必要引用，删除明确不再使用的旧代码。
