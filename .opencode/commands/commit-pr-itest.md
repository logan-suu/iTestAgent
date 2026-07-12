---
description: 提交当前代码变更，推送到远程仓库，并创建 Pull Request
agent: build
---

## 🚀 提交代码与创建 PR

### 第一步：前置检查（强制门禁）
1. **Git 状态检查**：
   - 执行 `git status`，确认有变更可提交。
   - 如果没有变更，输出："当前没有可提交的变更。"并退出。
   - 执行 `git branch --show-current`，获取当前分支名。
2. **运行质量门禁 G1-G4**：
   - G1 规格一致：确认实现与文档不冲突
   - G2 契约校验：产物过 schema（plan/result/artifact-index/project-profile）
   - G3 静态检查：`bun run typecheck` + `bun run lint` 通过
   - G4 测试通过：`bun test` 全绿
3. **证据留档**（G6）：自检报告逐条对 AC，不确定项显式标注
4. **真机能力**（G5）：涉及真机能力必须已真机 spike 实测
5. **安全合规**（G7）：无敏感数据落盘明文

### 第二步：更新任务状态
1. 将 `docs/05-planning/task-status.json` 中当前任务的 `status` 更新为 `done`。
2. 记录 `last_updated` 时间戳。

### 第三步：Git 提交
1. 提交信息格式遵循仓库风格：
   ```
   {type}({scope}): {description}

   - 具体变更1
   - 具体变更2

   Related: US-X.Y
   ```
2. 常用 type：`feat`、`fix`、`docs`、`test`、`refactor`、`chore`
3. scope 使用组件名（如 `cli`、`tui`、`engine`、`adapters`、`store`）
4. 确保不提交 secrets、.env、token 等敏感文件（R6）

### 第四步：创建 PR
1. 推送代码：`git push -u origin [分支名]`
2. PR 标题：`{type}({scope}): {description} [US-X.Y]`
3. PR 描述包含 AC 覆盖对照表。
4. 输出 PR 链接。
