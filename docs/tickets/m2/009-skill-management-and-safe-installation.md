# 009: 内置 Skill 发现与加载机制

**Status**: TODO  
**Blocked By**: 001, 006  
**Blocks**: 011  

## Context & Goal
为收敛 MVP 复杂度并彻底规避外部脚本/动态加载的安全风险，系统维持 `Skill` 的原语，但所有 Skill 均作为内置能力随 Rover 源码和运行时一起打包提供（内置 `agent-dispatch`、`task-recall`、`pet-task-state`、`scheduled-task` 等），暂不引入外部动态安装管道及 `skill_install` 数据库表。本任务负责内置 Skill 的静态加载、元数据解析，以及向 Rover Agent Loop 与前端输入栏提供只读发现接口。

## Specification & Invariants
1. **内置 Skill 打包与组织**：
   - 随 Runtime 固化在 `packages/runtime/src/skills/builtin/<skill-id>/`；
   - 每个 Skill 包含合规的 `SKILL.md`（带 YAML Frontmatter，定义 `name` 与 `description`），正文为标准 SOP 流程指引。
2. **只读加载器与内存索引 (`loader.ts`)**：
   - Runtime 启动时同步读取并解析内置 Skill 的 Frontmatter 与指令正文，构建内存缓存；
   - 零文件拷贝，零符号链接风险，不向外部开放任意文件系统写入。
3. **Skill 发现与接口暴露**：
   - `GET /v1/skills`: 返回当前可用的内置 Skill 列表（`id`, `name`, `description`, `source: "builtin"`, `isEnabled: true`），供 Dashboard（Ticket 011）展示以及 Tiptap 输入栏（Ticket 002）进行 `/skill` 自动联想；
   - 受控工具 `list_skills`: 在 Pi Agent Loop 中供 Rover Agent 读取当前可用 Skill，以便向用户推荐或组装派发提示词。
4. **架构边界**：
   - 不引入 `skill_install` 数据表；
   - 不支持 `POST /v1/skills/install` 外部路径安装，杜绝外部恶意脚本/软链接执行风险。

## Affected Components & Files
- `packages/runtime/src/skills/builtin/`
- `packages/runtime/src/skills/loader.ts`
- `packages/runtime/src/skills/types.ts`
- `packages/runtime/src/transport/router.ts` (skills 路由)
- `packages/runtime/src/__tests__/skills.test.ts`

## Acceptance Criteria
- [ ] 随包内置的核心 Skill（如 `agent-dispatch`、`task-recall`）能够被正确解析 Frontmatter 元数据。
- [ ] `GET /v1/skills` 接口能正确返回只读内置 Skill 列表。
- [ ] Rover Agent 调用的 `list_skills` 工具能够正确获取这些内置 Skill 描述与流程指引。
- [ ] 运行时完全不依赖外部文件系统动态扫描或 `skill_install` 数据库表。

## Verification Plan
```bash
pnpm --filter @rover/runtime test packages/runtime/src/__tests__/skills.test.ts
```

