# 003: 模型配置管理与 Pi AI 契约对齐

**Status**: DONE  
**Blocked By**: None (*Frontier*)  
**Blocks**: 005, 011  

## Context & Goal
Rover 使用 Pi AI 模型驱动抽象（`@mariozechner/pi-ai`）驱动 Rover Agent 回合。根据 [ADR-0015](file:///Users/evan/Desktop/coding/Rover/docs/adr/0015-autonomous-model-config-and-pi-ai-compat.md)，Rover 废弃共用外部 Pi CLI 目录及 Keychain 跨进程桥接的设计，改为在 `~/.rover/models.json` 自主维护模型配置，数据结构 100% 对齐 Pi AI 官方规范。由 Node.js Runtime 负责原子落盘、环境变量解析、连接探测与通过 tRPC 向 Dashboard 提供模型管理接口。

## Specification & Invariants
1. **模型配置文件与原子操作 (`~/.rover/models.json`)**：
   - 默认存储于 `~/.rover/models.json`（支持 `ROVER_MODELS_PATH` 环境变量覆盖）；
   - 文件权限在创建与更新时设为 `0600`（仅当前用户可读写）；
   - 采用临时文件写入 + 原地原子重命名（`atomic rename`），杜绝并发截断或损坏；
   - 容错机制：运行中若文件格式错误，内存降级保持最后有效配置并向 Dashboard 告警；若首次启动文件缺失，自动初始化内置的基础推荐模板。
2. **契约结构 (Pi AI 兼容)**：
   - 定义 Provider 配置（`baseUrl`, `apiKey`, `api: 'openai-completions' | 'anthropic-messages'` 等）与 Model 配置（`id`, `name`, `contextWindow`, `maxTokens`, `cost`, `reasoning`）；
   - 支持当前激活模型配置：`active: { provider: string, model: string }`；
   - 严格保留未知的第三方扩展字段，保证向后与未来版本兼容。
3. **凭据安全与环境变量支持**：
   - `apiKey` 支持明文或环境变量占位符语法（如 `"apiKey": "${OPENAI_API_KEY}"`）；
   - 向前端 Dashboard 返回模型信息时，`apiKey` 必须在服务端完成掩码脱敏（如 `sk-••••••abcd`），严禁泄漏完整明文；
   - 提供 `hasKey: boolean` 状态供前端展示配置就绪指示灯。
4. **tRPC 路由与 Dashboard 管理能力**：
   - `models.getConfig`：获取当前所有 Provider、模型列表及激活模型；
   - `models.setActive`：保存激活模型（`provider` + `modelId`）；
   - `models.saveProvider` / `models.deleteProvider`：新增、修改或移除 Provider 及其模型定义；
   - `models.testConnection`：对指定模型执行轻量级 ping 请求验证连通性与 Key 正确性；
   - `models.importFromPi`：检测宿主机若存在 `~/.pi/agent/models.json`，提供非破坏性的一键读取与合并导入功能。

## Affected Components & Files
- `packages/runtime/src/models/types.ts` (Zod Schema & TS 类型)
- `packages/runtime/src/models/config.ts` (读取、写入、环境变量解析、原子写入、模板初始化)
- `packages/runtime/src/models/importer.ts` (Pi CLI models.json 一键导入)
- `packages/runtime/src/models/tester.ts` (轻量连通性测试)
- `packages/runtime/src/transport/router.ts` (接入 models tRPC 过程)
- `packages/runtime/src/expose.ts` (导出 models 相关类型给前端)
- `packages/runtime/src/__tests__/models.test.ts` (单测)

## Acceptance Criteria
- [x] 能够正确解析符合 Pi AI 规范的 `models.json`，保留未知扩展字段且原子写入正常。
- [x] 支持 `${ENV_VAR}` 占位符解析环境变量，且不存在时平稳降级报错。
- [x] tRPC 返回前端的配置中 API Key 均已脱敏，前端无法获取明文。
- [x] 提供连通性测试接口，在 mock 或受限网络下返回标准状态与耗时。
- [x] 能够成功读取本地已有的 `~/.pi/agent/models.json` 并无缝合并至 Rover 配置。

## Verification Plan
```bash
pnpm --filter @rover/runtime test packages/runtime/src/__tests__/models.test.ts
```
