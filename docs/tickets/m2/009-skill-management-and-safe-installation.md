# 009: 内置 Skill 发现与加载机制

**Status**: DONE  
**Blocked By**: 001, 006  
**Blocks**: 011

## Context & Goal

为收敛 MVP 复杂度并彻底规避外部脚本/动态加载的安全风险，系统维持 `Skill` 的原语，但所有 Skill 均作为内置能力随 Rover App 安装包提供（内置 `agent-dispatch`、`task-recall`、`pet-task-state`、`scheduled-task` 等），暂不引入外部动态安装管道及 `skill_install` 数据库表。本任务负责内置 Skill 的静态加载、元数据解析，以及向 Rover Agent Loop 与前端输入栏提供只读发现接口。

## Specification & Invariants

1. **内置 Skill 打包与组织**：
   - 由 App 维护，唯一源码为 `packages/app/resources/skills/<skill-id>/SKILL.md`，决策见 [ADR-0016](../../adr/0016-app-owned-builtin-skills.md)；
   - Tauri resources 保留整个目录结构，允许随 Skill 携带 `scripts/`、`references/`、`assets/`；
   - 每个 Skill 包含合规的 `SKILL.md`（带 YAML Frontmatter，定义 `name` 与 `description`），正文为标准 SOP 流程指引。
2. **只读加载器与内存索引 (`skill-service.ts`)**：
   - Rust 开发态传入源码资源目录，发布态解析 App Resource 目录，统一使用 `--skills-dir=<绝对路径>`；
   - Runtime 使用同一加载器同步读取 Frontmatter 与正文并构建内存缓存，不猜测 App 或源码位置，不提供 SEA 正文宏兜底；
   - 配置目录缺失、元数据无效或名称重复时明确报错，不静默降级；
   - 直接读取随包资源，不复制到用户目录；不接受 Skill 目录或 SKILL.md 符号链接，不向外部开放文件系统写入。
3. **Skill 发现与接口暴露**：
   - `skills.list`（受鉴权 tRPC query）返回内置 Skill 列表（`id`, `name`, `description`, `source: "builtin"`, `isEnabled: true`），供 Dashboard（Ticket 011）展示以及 Tiptap 输入栏（Ticket 002）进行 `/skill` 自动联想；
   - `skills.read`（受鉴权 tRPC query）按名称返回正文；模型通过 `read_skill` 受控工具按需读取；
   - 提示词感知集成：通过 `SystemPromptService` 将可用 Skill 的名称、描述与触发约定直接注入 Rover Agent 系统提示词（内置认知），无需额外消耗 Tool Call 轮次。
4. **架构边界**：
   - 不引入 `skill_install` 数据表；
   - 不支持 `POST /v1/skills/install` 外部路径安装，杜绝外部恶意脚本/软链接执行风险。
   - 携带脚本不等于执行脚本；执行环境和受控调用契约在引入具体脚本时另行设计。

## Affected Components & Files

- `packages/app/resources/skills/`
- `packages/app/src-tauri/tauri.conf.json` (resources 映射)
- `packages/app/src-tauri/src/sidecar.rs` (资源路径注入)
- `packages/runtime/src/agent/skills/skill-service.ts`
- `packages/runtime/src/index.ts` (`--skills-dir`)
- `packages/runtime/src/transport/router.ts` (skills 路由)
- `packages/runtime/src/__tests__/skills.test.ts`

## Acceptance Criteria

- [x] 随包内置的核心 Skill（如 `agent-dispatch`、`task-recall`）能够被正确解析 Frontmatter 元数据。
- [x] `skills.list` 接口能正确返回只读内置 Skill 列表。
- [x] 系统启动时 `SystemPromptService` 能够正确加载内置 Skill 描述并注入至 Agent 系统提示词中。
- [x] 只扫描宿主注入的 App 资源目录，不扫描用户目录、不使用源码兜底或 `skill_install` 数据库表。
- [x] 开发 loader、CJS bundle 和 SEA 对同一资源树返回相同列表和正文；安装包中全部资源文件与源码一致。

## Verification Plan

```bash
pnpm --filter @rover/runtime test src/__tests__/skills.test.ts src/__tests__/engine_tools.test.ts src/__tests__/transport.test.ts
pnpm build:sea
pnpm smoke:sea
# Tauri 打包后校验安装包中的资源
pnpm --filter @rover/runtime smoke:sea --packaged
```
