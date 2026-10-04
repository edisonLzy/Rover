# 备份与导出

先按 [../resources/connection.md](../resources/connection.md) 核对路径。使用 [../scripts/rover_db.py](../scripts/rover_db.py)：

```bash
python3 .agents/skills/rover-db/scripts/rover_db.py backup
python3 .agents/skills/rover-db/scripts/rover_db.py backup --output /tmp/rover-backup.db
python3 .agents/skills/rover-db/scripts/rover_db.py export --sql 'SELECT id, goal, agent, status FROM task ORDER BY updated_at DESC' --limit 100 --output /tmp/rover-tasks.csv
```

备份使用 SQLite backup API，包含 WAL 中已提交的数据，并执行 integrity_check；不要复制运行中的主文件。默认目标在 config.backupDirectory 下，带时间和随机标识。指定 --output 的父目录应已存在。所有目标拒绝覆盖已有文件。

导出支持 --sql-file、--params，默认限制 config.queryLimit 行，可用 --limit 调整。结果包含实际输出路径、rows_exported、truncated。CSV 含表头。

失败不报告成功、不继续修改；脚本清理执行失败的部分输出。成功后返回文件绝对路径与范围。备份、导出不写到项目仓库或 skill 的 store。
