# App 拥有内置 Skill，Runtime 加载宿主提供的资源目录

> 状态：已采纳 · 2026-10-03

## 决策

Rover 产品的内置 Skill 由 App 维护，唯一源码目录为
`packages/app/resources/skills/<skill-id>/SKILL.md`。每个 Skill 可以在同一目录中携带
`scripts/`、`references/`、`assets/`，通过相对路径组织相关文件。统一使用大写 `SKILL.md`。

Tauri 的 `bundle.resources` 将整个源码目录映射为安装包资源中的 `skills/`，保留文件层级。
Rust 在开发态传入 App 源码资源目录，在发布态通过 Tauri 的 Resource 路径解析器定位随包目录，
两种启动方式都向 Runtime 传入绝对路径参数 `--skills-dir`。

Runtime 定义加载后的 `SkillDefinition`，负责解析、校验、内存索引和按需读取正文。
它不定位 App 源码、不扫描用户目录、不内嵌产品 Skill 正文，也不在目录缺失时寻找替代来源。
CLI 启动必须提供资源目录；作为库使用时，可以注入目录或 Skill service，也可以使用空的目录索引。
配置目录无法读取、Skill 缺少元数据或正文、名字重复时启动失败。

内置 Skill 直接从 App 资源读取，不复制到用户数据目录。升级随 App 安装包一起交付。
脚本和附件可以随目录携带；本次加载机制不执行脚本。脚本的执行者、解释器、依赖和调用契约
在引入具体脚本能力时另行确定，Skill 文本本身不增加工具权限。

## 一致性验证

- 开发和 SEA 使用同一个 `BuiltinSkillService`，只有宿主传入的根目录不同。
- 单元测试比较源码 loader 和 CJS bundle 在复制后的资源目录中发现的元数据及正文。
- SEA 冒烟在临时工作目录、空 PATH 和独立数据库中启动，逐条比较 `skills.list`、`skills.read`。
- 安装包冒烟必须读取安装包内的资源目录，比较完整文件树的相对路径和 SHA-256，包含脚本和附件。
- 单独运行 SEA 需要显式提供 Skill 资源目录；SEA 自带 Node 运行环境，完整产品交付物为 App 安装包。

## 权衡

目录形式保留 Markdown 的编辑体验，也自然支持脚本、模板和参考文档。App 作为产品能力的拥有者，
负责内容维护和分发；Runtime 保持宿主可配置的读取接口。

资源目录增加了路径传递和安装包完整性检查的责任。通过明确的宿主注入和实际产物检查承担这些责任，
不引入多来源兜底或用户目录副本的升级管理。
