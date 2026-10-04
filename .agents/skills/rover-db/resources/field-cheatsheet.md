# Rover 表与关系速查

本表来自 `packages/runtime/src/storage/migrations/001_initial_schema.sql` 和 `migrator.ts`。实际字段、约束与版本以当前数据库为准；运行时迁移注册在 `packages/runtime/src/storage/migrations/index.ts`，记录操作语义见 `packages/runtime/src/storage/repositories/`。

| 表 | 作用 / 关系 |
|---|---|
| `rover_turn` | 回合生命周期与用户 prompt；状态 running/completed/failed/cancelled |
| `rover_entry` | 消息与压缩条目，以 seq 排序；message 关联 turn_id，compaction 的 turn_id 为空 |
| `runtime_event` | WebSocket 同步事件序列，不等同于对话消息 |
| `dispatch_attempt` | Agent 派发尝试，记录 candidate_task_id、原生会话和派发状态 |
| `task` | 任务卡片投影；状态 running/needs_intervention/completed/failed/unverified |
| `session_ref` | task_id 关联 task，保存原生会话与载体信息，通常一对一 |
| `task_event` | task_id 关联 task 的去重事件流 |
| `task_summary` | task_id 关联 task 的可引用摘要 |
| `activity` | 最近活动台账 |
| `schema_migrations` | 已应用迁移版本，由迁移器维护 |

时间字段通常为 UTC Unix 毫秒，需结合写入代码确认。SQL 展示可用 `datetime(created_at / 1000.0, 'unixepoch')` 得到 UTC，再转换为用户时区（当前用户为 Asia/Shanghai）。不要使用执行主机时区推断用户时间。

`prompt_doc`、`data`、`payload` 等为 JSON，先查看对应仓储/类型代码再确定 JSON 路径。默认不展示 report_token_hash 或完整消息、事件载荷；只有问题需要时取相关内容。

删除 task 可能级联删除 session_ref、task_event、task_summary；删除 rover_turn 可能级联删除消息条目。修改投影状态还可能需要同步相关事件和摘要，先阅读写入实现，避免只改表面状态造成业务不一致。
