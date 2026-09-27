# Rover 开发问题与故障排查记录 (Troubleshooting & Postmortems)

本目录记录 Rover 桌面端与运行时开发过程中遇到的典型问题、排查过程、根本原因与解决方案，避免后续重蹈覆辙，形成工程知识沉淀。

## 记录规范
每次记录包含以下要素：
1. **现象描述 (Symptom)**：外部表现与复现路径；
2. **根因分析 (Root Cause)**：时序、环境、配置或代码层面的底层原因；
3. **解决方案 (Resolution)**：具体改动与修复措施；
4. **教训与防范规约 (Learnings & Guardrails)**：长效工程规范与防范点。

## 归档列表
- [0001: 宠物窗口启动不可见（透明窗口叠加 tRPC Provider 首帧竞态崩溃与 CSS 遗漏）](./0001-pet-window-invisible-trpc-context-race-and-missing-css.md)
