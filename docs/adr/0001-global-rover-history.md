# Rover 使用全局持续的 Agent history

Rover 是跨用户目标的桌面宠物 Agent，不建立项目级 Rover 会话，因此后续输入沿用一份全局持续的 Agent history，且不提供日常的上下文重置入口。这使用户能直接延续之前的话题；代价是不同目标共享上下文，所以 Task 与原 Code Agent Session 的关联以持久 Task 记录为准，不能依赖可能被压缩的 history，用户可在 Dashboard 删除 Rover 本地数据。
