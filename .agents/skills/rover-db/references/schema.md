# 查看路径与表结构

按 [../resources/connection.md](../resources/connection.md) 核对路径，使用 [../scripts/rover_db.py](../scripts/rover_db.py)：

```bash
python3 .agents/skills/rover-db/scripts/rover_db.py path
python3 .agents/skills/rover-db/scripts/rover_db.py tables
python3 .agents/skills/rover-db/scripts/rover_db.py schema --table task
python3 .agents/skills/rover-db/scripts/rover_db.py query --sql 'SELECT version, name, applied_at FROM schema_migrations ORDER BY version'
```

`schema` 不带 `--table` 返回全部 DDL；带表名时返回该表及索引、触发器 DDL、列和外键。表名使用绑定参数处理。不存在的表返回空结构，不自动创建或迁移。

用户只问路径时返回确认过的路径，无需读取全部结构。迁移表不存在时核对库路径与版本，不自动迁移。
