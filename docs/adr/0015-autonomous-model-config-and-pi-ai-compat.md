# Rover 自主维护模型配置并兼容 Pi AI 契约

> 状态：已采纳 · 2026-10-02
>
> 完全替代 [ADR-0004](./0004-share-pi-models-json.md)：废弃与外部 Pi CLI 共用 `~/.pi/agent/models.json` 及经由 Rust 桥接 macOS Keychain 的设计；Rover 采用自主模型配置 `~/.rover/models.json`，数据结构完全对齐 Pi AI 规范，并在 Dashboard 中实现闭环管理。

## 背景

Rover Agent 输入回合引擎（Ticket 005）需要调用底层大语言模型完成意图理解、工具派发与即时答复。Rover 规划选用 Pi AI 的模型驱动抽象（`@mariozechner/pi-ai`）。

在 [ADR-0004](./0004-share-pi-models-json.md) 中，原设计设想通过直接读写外部 Pi CLI 的目录 `~/.pi/agent/models.json` 来避免用户重复录入模型提供商与 API Key，并规划将专属凭据存入 macOS Keychain，由 Rust 宿主建立受限控制通道向 Node.js Runtime 传递。

经过系统工程实践与审视，原方案暴露出严重的架构缺陷：
1. **外部工具强耦合与侵入性**：强行依赖外部 Pi CLI。若用户电脑未安装 Pi CLI，Rover 启动需反向创建 `~/.pi/agent/` 目录，权责模糊；若两个应用并发读写，极易发生文件覆盖与格式冲突。
2. **缺乏双向 IPC 管道导致的严重过度设计**：
   - 当前 Rover 的 Tauri Rust 宿主与 Node.js sidecar 之间仅有单向启动检测握手（Node 在 stdout 输出 `[READY] port=... token=...`，Rust 仅捕获就绪并打印日志），**不存在双向请求-响应的 IPC 管道**；
   - 若为了读取一个 `apiKey` 字符串而额外研发一套跨语言的双向 JSON-RPC / UDS 管道，不仅系统复杂度陡增，而且**会导致无 Tauri 宿主的浏览器 Dev 模式（`pnpm dev`）以及 Node 单元测试完全无法运行模型调用**；
3. **Keychain 频繁弹窗的负面体验**：本地未签名调试包（Debug 阶段）访问 macOS Keychain 极易触发系统密码输入弹窗，严重阻碍开发迭代与日常体验。

主流个人开发与 Agent 工具（如 Pi CLI、Claude Code CLI、Aider、OpenCode）均直接采用本地用户家目录下受权限保护的配置文件或环境变量来管理模型 API Key。

## 决策

### 1. 配置自主化与存放路径
Rover 自主维护专属模型配置文件，存储在 `~/.rover/models.json`。
- 由 Node.js Runtime 统一负责该配置文件的读取、校验与原子写入；
- Node Runtime 在创建与写入该文件时，将文件权限严格设为 `0600`（仅当前 macOS 登录用户具备读写权限）；
- 支持通过环境变量 `ROVER_MODELS_PATH` 覆盖此路径，便于集成测试与环境隔离。

### 2. 数据结构 100% 兼容 Pi AI
配置文件严格对齐 Pi AI 官方模型目录契约（包含 `providers` 映射与当前激活的 `active` 模型指针）：

```json
{
  "active": {
    "provider": "minimax",
    "model": "MiniMax-M2.7-highspeed"
  },
  "providers": {
    "minimax": {
      "baseUrl": "https://api.minimaxi.com/anthropic",
      "apiKey": "sk-...",
      "api": "anthropic-messages",
      "models": [
        {
          "id": "MiniMax-M2.7-highspeed",
          "name": "MiniMax-M2.7-highspeed",
          "reasoning": false,
          "input": ["text"],
          "contextWindow": 1000000,
          "maxTokens": 16384
        }
      ]
    },
    "deepseek": {
      "baseUrl": "https://api.deepseek.com/v1",
      "apiKey": "sk-...",
      "api": "openai-completions",
      "models": [
        {
          "id": "deepseek-chat",
          "name": "DeepSeek V3",
          "reasoning": false,
          "contextWindow": 64000,
          "maxTokens": 8192
        }
      ]
    }
  }
}
```

- **保留未知字段**：读取和回写时保留未定义的扩展字段，确保向后兼容；
- **原子写入**：修改时先写入临时文件，再通过 `rename` 执行原子替换，防止写操作中断截断。

### 3. API Key 凭据安全与环境变量支持
- **文件直接存储**：API Key 允许直接以明文保存于权限为 `0600` 的 `~/.rover/models.json` 中；
- **环境变量占位符支持**：支持配置形如 `"apiKey": "${DEEPSEEK_API_KEY}"` 的语法；Node Runtime 在装配模型客户端时，优先解析对应的环境变量；若环境变量未定义则读取文件配置的静态 Key；
- **废弃 Keychain 桥接**：移除 Rust 端的 Keychain 绑定与跨进程控制消息，彻底消除双向 IPC 负担；
- **前端脱敏传输**：通过 tRPC 向前端 Dashboard 返回模型配置时，`apiKey` 必须做脱敏保护（如 `sk-••••••abcd`），避免密钥泄露至浏览器控制台或 DevTools。

### 4. Dashboard 闭环管理与一键导入
- 在 Dashboard 的「模型配置」Tab 中提供完整可视化 CRUD：展示已配提供商、新增/编辑模型参数、选择当前默认模型、执行单次 ping 测试连通性；
- **一键从 Pi CLI 导入**：若检测到宿主机存在 `~/.pi/agent/models.json`，在 Dashboard 提供「从 Pi CLI 导入」功能，非破坏性地复制并合并到 `~/.rover/models.json`，平滑满足免录入诉求。

## 后果与权衡

### 正面收益
1. **彻底解耦**：Rover 拥有独立的数据资产与生命周期，不依赖、不破坏任何外部 CLI 工具；
2. **极简架构**：消除了复杂的双向父子进程 IPC 管道与 macOS Keychain 跨进程调用，减少数百行胶水代码；
3. **环境表现完全一致**：无论在 Tauri 完整桌面环境、纯浏览器开发模式（`pnpm dev`）、还是在 Vitest 自动化测试中，模型加载逻辑 100% 一致可用；
4. **与 Pi AI 零阻抗**：配置结构直接映射为 Pi AI 客户端入参，为 Ticket 005（Pi Agent Loop）的实施扫清障碍。

### 权衡与取舍
- **本地安全性考量**：API Key 落在本地磁盘文件 `~/.rover/models.json` 中。由于文件权限被系统保护为 `0600`，且该配置属于本地单用户工作站环境，此安全等级与目前行业主流的 Coding CLI（Claude Code, Pi, Aider）完全持平，是个人桌面助理在安全与开发体验之间的合理平衡。
