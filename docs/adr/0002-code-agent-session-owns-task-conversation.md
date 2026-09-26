# Code Agent Session 承载派发后的任务交互

Rover 只负责按 Skill 派发、观察 Task 状态并定位原 Code Agent Session；Task 建立后，用户对该目标的补充、修改、澄清和确认都在对应 Session 中进行。选择这条边界是为了让执行上下文和用户决定留在原会话，避免 Rover 建立第二条任务对话或把新的 Rover 输入注入既有 Session。用户在 Rover 提到已有 Task 的普通补充时，默认引导其打开原 Session；若用户显式指定 `@Agent`，则按新需求派发新的 Session 与 Task。Rover 可以按需检索旧 Task 已保存的摘要作为新任务背景；未命中摘要不阻止新派发，原 Session 始终不变。
