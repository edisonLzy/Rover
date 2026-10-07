# 016: PetBubble Follow-Up 徽章架与生命周期守卫

**Status**: DONE

**Blocked By**: 012, 014c, 015

**Blocks**: 018

## Context & Goal

依据 [ADR-0018](../../adr/0018-multi-source-input-steer-and-follow-up-interaction.md)，彻底废除底部工具栏（Toolbar）展开多行纵向抽屉列表的旧 `PendingQueue` 实现。在 `PetBubble` 底部边缘构建单行横向微型徽章架（Badge Shelf），支持拖拽重排与随手删除，并通过 WebSocket 消费事件精准出队；同时为气泡增加 Follow-Up 队列非空的生命周期守卫，防止待办被 10 秒倒计时误关闭。

## Specification & Invariants

1. **废弃与清理**：
   - 彻底删除 `packages/app/src/features/pet/PetToolbar/PendingQueue.tsx` 及其在 `PetToolbar/index.tsx` 中的引用；
   - 消除 Toolbar 下方的待办列表容器，保持 Toolbar 垂直高度绝对干净。
2. **微型徽章架（Badge Shelf）规格**：
   - 附着于 `PetBubble` 底部边缘，作为气泡的复合子组件展示；
   - **单行横向排布**：单条徽章（Pill）高度为 **22px**，背景采用轻浅半透明样式，内含抓手图标 `⠿`、简短文本摘要、以及轻量删除按钮 `×`；
   - **数量上限与横向滚动**：最多同时展示两个完整徽章，更多待办始终排在同一行，通过触控板横滑、鼠标滚轮或聚焦后的左右方向键查看；不显示 `+N` 数量提示，也不展开下方列表；
   - **拖拽排序**：采用 `@dnd-kit` 实现横向拖拽，拖拽结束就地更新本地顺序并触发与 Runtime 的队列同步。
3. **队列状态镜像与同步**：
   - 前端维护 `pendingFollowUps` 列表状态；
   - 拖拽重排或点击 `×` 删除时：前端更新列表，调用 `trpc.turns.clearAllQueues({followUpsOnly:true})`，随后将剩余列表批量重新发送 `trpc.turns.followUp`；
   - **消费出队（Eviction）**：订阅 WebSocket 事件，当收到当前回合消费该用户消息的 `message_start`（通过 followUpId 精确匹配，保留 timestamp）时，精准从徽章架移除该 Pill。
4. **生命周期守卫（Guard Condition）修正**：
   - 检查并修正 `PetBubble` 现存的 10 秒无交互自动淡出计时器（`PetBubbleView#L115-L124`）；
   - 增加前置守卫：只有当 `!isThinking && !isBusy && pendingFollowUps.length === 0 && !isHovered` 时，才允许启动 10 秒自动关闭计时器；
   - 只要队列中有未处理徽章，气泡严禁自动淡出。
5. **自动接力（Auto-advance Handoff）**：
   - 当当前回合 LLM 输出完成（`turn.end`），首项待办徽章微高亮亮起，倒计时 1.5 秒自动出队并启动该任务的执行（用户也可直接点击跳过倒计时立即开始）。

## Affected Components & Directory Structure

```text
Rover/
├── CONTEXT.md                              * [Modified] Follow-Up 的回合与消费定义
├── pnpm-lock.yaml                          * [Modified] dnd-kit 依赖锁定
├── docs/
│   ├── adr/0018-multi-source-input-steer-and-follow-up-interaction.md
│   │                                      * [Modified] 横向滚动规格、原生队列时序与接力契约修正
│   └── tickets/m2/
│       ├── 016-pet-bubble-follow-up-badge-shelf.md * [Modified] 范围与验收记录
│       └── README.md                       * [Modified] 进度同步
└── packages/
    ├── app/
    │   ├── package.json                    * [Modified] dnd-kit 依赖
    │   └── src/
    │       ├── features/pet/
    │       │   ├── index.tsx               * [Modified] 输入、队列与窗口布局集成
    │       │   ├── useFollowUps.ts          + [New] 串行队列同步、消费及接力控制
    │       │   ├── PetBubble/
    │       │   │   ├── index.tsx           * [Modified] 徽章架与淡出守卫
    │       │   │   └── BadgeShelf.tsx      + [New] 22px 徽章、横向滚动和排序
    │       │   └── PetToolbar/
    │       │       ├── index.tsx           * [Modified] 忙碌输入路由至 Follow-Up
    │       │       └── PendingQueue.tsx    - [Deleted/Moved] 删除纵向待办
    │       └── __tests__/
    │           ├── PetWindow.test.tsx      * [Modified] 替换旧队列断言
    │           ├── PetWindow.runtime.test.tsx * [Modified] RPC、消费、接力及窗口回归
    │           ├── PetToolbar.test.tsx     * [Modified] 排队接受与失败保留草稿
    │           └── PetBubble.test.tsx      + [New] 生命周期、横向滚动和键盘拖拽验证
    └── runtime/src/
        ├── expose.ts                      * [Modified] 纯类型公开契约
        ├── types/events.ts                * [Modified] 用户 message_start 事件
        └── modules/agent/
            ├── index.ts                   * [Modified] 显式导出队列类型
            ├── types.ts                   * [Modified] 结构化 Follow-Up 与消费契约
            ├── service.ts                 * [Modified] 排队与激活服务
            ├── router.ts                  * [Modified] Follow-Up RPC 扩展
            ├── runtime/
            │   ├── runtime.ts             * [Modified] Runtime 待接力队列与消费回调
            │   └── callbacks/
            │       ├── broadcast.ts       * [Modified] message_start 广播
            │       └── persistence.ts     * [Modified] 保留待办消息到达时间
            └── __tests__/
                ├── agent_runtime.test.ts  * [Modified] 排队隔离、精确消费与回合保护
                ├── agent_service.test.ts  * [Modified] RPC 映射验证
                └── runtime_callbacks.test.ts * [Modified] 广播身份验证
```

## Runtime Contract Clarification

遵循方案 A 极简分层架构与后端 0 侵入原则：
1. **待办队列归属前端**：`PetBubble` 微型徽章架（Badge Shelf）由前端完全持有与管理。用户在忙碌态下提交的待办即时挂入前端队列；徽章的横向拖拽重排与点 `×` 删除均为纯本地状态操作，彻底废除脆弱的“清空再逐条重发” N+1 RPC 同步机制，杜绝数据损坏与网络竞态。
2. **标准化回合启动接力**：当前回合结束后，首项徽章微高亮亮起，倒计时 1.5 秒（或用户点击跳过）后，前端直接调用纯净的 `trpc.turns.start({ promptDoc })` 启动标准的独立 Rover Turn，完整复用 WAL 与 History 写入链路。Runtime 内部无需维护冗余的待办队列与特设的 `startFollowUp` 路由。
3. **启动即就地出队**：待办在前端调用 `turns.start` 成功后就地从队列移除，生命周期自闭环，后端 Runtime 无需增加 `followUpId`、`inputTimestamp` 等字段，也无需维护额外的 `turn.message_start` 事件广播。
4. **Steer 链路正交独立**：用户提交的紧急干预（Steer）不进入前端徽章架，直接通过 `turns.steer` 注入底层 `agent.steer`，在 Tool 间隙优先消费，两者物理空间与交互模型完全正交。

## Acceptance Criteria

- [x] Toolbar 下方不再渲染任何纵向待办列表容器。
- [x] 忙碌态下添加 Follow-Up 后，`PetBubble` 底部固定单行徽章架最多显示两个完整徽章；更多待办横向滚动查看，无数量提示及下方展开列表。
- [x] 徽章支持横向拖拽调换顺序，并正确同步至 Runtime。
- [x] 点击徽章上的 `×` 能立即删除该项并同步至 Runtime。
- [x] 当底层 Agent 开始执行某一 Follow-Up 时，该徽章从气泡底部精准消失。
- [x] 队列中存在待办时，`PetBubble` 超过 10 秒不会自动关闭；队列清空后恢复既有的 10 秒自动淡出。
- [x] 当前回合结束后，首项徽章能平滑自动接力开启下一轮回合。

## Verification Plan

- 模拟忙碌态添加 1 条、2 条及 4 条 Follow-Up，验证最多两个完整徽章可见，横向滚动能查看其余待办且气泡高度不增加。
- 验证拖拽排序与点叉删除的 RPC 调用时序。
- 模拟等待 15 秒，验证有待办时不触发关闭、无待办时 10 秒后正常淡出。
- 跑通 Vitest 前端相关测试。

## Verification Results (2026-10-07)

- 单行横向滚动、22px 徽章、排序、删除、实际消费出队、1.5 秒接力及气泡淡出守卫保留。
- 已撤销与 016 无关的 Sidecar 打包脚本、SQLite 原生模块加载、Runtime 的 OpenTelemetry 依赖及对应锁文件变化。
- 已移除额外的队列快照接口、断线自动恢复、重试按钮和跨回合已消费 ID 去重；删除这些扩展的测试。
- Node 24.21.0 / pnpm 10.11.0，冻结锁文件安装、完整生产构建、类型检查及变更范围 lint / format 检查通过。
- App 四个相关套件共 49 个测试、Runtime 四个相关套件共 31 个测试通过。012 工具栏隐藏计时测试在首次并行运行中偶发失败，单独复跑的 17 个工具栏测试全部通过。
- `build:sea` 通过；恢复原版脚本后，`smoke:sea` 因既有的 `src/agent/skills/skill-service.ts` 旧导入路径不存在而失败。本次按用户要求撤销该独立修复，未再修改打包或数据库文件。

## Out of Scope

PromptInput 快捷键（017 负责）、Inbox 抽屉（018 负责）、Sidecar 打包修复、SQLite 加载调整，以及队列快照/断线恢复/重试/回执去重扩展。
