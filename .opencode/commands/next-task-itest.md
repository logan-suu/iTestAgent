---
description: 找到并执行下一个 ready 任务，按 EPCC-V 流程完成开发
agent: build
---

## 📋 任务：执行下一个 ready 任务

请严格按照 iTestAgent 项目 AGENTS.md 的 EPCC-V 工作流执行：

### 前置检查：Git 状态
0. 执行 `git status --porcelain`，检查是否有未提交的变更。
   - 如果有未提交的变更，输出："检测到未提交的变更，请先处理（提交或暂存）。"

### 第一步：定位任务
1. 读取 `docs/05-planning/task-status.json`
2. **级联更新 pending → ready**：遍历所有阶段中 `status: pending` 的任务，若其 `dependencies` 全部为 `done`，则翻转为 `ready`。
3. 找到当前阶段中第一个 `status: ready` 的任务
4. 如果找不到 ready 任务：
   - 输出："✅ 当前没有待执行的任务。"
   - 检查是否有 `in_progress` 的任务：如果有，询问是否继续该任务。
   - 列出当前阶段的所有任务状态摘要。
5. 确认所有依赖已标记为 `done`
6. 输出任务信息：
   ```
   找到下一个 ready 任务：
   - 任务 ID：[任务ID]
   - 标题：[任务标题]
   - 关联用户故事：[US-XXX]
   - 依赖状态：全部已完成 ✅
   ```
7. **等待用户确认**："是否开始执行该任务？"

### 第二步：查阅文档（EPCC-V: Explore）
1. 读取任务 `documents_required` 中的文档。
2. 读取 AGENTS.md 中相关红线 R1-R11、命名约定（itestagent-*）、技术栈约束。
3. 在回复中**逐字粘贴**相关 AC/规则原文。

### 第三步：出计划等确认（EPCC-V: Plan）
4. 输出实现计划（改哪些文件/接口/schema/测试），等待用户确认。
5. 未经确认不进入编码（R8）。

### 第四步：小步实现（EPCC-V: Code + Check）
6. 用户确认后，将任务状态更新为 `in_progress`。
7. 按 TDD 流程：
   - 编写测试用例
   - 运行 `bun test` 确认失败
   - 编写实现代码
   - 运行 `bun test` 确认通过
8. 运行 `bun run typecheck && bun run lint`。

### 第五步：验证与交付（EPCC-V: Verify）
9. 对齐 AC 逐条自检。
10. 真机相关能力必须真机 spike 实测（R3、G5）。
11. 如涉及重大技术决策或需求变更，新增 ADR 到 `docs/decisions/`（R11）。
12. 更新 `docs/05-planning/task-status.json`：将任务 `status` 改为 `done`，更新 `last_updated`。
13. 提示用户执行 `commit-pr-itest` 提交代码。
