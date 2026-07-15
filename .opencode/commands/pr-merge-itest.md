---
description: 审查并合并已批准的 Pull Request（需人类确认），更新任务状态
agent: build
---

## 🔀 PR 合并

> **核心原则**：合并操作必须由人类手动执行。Agent **在任何情况下都不得调用 `gh pr merge` 或任何合并命令**。本命令仅负责检查合并条件、生成合并建议，并等待人类手动合并。

### 第一步：定位 PR
1. 如果用户提供了 PR 编号，直接使用。
2. 如果未提供，检查当前分支是否有关联 PR。
3. 如果没有 PR，提示："当前分支没有关联的 PR，请先执行 `commit-pr-itest`。"

### 第二步：检查合并前门禁
逐一检查所有条件，**任一不满足即阻断合并**：

1. **CI 检查**：所有 CI 检查通过，无合并冲突。
2. **质量门禁**：
   - G1 规格一致、G2 契约校验、G3 静态检查、G4 测试通过
   - G5 真机验证（涉及真机能力）
   - G7 安全合规
3. **任务状态**：对应任务 `status` 为 `in_progress`（代码已提交、PR 已创建）。如果 `status` 仍为 `ready` 或 `pending`，说明代码尚未提交，阻断合并。

### 第三步：生成合并建议
1. 所有检查通过后，输出合并前检查报告。
2. 建议用户手动合并：
   - **GitHub Web**：点击 "Squash and merge" 按钮
   - **GitHub CLI**（供参考）：`gh pr merge [PR编号] --squash`
   - ⚠️ Agent 不会自动执行合并。

### 第四步：人类确认后更新状态
1. 输出："✅ 合并前检查全部通过。请在 GitHub 上手动合并该 PR。"
2. **仅当用户明确告知"已合并"后**：
   - 执行 `git status --porcelain` 确保工作区无未提交变更（若有则提示暂存/提交后再继续）
   - `git checkout dev-1.0 && git pull origin dev-1.0`
   - 在 dev-1.0 上更新 `docs/05-planning/task-status.json`：
     - 将任务 `status` 从 `in_progress` 更新为 `done`
     - 记录 `last_updated` 时间戳
     - 在 `notes` 中追加 PR 合并确认信息
   - `git add` → `git commit` → `git push origin dev-1.0`
3. 输出："🎉 任务已完成！"
4. 提示用户执行 `/next-task-itest` 开始下一个任务。
