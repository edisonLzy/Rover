# 数据库定位与连接

统一使用 [../scripts/rover_db.py](../scripts/rover_db.py)，只依赖 Python 3 标准库。以下示例从项目根目录执行；其他目录使用脚本绝对路径。配置由脚本相对自身位置读取，不依赖工作目录。

```bash
python3 .agents/skills/rover-db/scripts/rover_db.py path
python3 .agents/skills/rover-db/scripts/rover_db.py --db '/path/to/rover.db' path
```

路径优先级：`--db` → `ROVER_DB_PATH` → [../store/config.json](../store/config.json) 的 databasePath。脚本验证文件存在，所有结果包含实际绝对路径。

运行时逻辑见 `packages/runtime/src/storage/db.ts`，还允许调用方传入 `options.path`。不要认为当前 shell 的环境变量一定与运行中的 Rover 一致；用户指定实例时先核对对应路径。文件不存在时检查路径重写或是否启动过 Rover，不创建空库“试连接”。

查询、结构与备份使用 `mode=ro` 连接，修改使用 `mode=rw`；正常读取 WAL，不用 `immutable=1`。超时与默认数量由 config 的 busyTimeoutMs、queryLimit 控制。连接失败先核对路径、目录权限与错误，不删除 WAL/SHM 文件来绕过。

Rover 正常业务由 Node runtime 写入。直接修复前停止目标 Rover app/runtime；已有授权内可停止明确属于 Rover 的进程，不能误杀其他 Node 应用。无法停止时继续只读诊断并说明写入尚未执行。锁超时先检查仍在运行的写者，不循环重试。
