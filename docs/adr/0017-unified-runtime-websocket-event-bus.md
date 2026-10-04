# 运行时事件类型安全契约与统一 WebSocket 事件总线

> 状态：已采纳 · 2026-10-04

## 决策背景

在之前的实现中，前端多个功能模块（如 `PetWindow`、`Dashboard/history`、`Dashboard/probe`）各自通过 `new RoverWebSocketClient` 独立建立与 Runtime 的 WebSocket 长连接，且事件结构缺乏统一的类型约束：
1. **多连接资源冗余**：子组件无法就近按需订阅事件，各自建连导致对本地 Runtime 产生多条无谓的长连接；若在顶层统一接收又退化为逐层通过 Props 深度转发。
2. **事件缺乏强类型约束**：广播事件仅为松散的字符串类型与非受控 payload，难以在消费时提供编译期属性检查与智能补全。
3. **缺少错误隔离**：单次回调若抛出未捕获异常，会中断后续逻辑。

## 架构决策

### 1. Runtime 侧建立 Zod 驱动的类型安全事件契约
- 在 `packages/runtime/src/types/events.ts` 中使用 Zod 统一定义所有运行时广播事件的 Payload Schema（包含 `system.ready`、`turn.started`、`turn.delta`、`turn.end`、`task.changed`、`rover.entry.appended` 等）。
- 通过 `z.infer` 推导出纯 TypeScript 类型，并在 `packages/runtime/src/expose.ts` 中导出 `RuntimeEventType`、`RuntimeEventMap`、`RuntimeEventEnvelope` 与 `RuntimeEventHandlers`。
- 前端只导入纯类型契约，维持服务端 Node 依赖与前端 WebView 的绝对隔离（Zero Runtime Bundle Overhead）。

### 2. RoverWebSocketClient 升级为多订阅者事件总线
- `RoverWebSocketClient` 增加基于 `Map<RuntimeEventType, Set<Listener>>` 的事件路由；
- 提供对象式批量注册方法：`registerEventHandler(handlers: RuntimeEventHandlers): () => void`。传入以事件名为键的处理器字典，返回单个无参清理函数，完美匹配 `useEffect` 的 cleanup 返回值；
- 派发事件时对每个订阅者采用 `try-catch` 异常隔离，防止单个业务组件报错阻断其他订阅者；
- 支持 `setConnection(url, token)` 动态更新目标凭据，保持 Client 实例在组件树中的引用稳定性（Stable Reference），使得订阅者即使在挂载时（`[]`）注册监听，也不会因重连而丢失。

### 3. 直接通过现有的 RuntimeContextValue 注入
- 不引入多余的独立 Context 或深层 Provider 嵌套，直接扩充现有的 `RuntimeContextValue`：
  ```typescript
  interface RuntimeContextValue {
    connection: RuntimeConnectionInfo | null;
    loading: boolean;
    error: string | null;
    refreshConnection: () => Promise<void>;
    restartRuntime: () => Promise<void>;
    wsClient: RoverWebSocketClient;
  }
  ```
- 子组件消费统一、简洁、无额外封装：
  ```typescript
  const { wsClient } = useRuntime();

  useEffect(() => {
    return wsClient.registerEventHandler({
      'turn.delta': (payload) => { ... },
      'task.changed': (payload) => { ... },
    });
  }, [wsClient]);
  ```

## 权衡与收益

- **单一事实来源**：Runtime 服务端广播与前端消费完全遵循同源 Zod 推导类型，杜绝类型漂移。
- **单连接多路复用**：整个窗口内仅维持单一活跃 WebSocket 连接，多组件按需注册与销毁监听。
- **API 极简直观**：无需学习额外 Hook，直接从 `useRuntime()` 获取 `wsClient` 并在 `useEffect` 中声明式注册，自动清理。
