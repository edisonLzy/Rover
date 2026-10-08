# 查询记录

先按 [../resources/connection.md](../resources/connection.md) 定位，按需查看 [../resources/field-cheatsheet.md](../resources/field-cheatsheet.md) 与实时结构。使用 [../scripts/rover_db.py](../scripts/rover_db.py) 的只读 query 命令。

```bash
python3 .agents/skills/rover-db/scripts/rover_db.py query --sql 'SELECT id, goal, agent, status, updated_at FROM task WHERE status = ? ORDER BY updated_at DESC' --params '["failed"]' --limit 20
python3 .agents/skills/rover-db/scripts/rover_db.py query --sql 'SELECT id, goal, agent, status FROM task WHERE id = ?' --params '["目标任务ID"]'
```

复杂 SQL 存到临时文件，用 `--sql-file /tmp/rover-query.sql` 代替 `--sql`。脚本只接受单条 SQL，`--params` 支持 JSON 数组或对象；不要将用户文本拼到 SQL 中。命令参数使用工具结构化输入或正确 shell 引号。

将自然语言转为明确的条件、排序和选列。默认返回 config.queryLimit 行，结果 truncated 表示是否还有更多；可用 --limit 调整。统计用 COUNT/GROUP BY，不从截断结果推断总量。大文本按需取出。

解释结果注明时间范围、数量、截断情况；空结果明确说未找到，查询失败不能说数据库为空。结构不匹配先核对实时表结构；锁超时检查写者。
