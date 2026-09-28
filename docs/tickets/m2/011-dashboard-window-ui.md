# 011: Dashboard 管理面板完整功能视图

**Status**: TODO  
**Blocked By**: 003, 007, 008, 009  
**Blocks**: None  

## Context & Goal
Dashboard 是 Rover 的全局管理面板，由 macOS 菜单栏图标右键打开。本任务在 React (`packages/app`) 中实现 Dashboard 的四个核心管理功能视图：Skill 目录、模型设置与测试、最近活动流水以及需关注任务筛选，提供用户对 Rover 行为的全局可视与控制权。

## Specification & Invariants
1. **多视图切换架构**：
   - 导航栏集成：Skill 目录、模型配置、最近活动、需关注任务。
2. **Skill 目录视图**：
   - 呈现所有已索引的内置与业务 Skill（名称、说明、来源、状态开关）；
   - 提供「安装本地 Skill」按钮，调用 Tauri 原生文件夹选择器，并将路径提交给 `/v1/skills/install`；
   - 支持开关切换启用状态。
3. **模型配置与连通性测试视图**：
   - 展现来自 `~/.pi/agent/models.json` 的模型列表；
   - 支持设置默认 Provider 与 Model；
   - 提供凭据录入（写入 macOS Keychain）与「测试连接」按钮，直观显示连通延迟与错误信息。
4. **最近活动流水视图**：
   - 按时间倒序拉取 `GET /v1/activities`，呈现已结束任务的目标、产物摘要或 Rover 自主操作；
   - 不呈现普通问答。
5. **需关注任务视图**：
   - 集中筛选处于 `needs_intervention`（等待介入）或 `failed`（失败待核对）状态的 Task；
   - 提供快速接管或查看事件链入口。

## Affected Components & Files
- `packages/app/src/features/dashboard/DashboardWindow.tsx`
- `packages/app/src/features/dashboard/components/SkillCatalog.tsx`
- `packages/app/src/features/dashboard/components/ModelSettings.tsx`
- `packages/app/src/features/dashboard/components/ActivityFeed.tsx`
- `packages/app/src/features/dashboard/components/AttentionTasks.tsx`
- `packages/app/src/__tests__/DashboardWindow.test.tsx`

## Acceptance Criteria
- [ ] 从菜单栏右键能正确打开 Dashboard 并在各 Tab 间平滑切换。
- [ ] 修改模型配置或点击连通性测试能够正确反映成功/失败状态。
- [ ] 切换 Skill 启用开关能即时更新，安装非法 Skill 文件夹时能展示明确错误提示。
- [ ] 需关注任务能够与当前未完成/需介入的 Task 列表实时联动。

## Verification Plan
```bash
pnpm --filter @rover/app test packages/app/src/__tests__/DashboardWindow.test.tsx
pnpm --filter @rover/app dev
```
