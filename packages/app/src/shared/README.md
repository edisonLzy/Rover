# Shared

该目录用于存放需要在多个 Tauri WebView 之间共享的状态，以及对应的类型、读写接口和 React Hooks。

例如，`preferences/pet.ts` 管理 Dashboard 和 Pet 窗口共同使用的宠物偏好设置。

各 WebView 的 JavaScript 内存相互独立。共享状态应通过 Tauri Store 等机制持久化和同步；导入同一个模块并不意味着共享同一个内存实例。

仅供某个界面使用的组件、交互逻辑和局部状态，应放在对应的 `features` 模块中。
