# Rover 数据库管理

项目级 skill，可通过 `$rover-db` 或自然语言使用：

- `$rover-db 看一下数据库有哪些表`
- `$rover-db 查询最近 20 条失败任务`
- `$rover-db 备份当前数据库`
- `$rover-db 将指定测试任务的状态改为 failed`

默认连接 `~/Library/Application Support/Rover/rover.db`，支持 `ROVER_DB_PATH` 和用户指定路径。查看操作只读；明确授权的记录修改使用备份、外键检查和事务。无需安装第三方依赖，本地需有 Python 3。

```text
rover-db/
├── SKILL.md                  # 入口路由与公共 Precheck
├── README.md                 # 使用说明
├── references/               # 每个能力的具体工作流
│   ├── schema.md
│   ├── query.md
│   ├── backup-export.md
│   └── write.md
├── resources/                # 共享资料
│   ├── connection.md
│   └── field-cheatsheet.md
├── scripts/                  # 所有可执行代码
│   └── rover_db.py            # 路径、结构、查询、备份、导出、事务修改
├── store/
│   └── config.json           # 非敏感默认参数，不保存数据库内容
└── assets/                   # 预留静态资源
```

参考 `fast-log-search-skill` 的目录组织：入口只负责路由，按需读取工作流和共享资料。所有示例从 Rover 项目根目录执行；在其他目录时使用绝对路径。实际数据查询与表结构以当前库为准。

脚本读取相对自身路径的配置，在任意目录均可通过绝对路径调用。运行 `python3 .agents/skills/rover-db/scripts/rover_db.py --help` 查看命令。
