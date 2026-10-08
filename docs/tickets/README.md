# Rover 研发任务管理 (Tickets)

本项目遵循 Matt Pocock 的 **Tracer-Bullet Tickets** 方法论，按版本里程碑（Milestone）组织各阶段的研发任务。

## 里程碑目录

- **[M2: Rover 核心 (Rover Core)](./m2/README.md)**：Pi Agent 回合、模型配置、受控工具、Skill 安装、Tiptap 输入栏、Task 事务创建与事件投影、摘要回忆、最近活动、窗口 UI。
- **[M3: 定时与 Inbox (Inbox Service & Schedulers)](./m3/README.md)**：Inbox 统一收件箱、Provider 驱动抽象、企业微信智能机器人长连接、动态开关与凭证脱敏、排查 SOP 派发。
- _M4: 可安装包与多架构发布（规划中）_

---

## Tracer-Bullet Ticket 规范与目录结构要求

为保证每个任务切片职责单一、边界清晰，并防止在实现过程中随意散落创建文件或过度封装，所有 Ticket 均须遵循以下规范：

### 1. 核心章节规范

每个工单需包含以下五个标准章节：

- **Context & Goal**：阐述所属 ADR 决策、设计背景与本次任务的明确目标。
- **Specification & Invariants**：核心技术契约、不变条件与防劣化约束。
- **Affected Components & Directory Structure**：明确的目录结构树与文件变动清单（**强制要求**）。
- **Acceptance Criteria**：可逐项验收的准则清单（Checklist）。
- **Verification Plan**：可重复执行的验证命令（如 Vitest 运行命令）。

### 2. 目录结构树（Directory Tree）硬性规范

在 `Affected Components & Directory Structure` 章节中：

1. **必须包含 ASCII 目录结构树**：
   严禁仅写散落的文件名列表或模糊的文字描述，必须使用清晰的 ASCII 树形图展示本次任务涉及的各层级目录与文件布局。
2. **强制标注文件操作状态**：
   - `+ [New]`：本次任务新增的文件（需简要注释其单一职责）。
   - `* [Modified]`：本次任务修改的既有文件（需注明改动范围）。
   - `- [Deleted/Moved]`：本次任务废弃、删除或迁移的文件。
3. **精准路径与单工单边界**：
   所有路径必须相对于包根目录或工作区根目录（如 `packages/runtime/src/agent/...`）。禁止在开发过程中随意跳出该目录树创建未经规划的文件。
4. **禁止滥建 Barrel Export 文件**：
   严禁在内部子目录随意建立 `index.ts` 进行全量重导出（`export *`）。代码应直接从具体源文件按需引用，避免循环依赖与模块边界模糊。

#### 标准目录结构树示例

```text
packages/runtime/
├── src/
│   ├── __tests__/
│   │   └── + [New] agent_runtime.test.ts          # 纯内存环境下的单元与集成测试
│   └── agent/
│       ├── * [Modified] index.ts                 # 公共入口导出 (仅导出具体模块，禁止中间 barrel)
│       ├── + [New] runtime.ts                    # AgentRuntime 纯领域核心实现
│       └── + [New] types.ts                      # AgentRuntimeEventCallbacks 与 Context 核心契约
```
