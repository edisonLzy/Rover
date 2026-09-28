# 003: Pi 模型配置与 Keychain 凭据桥接

**Status**: TODO  
**Blocked By**: None (*Frontier*)  
**Blocks**: 005, 011  

## Context & Goal
Rover 使用 Pi AI 模型抽象驱动 Rover Agent 回合。根据 [ADR-0004](file:///Users/zhiyu/Desktop/coding/Rover/docs/adr/0004-share-pi-models-json.md)，Rover 与 Pi/Traceability 共用 `~/.pi/agent/models.json`，避免用户重复录入模型提供商与参数；同时需确保文件写入安全、防止覆盖未知字段，并建立与 macOS Keychain 的受限控制通道以安全加载 API 密钥。

## Specification & Invariants
1. **模型配置文件共用与原子操作 (`~/.pi/agent/models.json`)**：
   - 读取时解析为抽象提供商/模型列表，保留所有不认识的未知扩展字段；
   - 写入前比较文件版本或 hash；通过写入临时文件后执行原子替换 (`rename`) 写入；
   - 监听文件系统变动（watch）：外部变更时重新加载；
   - 容错机制：运行中若外部写入损坏 JSON，提示修复并保持内存中上一次有效配置；若启动时文件无效，安全禁用模型调用并报错，严禁在磁盘另外保存可能含明文密钥的文件副本。
2. **凭据安全与 Keychain 桥接**：
   - 允许复用 `models.json` 中已有的 `apiKey`；
   - Rover 专属凭据通过 Rust 宿主写入/读取 macOS Keychain（Service: `com.rover.desktop`）；
   - **绝对凭据隔离**：Node 向 Rust 宿主发起窄控制管道请求获取密钥，密钥仅存在于 Node 进程内存中，严禁在日志打印、严禁通过 tRPC/WebSocket 返回给 React WebView（前端仅能获取 `hasKey: boolean` 状态）。
3. **模型选择与测试 API**：
   - 提供 `GET /v1/models`（返回可用模型列表与当前选中项）；
   - 提供 `PUT /v1/models/selection`（保存用户激活的提供商与模型 ID）；
   - 提供 `POST /v1/models/test`（使用当前配置执行单次受限的 ping / completion 校验可用性）。

## Affected Components & Files
- `packages/runtime/src/models/config.ts`
- `packages/runtime/src/models/storage.ts`
- `packages/runtime/src/models/keychain.ts`
- `packages/runtime/src/models/types.ts`
- `packages/runtime/src/transport/router.ts` (模型路由)
- `src-tauri/src/keychain.rs` (or control message handler in Rust host)
- `packages/runtime/src/__tests__/models.test.ts`

## Acceptance Criteria
- [ ] 能够正确解析合法的 `models.json`，保留已有未知字段并在保存时无损回写。
- [ ] 并发写或临时冲突时不产生截断文件（验证临时文件原子重命名）。
- [ ] 模拟 Keychain 交互，验证 Node 在执行模型调用时可成功取到 Bearer Token，且 API 响应体脱敏。
- [ ] 文件损坏时，内存配置自动降级兜底，给出结构化错误码。

## Verification Plan
```bash
pnpm --filter @rover/runtime test packages/runtime/src/__tests__/models.test.ts
```
