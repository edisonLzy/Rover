# 009: Skill 目录管理与安全安装管道

**Status**: TODO  
**Blocked By**: 001, 006  
**Blocks**: 011  

## Context & Goal
Rover 支持通过 Skill Package 扩展 Agent 的业务流程。为防止恶意 Skill 破坏主机，根据 TRD 4.0 与 6.0，Skill 必须经过严格的路径穿越、软链接检查与 `SKILL.md` 规范校验，并受控复制到受管存储目录；同时提供启用/禁用状态管理。

## Specification & Invariants
1. **Skill 存储与受管目录**：
   - 内置 Skill：打包在 Runtime 内部；
   - 外部业务 Skill：存放在 `~/Library/Application Support/Rover/skills/<skill-id>`。
2. **安全安装管道 (`POST /v1/skills/install`)**：
   - 接收用户选定的外部文件夹绝对路径；
   - **严格安全拦截**：
     - 必须包含合法的 `SKILL.md`（带 YAML Frontmatter，解析 `name` 与 `description`）；
     - 递归检查目录结构，**严禁软链接 (symlink)**，严禁任何形式的路径穿越或父目录逃逸；
   - 受控原子复制整个 Skill 目录至受管目录，计算内容摘要并入库 `skill_install` 表。
3. **Skill 发现与启用管理**：
   - `GET /v1/skills`: 获取全部已安装 Skill 及其状态；
   - `POST /v1/skills/{id}/enabled`: 切换 Skill 的启用/禁用；禁用后依然保留历史关联，仅在 Suggestion 候选与 Prompt 注入时隐藏。

## Affected Components & Files
- `packages/runtime/src/skills/loader.ts`
- `packages/runtime/src/skills/installer.ts`
- `packages/runtime/src/skills/validator.ts`
- `packages/runtime/src/storage/repositories/skills.ts`
- `packages/runtime/src/transport/router.ts` (skills 路由)
- `packages/runtime/src/__tests__/skills.test.ts`

## Acceptance Criteria
- [ ] 尝试安装包含软链接或非法相对路径的文件夹时被坚决拦截并报错。
- [ ] 正常包含 `SKILL.md` 的文件夹能够被完整安全复制至受管目录并登记在库中。
- [ ] 禁用某个 Skill 后，`listSkills` 返回其 `enabled: false`，不进入可用工具列表。

## Verification Plan
```bash
pnpm --filter @rover/runtime test packages/runtime/src/__tests__/skills.test.ts
```
