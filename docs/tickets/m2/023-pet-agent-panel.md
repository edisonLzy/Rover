# 023 · Pet Agent Panel

> 状态：DONE · 2026-10-23

## Problem & Outcome

把 hover 工具栏与独立气泡重构为参考视频中的统一 Agent Panel。点击头像展开或收起，收起仅显示头像；Chat、Tasks、Events 切换，输入固定在底部且不含左侧加号。Events 呈现现有 Inbox 外部消息，Task 状态仍只属于 Tasks。

## Interaction & Scope

- 默认头像态；点击展开，再次点击或 Escape 收起；拖动超过 6px 不触发点击。右键仍可进入 Dashboard。
- 原生窗口同时调整宽高，按头像锚点定位，必要时限制在显示器工作区内。60–120% 缩放与输入候选框均不能裁切。
- 展开状态、标签、草稿、消息、审批、Follow-Up 生命周期彼此独立。收起和切标签不销毁数据或取消执行。
- Chat 读取可分页的持久化历史，按 entry ID 去重并衔接实时回复；保留工具执行与权限审批，包括审批恢复、拒绝、重复点击保护和错误重试。
- Tasks 展示目标、执行者、时间、状态及摘要；需要介入置顶；点击打开原 Session；不可用与失败就地反馈。
- 头像区分运行中、需要关注、空闲与离线；后台 Task 通过状态筛选查询参与判断，不能只判断 Rover 当前回合。
- Events 使用 Inbox 列表及一键交办；忙碌时进入 Follow-Up，空闲时启动 Rover 回合。
- 输入继续支持 @Agent、/Skill、#Inbox、IME、Shift+Enter、失败保留草稿、发送去重；新增面板内搜索，搜索仅过滤当前标签内容。
- 不更改 Task 与 Session 一对一的领域契约，不将面板输入发送给某个既有 Task。

## Affected Components & Directory Structure

```text
.
├── CONTEXT.md                                      * [Modified] 面板、头像态、Chat 与 Events 术语
├── pnpm-lock.yaml                                  * [Modified] 补齐 SDK 可选 peer 的打包依赖
├── docs/tickets/m2/
│   ├── 023-pet-agent-panel.md                        + [New] 本次交互、范围与验收
│   ├── README.md                                    * [Modified] 登记本 ticket
│   └── assets/
│       ├── 023-agent-panel-chat.png                   + [New] 使用隔离演示数据的 Chat 截图
│       └── 023-agent-panel-tasks.png                  + [New] 使用隔离演示数据的 Tasks 截图
├── packages/app/src/
│   ├── App.css                                      * [Modified] 面板、头像状态与输入主题
│   ├── features/pet/
│   │   ├── index.tsx                                * [Modified] 常驻生命周期与头像/面板组合
│   │   ├── usePetWindowLayout.ts                     + [New] 原生窗口尺寸、缩放与锚点
│   │   ├── Pet/index.tsx                            * [Modified] 点击、拖动与状态指示
│   │   ├── useFollowUps.ts                          * [Modified] 引用迁移及发送接力保护
│   │   ├── PetToolbar/                              - [Deleted/Moved] 下列文件移至 AgentPanel
│   │   ├── PetBubble/index.tsx                      - [Deleted/Moved] 由 Chat 状态与视图替代
│   │   ├── PetBubble/BadgeShelf.tsx                  - [Deleted/Moved] 移至 AgentPanel/FollowUpShelf.tsx
│   │   ├── PetBubble/ProcessingView.tsx              - [Deleted/Moved] 移至 AgentPanel/Chat/ProcessingView.tsx
│   │   ├── PetBubble/types.ts                       - [Deleted/Moved] 移至 AgentPanel/Chat/types.ts
│   │   └── AgentPanel/
│   │       ├── index.tsx                            * [Modified] 从 PetToolbar 迁移，导航、搜索与常驻输入
│   │       ├── FollowUpShelf.tsx                     * [Modified] 从 BadgeShelf 迁移，底部接续队列
│   │       ├── Chat/
│   │       │   ├── index.tsx                        + [New] 历史、实时回复与处理状态展示
│   │       │   ├── useConversation.ts               + [New] 历史分页、实时消息去重与权限生命周期
│   │       │   ├── ProcessingView.tsx               * [Modified] 原审批视图迁移、错误与处理中显示
│   │       │   └── types.ts                         * [Modified] 原处理状态类型迁移及消息转换
│   │       ├── Task/
│   │       │   ├── index.tsx                        * [Modified] 查询与全局任务活动状态
│   │       │   ├── TaskList.tsx                     * [Modified] 滚动列表、搜索与会话错误
│   │       │   └── TaskCard.tsx                     * [Modified] 紧凑任务行、状态和安全摘要
│   │       ├── Inbox/
│   │       │   ├── index.tsx                        * [Modified] Events 数据与交办入口
│   │       │   └── list.tsx                         * [Modified] 面板消息样式与搜索
│   │       └── PromptInput/
│   │           ├── index.tsx                        * [Modified] 固定底部输入与暗色主题
│   │           ├── usePromptEditor.ts               * [Modified] 面板焦点与输入主题
│   │           ├── serializer.ts                    - [Deleted/Moved] 从 PetToolbar 原样迁移
│   │           ├── types.ts                         * [Modified] 从 PetToolbar 迁移，增加面板 Escape 回调
│   │           ├── components/
│   │           │   ├── SuggestionsPanel.tsx         - [Deleted/Moved] 从 PetToolbar 原样迁移，主题由 App.css 覆盖
│   │           │   └── ReferencePill.tsx            - [Deleted/Moved] 从 PetToolbar 原样迁移
│   │           └── extensions/
│   │               ├── mentionNode.ts               - [Deleted/Moved] 从 PetToolbar 原样迁移
│   │               ├── agentMention.ts              * [Modified] 候选向上展开
│   │               ├── skillMention.ts              * [Modified] 候选向上展开
│   │               └── inboxMention.ts              * [Modified] 候选向上展开
│   └── __tests__/
│       ├── Pet.test.tsx                             * [Modified] 点击和拖动区分
│       ├── PetWindow.test.tsx                       * [Modified] 任务及头像展示
│       ├── PetWindow.runtime.test.tsx               * [Modified] 收起/展开、流式、原生窗口和队列回归
│       ├── PetToolbar.test.tsx                      - [Deleted/Moved] 迁移为 AgentPanel.test.tsx
│       ├── PetBubble.test.tsx                       - [Deleted/Moved] 迁移为 FollowUpShelf.test.tsx
│       ├── PetBubble.approval.test.tsx              - [Deleted/Moved] 迁移为 Conversation.test.tsx
│       ├── AgentPanel.test.tsx                      * [Modified] 导航、草稿、引用、交办与会话行为
│       ├── FollowUpShelf.test.tsx                   * [Modified] 队列展示、滚动及排序
│       ├── Conversation.test.tsx                    * [Modified] 历史、流式、审批、恢复与失败
│       └── editor.test.ts                           * [Modified] 更新迁移后的导入
└── packages/runtime/
    ├── package.json                                * [Modified] 声明 SEA 打包需要的 OpenTelemetry API
    ├── scripts/build-sea.mjs                        * [Modified] 嵌入 SQLite 原生模块并启用文件模块加载
    ├── scripts/smoke-sea.mjs                        * [Modified] 修正重构后的 SkillService 导入路径
    └── src/
        ├── modules/agent/router.ts                  * [Modified] 历史 API 接受已有仓储 beforeSeq 游标
        ├── infrastructure/database/client.ts        * [Modified] SEA 模式从嵌入资产加载 SQLite
        └── __tests__/history_router.test.ts         + [New] 验证历史游标分页契约
```

## Visual & Behavioral Demonstration (ASCII Mockups)

```text
Collapsed                              Expanded
                                       +----------------------------------+
     ( Rover )  <-- click ---------->  | [Search] [Chat|Tasks|Events] (Pet) |
       ~ ring while running            |                                  |
       ! attention while waiting       |  Conversation / task rows / Inbox|
                                       |  Scrollable content              |
                                       |                                  |
                                       | [Follow-Up] [Follow-Up]          |
                                       | [Message Rover              ↑]   |
                                       +----------------------------------+

click -> open -> switch tab -> type -> collapse -> reopen
                    draft / stream / approval / queue survive
pointer down -> move >= 6px -> native drag -> no toggle
permission requested -> attention -> open Chat -> Allow / Deny
```

## Validation

- App Vitest：导航和键盘、草稿、IME、引用、历史分页/去重、流式事件竞态、收起后继续更新、后台任务动画、权限恢复/失败、队列顺序/接力、终端失败、原生窗口缩放/边缘。
- Runtime Vitest：历史 API 游标前后记录边界及输入校验。
- Typecheck、lint、format、workspace tests、production build、SEA build/smoke。
- 通过浏览器查看实际面板，保存 UI 截图作为 PR 证据；原生窗口行为以自动化 API 契约测试为主，记录未执行的真机部分。

### 执行结果 · 2026-10-23

- App：11 个测试文件，93 项通过。
- Runtime：31 个测试文件，273 项通过，3 项既有跳过。
- `pnpm build`、`pnpm typecheck`、`pnpm lint:check`、`pnpm format:check` 均通过。
- `pnpm build:sea` 与 `pnpm smoke:sea` 在 macOS arm64 通过；清空 PATH 后从临时目录启动，验证健康、SQLite 初始化及 Skill 内容/资源。
- 浏览器实际验证 Chat/Tasks/Events、展开/收起、草稿恢复、候选框向上展开、Escape 优先关闭候选框及编辑器焦点归还；截图来自隔离演示数据库。
- 原生窗口的 60/75/100/120% 尺寸、贴边与锚点由 API 契约测试覆盖；未执行 Tauri 真机多显示器拖动或 Windows 验证。
- 验证过程中修复主干已有的 SEA 缺少 SDK peer、SQLite 原生资产与 smoke 旧导入路径问题。
