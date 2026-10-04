# 修改或修复记录

用户须明确要求修改具体数据；泛化的“管理数据库”仅查询。目标或范围不清楚时先查询澄清；已有明确授权时不重复索要确认。

## 执行前

1. 按 [../resources/connection.md](../resources/connection.md) 核对库路径，查询主键、原始值与预期影响数量。
2. 核对外键、CHECK 约束及 [../resources/field-cheatsheet.md](../resources/field-cheatsheet.md) 的领域关系，阅读相关仓储操作。级联影响包含在授权修改范围中。
3. 停止目标 Rover app/runtime。无法停止或范围无法核对时先完成只读诊断，说明未执行修改的原因。

## 执行

使用 [../scripts/rover_db.py](../scripts/rover_db.py) 的 write 命令。脚本在修改前自动生成并校验备份，再启用外键、开启事务、检查预期直接影响数量与外键完整性，最后提交。备份失败不写入，修改或检查失败回滚。结果或错误包含备份路径。

```bash
python3 .agents/skills/rover-db/scripts/rover_db.py write --sql 'UPDATE task SET status = ?, updated_at = ? WHERE id = ? AND status = ?' --params '["failed", 1791072000000, "目标任务ID", "running"]' --expected-changes 1
```

示例参数需替换为授权任务的实际值，updated_at 使用当前 UTC 毫秒时间。旧值条件用于避免覆盖意外变化。改 task.status 不一定足以完成领域修复，先核对关联事件与摘要。

支持 --sql-file、JSON 数组或对象 --params、--backup-output 指定新备份文件。--expected-changes 必填且表示直接更新行数，不包含触发器或级联；total_changes 包含它们。SQL 一次只能执行一条数据语句，禁止 DDL、PRAGMA、事务控制、ATTACH 和迁移记录修改。

相关表需要同一事务多条修改时使用 `write --batch-file /tmp/rover-write.json`，不要同时传 --params 或 --expected-changes。JSON 文件为非空数组，每项包含 sql、params（可省略，默认空数组）、expected_changes。所有语句共用一次备份和事务，任一数量或约束检查失败则全部回滚。每项 SQL 仍只能包含一条数据语句，不接受 executescript。结构变更走项目迁移流程。

提交后用 query 的独立只读连接再次验证目标与关联记录，报告修改数量、前后值和备份路径。失败先诊断具体原因，再决定重试。
