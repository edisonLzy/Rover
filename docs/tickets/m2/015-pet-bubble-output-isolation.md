# 015: PetBubble 的 LLM 输出职责收敛

**Status**: COMPLETED  
**Blocked By**: 012  
**Blocks**: None  

## Context & Goal

保留已有 Rover LLM 气泡，把输出订阅、展示及关闭行为收敛到 PetBubble；避免重构后的任务通知、终端接管错误或 Inbox 反馈覆盖 LLM 输出。

## Specification & Invariants

1. **内容边界**：PetBubble 展示当前 Rover 回合的 LLM 输出及相关状态。任务变化留在 PetToolbar/Task，Inbox 发送错误留在 Inbox/输入区域，终端接管错误留在任务卡片。
2. **通知与反馈分流归位（2026-10-04 阶段性结论）**：
   - **`needs_intervention` 任务干预**：不再写入 `bubbleText` 覆盖正在进行的 LLM 对话；统一由 `PetToolbar/Task` 承接——包括 Task 按钮数量与告警 Badge、`TaskList` 最高优先级置顶排序（`priority: 0`）、`TaskCard` 蓝色呼吸动效与高亮「去确认」操作按钮；折叠时由堆叠卡片态（013）提供视觉常驻。
   - **终端接管与操作反馈**：用户点击「去确认」唤起终端的成功提示（`openNotice`）或失败报错（`openError`，如自动化权限受阻）采用就地反馈（Inline Alert）模式直接渲染于 `TaskList` 顶部或对应卡片附近，严禁反射回 PetBubble。
   - **气泡职责纯化**：PetBubble 仅消费 Turn 生命周期（启动中、思考中、流式 Token、生成完毕、回合失败报错），保证长文本回复与流式过程不被异步任务事件打断。
3. **事件边界**：使用受类型约束的 Runtime 事件；区分回合 ID，避免旧回合迟到的 delta/end 覆盖当前输出。沿用既有 thinking、回答流与结束/失败行为，不因组件重挂载重复订阅。
4. **状态归属**：关闭、hover 与既有自动隐藏生命周期属于 PetBubble；只有同时被其他组件实际使用的连接/回合状态才共享，禁止将气泡所有事件处理提升至 PetWindow 再透传。
5. **布局**：与 Pet、PetToolbar 一起位于 Task/Inbox 列表滚动区域之外；保持原型视觉和 compact 尺寸适配。保留已有输出展示能力，不引入聊天历史列表或新动画。
6. **清理**：删除旧入口中已完成迁移的重复事件处理与气泡状态；不为本票创建通用事件总线或重构全局 RuntimeContext。

## Affected Components & Files

- `packages/app/src/features/pet/PetBubble/index.tsx`：气泡功能的主实现；复用现有实现，组件名保持 PetBubble，专用子组件与私有 Hook 留在该文件内。
- `packages/app/src/features/pet/index.tsx`：移除已迁移的气泡职责。
- 宠物区域必要的类型化事件订阅实现，优先复用既有 Runtime client。
- `packages/app/src/__tests__/PetWindow.test.tsx`、`websocket.test.ts` 及必要的输出事件测试。

## Acceptance Criteria

- [x] 新回合、thinking、流式回答、完成与失败均能呈现，连续回合不会串内容。
- [x] 旧回合迟到事件不会修改新回合气泡。
- [x] `task.changed`、Inbox 发送失败与 Terminal 接管反馈不覆盖 LLM 输出。
- [x] 既有关闭/hover/隐藏交互保持可用；卸载时清理订阅与计时器。
- [x] Task/Inbox 滚动与尺寸调整不造成气泡随列表移动或被窗口裁切。
- [x] PetWindow 仅保留组合、布局与真正共享的状态，无重复输出状态或无意义的事件 props 转发。

## Verification Plan

- 验证交错回合事件与任务事件，覆盖 streaming → end 及错误路径。
- 手动验收长回复、面板滚动、气泡关闭、连续回合与尺寸变化。
- 执行 app 类型检查与对应测试；四票完成后按 012–015 的用户路径做一次整体回归。

## Out of Scope

LLM history UI、消息持久化重构、全局 WS 协议升级、任务通知气泡、持久化 Inbox 未读气泡。
