---
description: 执行指定的任务 ID（如 2.3），按 EPCC-V 流程完成开发
agent: build
---

## 🎯 执行指定任务

请按 iTestAgent 项目 AGENTS.md 的 EPCC-V 流程执行。

### 第一步：定位目标任务
1. 读取 `docs/05-planning/task-status.json`。
2. **如果用户指定了任务 ID**（如 `do-task-itest 3.4`），锁定该任务。
3. **如果用户未指定**：
   - 输出："请指定要执行的任务 ID，如 `do-task-itest 2.3`。"
   - 列出当前阶段所有 `ready` 和 `pending` 状态的任务。
4. **验证任务状态**：
   - 如果任务状态为 `done`，输出："该任务已完成，无需重复执行。"
   - 如果任务状态为 `in_progress`，输出："该任务正在进行中，是否要继续？"
5. **检查依赖**：
   - 确认该任务的所有 `dependencies` 均已标记为 `done`。
   - 如果有未完成的依赖，列出并提示："请先完成依赖任务后再执行。"
6. **级联更新**：将所有依赖已满足的 `pending` 任务翻转为 `ready`。
7. 将任务状态更新为 `in_progress`。

### 第二步：Explore — 查阅文档并引用原文
1. 读取任务 `documents_required` 中的文档章节。
2. 在回复中**逐字粘贴**相关 AC 或规则原文。
3. 如果发现文档问题（矛盾、模糊、不可测），**必须暂停**并先解决。

### 第三步：Plan — 出计划等确认
4. 输出实现计划（改哪些文件/接口/schema/测试）。
5. **等待用户确认**。未经确认不进入编码（R8）。

### 第四步：Code + Check — 小步实现
6. 用户确认后开始编码。遵循：
   - 命名统一 `itestagent-*`，禁止 `qa-*`（R9）
   - 不碰 Apple 私有框架（R1）
   - 不自研已复用底座（R2）
   - 不引入 Effect-TS / SQLite 事件溯源（R10）
   - 不静默降级/臆造指标（R5）
7. TDD 循环：写测试 → `bun test`（红）→ 写实现 → `bun test`（绿）
8. 运行 `bun run typecheck` + `bun run lint`。

### 第五步：Verify — 验证与交付
9. 逐条对齐 AC 自检。
10. 真机能力真机 spike 实测（R3、G5），不确定项显式标注。
11. 更新 `docs/05-planning/task-status.json`：`status` → `done`，更新 `last_updated`。
12. 提示用户执行 `commit-pr-itest` 提交代码。
