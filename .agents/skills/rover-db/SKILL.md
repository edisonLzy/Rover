---
name: rover-db
description: 管理当前 Rover 项目的本地 SQLite 数据库。当用户要查看数据库或表结构、查询任务与会话、备份数据库、修改或修复具体记录时使用。
---

# Rover 数据库管理 Skill

通过自然语言管理 Rover 本地 SQLite。入口负责路由，具体操作在 `references/`，共享资料在 `resources/`，非敏感默认参数在 `store/config.json`。所有可执行代码统一维护在 [scripts/rover_db.py](scripts/rover_db.py)，工作流仅提供调用示例；只依赖 Python 3 标准库，无需数据库服务或额外依赖。

## Precheck（共用）

1. 按 [resources/connection.md](resources/connection.md) 定位实际数据库并确认文件存在。输出所操作的绝对路径；路径不对时不要创建空库。
2. 查询默认使用只读连接。查看、管理数据库的泛化请求不包含修改授权；用户明确要求修改具体记录时，在已有授权范围内直接执行，不重复确认。
3. 数据与结构以实际数据库为准。关联语义见 [resources/field-cheatsheet.md](resources/field-cheatsheet.md)，需要时核对项目存储层实现。
4. 查询结果默认限制 100 行，大文本按需取出；区分“未找到”与查询失败。备份和导出不放进项目仓库。

## 能力路由

| 用户意图 | 执行工作流 |
|---|---|
| “数据库在哪里”“有哪些表”“task 表有哪些字段” | [references/schema.md](references/schema.md) |
| “最近的任务”“失败的任务”“查看某次对话” | [references/query.md](references/query.md) |
| “备份数据库”“导出这些查询结果” | [references/backup-export.md](references/backup-export.md) |
| “修改这条记录”“删除指定测试数据”“修复任务状态” | [references/write.md](references/write.md) |

## 范围

本 skill 管理本地数据，不提供可视化界面。数据库结构变更应修改项目迁移，再通过正常运行时应用；不要直接编辑 `schema_migrations` 绕过迁移。恢复备份需要明确恢复请求，并停止 Rover、先备份当前库、再使用 SQLite backup API 从选定备份恢复；不要在运行中覆盖主文件或随意删除 WAL 文件。
