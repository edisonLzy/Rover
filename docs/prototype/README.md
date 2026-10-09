# Rover 产品交互原型

## 输入框与水泡入口交互稿

打开 [rover-bubbles/index.html](./rover-bubbles/index.html) 体验独立 HTML 交互稿，无需构建。输入框常显；Inbox / Task 有内容时显示水泡入口，分离时输入框收窄，融合时恢复宽度。点击入口在下方展示紧凑列表，支持消息引用、交办和提交演示任务。页面下方的演示控件可切换零个、一个或两个入口，以及列表内容归零的状态。

此交互稿使用内存中的演示数据，刷新恢复初始状态；不接入真实 Agent。图标通过 Lucide CDN 加载，需要联网。另附[预览图](./rover-bubbles/preview.png)与[验证记录](./rover-bubbles/design-qa.md)。

## 完整产品原型

打开 [index.html](./index.html) 即可体验，无需构建。界面名称以 [CONTEXT.md](../../CONTEXT.md) 为准。此原型与[Rover 产品能力边界与核心交互](../architecture/Rover%20产品能力边界与核心交互.md)对应，使用固定的 1920 × 1080 桌面画布；顶部可切换整屏比例或放大 Rover。拖动宠物可以改变位置，位置保存在当前浏览器。宠物区域提供悬浮待命态、快捷操作胶囊、宠物气泡、输入栏和任务列表；**右键桌面顶部菜单栏的 Rover「R」图标**，选择「打开 Dashboard」进入独立管理面板。任务卡片直接进入原 Session 的跳转占位页，不经过任务详情页。Inbox 列表与 Inbox 气泡是待补充的新界面；原型中的“需关注任务”只筛选 Task。

## 术语与原型代码对应

以下只记录原型中的位置；术语定义见 [CONTEXT.md](../../CONTEXT.md)。

| 术语 | 原型代码或状态 |
| --- | --- |
| 宠物区域、宠物形象 | `#roverShell`、`#petArea`、`.pet` |
| 悬浮待命态、快捷操作胶囊 | `petMode: 'compact'`、`compact()`、`.compact-controls` |
| 交互展开态、输入栏 | `petMode: 'home'`、`home()`、`.composer` |
| 待处理 Prompt、任务列表、任务卡片 | `.prompt-queue`、`.task-list`、`.task-summary-card` |
| 宠物气泡 | `.pet-speech`、`state.speech` |
| 需关注任务 | Dashboard 内的 `attentionTasks()`；快捷操作胶囊的铃铛只展开宠物任务列表 |
| Rover 菜单栏图标、Dashboard | `#roverTrayIcon`、`#trayMenu`、`.rover-panel.management-panel`、`dashboard()` |
| Inbox 气泡、Inbox 列表、Dashboard Inbox | 原型尚未实现；当前铃铛和宠物数字角标统计的是需关注 Task |

原型中输入栏也采用大圆角外形。需要修改宠物下方的三个图标时，请指明“快捷操作胶囊”；需要修改文字输入与发送按钮时，请指明“输入栏”。

## 建议评审路径

`task-recall` 的原型匹配仅使用少量预置关键词；真实产品需检索本地 Task 摘要记录，并将命中内容作为工具结果按需加入当前 Rover history。摘要由 Code Agent 决定是否保存，任务卡片上的状态文案不是可引用摘要。

1. 在「体验场景」中选择**连续输入与继续确认**：Prompt 1 处理期间，Prompt 2、Prompt 3 进入输入框下方的待处理队列，Task 数不因排队而变化。Prompt 1 的回答只在气泡显示；界面提示是否继续下一条。点**暂不处理**观察队列保留，再点**继续下一条**，观察 Prompt 2 开始处理、Prompt 3 继续等待。也可以在处理期间手动连续提交。输入「`/current-time` 现在几点」，观察 Rover Agent 执行 Skill 后直接回答，Task 数仍不变。输入「帮我」观察补充问题；气泡约 10 秒后收起，输入框仍可选择回答问题。再输入「整理这份需求文档」会形成完整目标并派发。输入「今天天气怎么样」，观察原型说明缺少实时天气数据，不创建 Task。
2. 输入「帮我整理这份需求文档」，观察未命中业务 Skill 时，Rover Agent 仍可用内置 `agent-dispatch` 启动 Code Agent Session，并出现对应 Task；输入「帮我设置一个定时任务」查看原型中自动匹配并派发的 `scheduled-task`；再输入「`/scheduled-task` 每天 09:30 检查支付链路告警」查看显式引用。
3. 新 Task 卡片显示任务描述和纯文本执行摘要，动态边框提示仍在处理。点击卡片进入不含对话内容的会话跳转占位；用**模拟进度更新**查看卡片摘要如何跟随 Agent 状态变化。
4. 在跳转占位中选择**模拟 Agent 请求用户**，卡片会出现**去确认**，宠物气泡也提示返回原会话。再次进入占位并选择**模拟在 Agent 中完成确认**，观察纯文本摘要更新。
5. 在原任务还运行时，继续在宠物输入框输入一个独立目标，观察新 Task 与原 Task 同时存在。输入「给刚才那个再加测试」，Rover 会定位原 Task 并引导打开它的 Code Agent Session；输入不会传给该 Session。输入「我之前是否做过支付链路巡检？」会由 `task-recall` 读取 TASK-216 已保存的摘要，在气泡回答且不创建 Task。输入「`@Codex` 给支付 QA 发布功能加测试，我记得以前做过相关功能」则派发新的 Codex Session 和 Task；命中相关历史摘要时，新 Task 展示附加背景。若检索未命中，仍正常派发新需求。单独询问没有已保存摘要的 TASK-215 时，Rover 只告知不知道具体工作内容。
6. 选择**模拟 Agent 完成**，卡片切换为稳定边框，显示 Markdown 结果摘要和**查看会话**；右键菜单栏 Rover 图标，选择**打开 Dashboard**，查看最近活动。进入**定时计划**可模拟成功触发、触发失败、退出期间错过，以及暂停、恢复和删除，并查看运行日志与宠物气泡；**模型配置**可模拟保存 Rover Agent 的提供商和模型；**本地数据**可查看删除影响提示。
7. 选择**QA 发布确认**，确认按钮仍在处理中卡片内；输入「我想调研 XX 问题，请使用 `@Claude Code` 完成相关调研」可验证直接派发与摘要展示。
8. 选择**失败后回到会话**，失败卡片只提供**查看会话**；在会话跳转占位中选择**模拟 Agent 在原会话继续**，观察同一 Task 回到处理中，Session 标识不变。也可在运行中的会话跳转占位模拟可恢复 API 错误与执行停止，比较两种卡片状态。失败会话的占位页还可模拟**原会话不可用**，卡片会显示不可用提示并保留失败记录。

顶部「体验场景」仅是评审快捷入口，也可直接切到 Dashboard 子页；它不属于 Rover 产品入口。菜单栏原型可演示打开 Dashboard 与隐藏/显示宠物，「退出 Rover」仅显示为禁用示意。

顶部场景菜单还提供 Rover Agent 直接回答、Rover Agent 执行 Skill、补充问题、返回原任务会话、`@Agent` 派发时按需补充历史摘要、天气能力说明、无 Skill 派发、故障排查、失败后回到会话和语音输入示意。任务列表不放状态分组 label，以卡片动态边框区分处理中的任务；失败与取消也用完成态卡片呈现，但摘要明确写明结果。输入框使用简化规则模拟 Rover Agent 的轻量分流和 Skill 匹配；它不代表最终实现方式。Rover Agent 同时只判断一条输入；处理中仍可发送，后续输入由界面暂存到可见队列，当前回合结束后由界面询问是否继续，逐条确认后才提交给 Rover Agent，不等待 Task 完成。队列与确认不依赖 Agent 工具或 Agent 输出；排队文本在确认前不进入 Agent history，也不是 Task。所有真正提交的 Prompt 都追加到同一份 Rover Agent history，新的处理回合不创建新 history；MVP 仅在上下文窗口接近限制时 compaction。原型只在浏览器内模拟这份 history，未接入真实 Agent。若排队输入碰上 Rover 的澄清问题，默认作为新输入，用户可在界面切换为回答问题。Rover 不提供自身的会话列表，当前气泡由下一次输入替换；非终态气泡约 10 秒后收起，鼠标停在气泡上会暂停计时，移开后重新计时。输入框在任务处理中保持可用；只有 Skill 成功启动 Code Agent Session 才出现与之一对一的 Task。对已派发目标的补充、修改和确认默认进入原 Session，Rover 只提供定位入口；显式 `@Agent` 会建立新 Session 和 Task，历史摘要检索命中时可作为背景，未命中不阻断派发，不向旧 Session 注入新输入。会话跳转页上的操作按钮只模拟 Agent 状态回报，Rover 卡片没有重新派发入口。

原型中的会话跳转、定时触发、Dashboard 内容、任务状态与保存操作均为浏览器内演示数据。它在内存中持续记录实际提交的 user/assistant 消息；简化的分流规则只模拟相邻澄清，尚未接入真正消费该 history 的 Rover Agent，也不演示 context window compaction。跳转页不展示 Agent 会话内容。原型不会启动 Claude Code/Codex、创建真实定时任务、安装 Skill 或写入外部服务。除宠物位置外，刷新页面会恢复初始演示状态。
