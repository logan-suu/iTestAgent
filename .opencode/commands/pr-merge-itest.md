---
description: 审查并合并已批准的 Pull Request，或确认非代码类任务完成（需人类确认），更新任务状态
agent: build
---

## 🔀 任务完成确认

> **覆盖两类任务**：
> - **代码类**：检查 PR 合并条件，等待人类手动合并后标 done。
> - **非代码类**（spike/research/report）：人类审阅确认后标 done。
>
> **核心原则**：Agent **在任何情况下都不得自动标 done**。代码类依赖人类手动合并 PR，非代码类依赖人类显式确认（AGENTS.md §8.1.3）。

### 第一步：判断任务类型
1. 读取 `docs/05-planning/task-status.json`，定位当前 `in_progress` 任务。
2. 根据 `notes` 和任务标题判断任务类型：
   - 如果 `notes` 中有 PR 链接 → **代码类**，跳到第二步。
   - 如果 `notes` 中有报告/验证/研究产出路径 → **非代码类**，跳到第四步。
   - 如果无法判断，询问用户："该任务是代码类还是非代码类（spike/research/report）？"

### 第二步（代码类）：定位 PR
1. 如果用户提供了 PR 编号，直接使用。
2. 如果未提供，检查当前分支是否有关联 PR。
3. 如果没有 PR，提示："当前分支没有关联的 PR，请先执行 `commit-pr-itest`。"

### 第三步（代码类）：检查合并前门禁
逐一检查所有条件，**任一不满足即阻断合并**：

1. **CI 检查**：所有 CI 检查通过，无合并冲突。
2. **质量门禁**：
   - G1 规格一致、G2 契约校验、G3 静态检查、G4 测试通过
   - G5 真机验证（涉及真机能力）
   - G7 安全合规
3. **任务状态**：对应任务 `status` 为 `in_progress`（代码已提交、PR 已创建）。如果 `status` 仍为 `ready` 或 `pending`，说明代码尚未提交，阻断合并。

### 第四步（代码类）：生成合并建议
1. 所有检查通过后，输出合并前检查报告。
2. 建议用户手动合并（选择任意一种合并方式）：
   - **GitHub Web**：点击 "Merge" 按钮（Merge commit / Squash / Rebase 均可）
   - **GitHub CLI**（供参考）：`gh pr merge [PR编号]`（默认 merge commit，可选 `--squash` / `--rebase`）
   - ⚠️ Agent 不会自动执行合并。

### 第五步（代码类）：人类确认后更新状态
1. 输出："✅ 合并前检查全部通过。请在 GitHub 上手动合并该 PR。"
2. **仅当用户明确告知"已合并"后**：
   - 执行 `git status --porcelain` 确保工作区无未提交变更（若有则提示暂存/提交后再继续）
   - `git checkout dev-1.0 && git pull origin dev-1.0`
   - 在 dev-1.0 上更新 `docs/05-planning/task-status.json`：
     - 将任务 `status` 从 `in_progress` 更新为 `done`
     - 记录 `last_updated` 时间戳
     - 在 `notes` 中追加 PR 合并确认信息（英文；`notes` 作为 commit message 内容，R12 要求对外可见文本使用英文）
   - `git add` → `git commit`（commit message 必须英文，R12） → `git push origin dev-1.0`
3. 输出："🎉 任务已完成！"
4. 跳到第八步执行阶段出口延期待办检查。

### 第六步（非代码类）：展示产出并请求确认
1. 读取任务 `notes` 中的产出路径和结论摘要。
2. 输出确认摘要：
   ```
   📋 [任务ID] [任务标题] — 产出就绪

   - 产出路径：[报告/验证文件路径]
   - 结论摘要：[从 notes 中引用]
   - 当前状态：in_progress → 等待人类确认
   ```
3. 询问用户："该任务产出是否通过审阅？确认后任务将标为 done。"

### 第七步（非代码类）：人类确认后更新状态
1. **仅当用户明确告知"确认"后**：
   - 执行 `git status --porcelain` 确保工作区无未提交变更
   - 更新 `docs/05-planning/task-status.json`：
     - 将任务 `status` 从 `in_progress` 更新为 `done`
     - 记录 `last_updated` 时间戳
     - 在 `notes` 中追加人类确认信息（英文；`notes` 作为 commit message 内容，R12 要求对外可见文本使用英文）
   - `git add` → `git commit`（commit message 必须英文，R12） → `git push origin dev-1.0`
2. 输出："🎉 任务已完成！"
3. 跳到第八步执行阶段出口延期待办检查。

### 第八步（通用）：阶段出口延期待办检查

> 当完成任务是**该阶段的集成测试任务**时（即任务 ID 等于 `task-status.json` 中对应 phase 的 `integration_test` 字段值），必须执行此检查。

1. 读取 `docs/05-planning/task-status.json`
2. 根据当前任务的 `id` 推断所属阶段（取 `id` 中 `.` 前的数字），或遍历 `phases` 找到包含该任务的 phase
3. 判断当前任务 ID 是否等于该 phase 的 `integration_test` 字段：
   - **不相等** → 跳过此检查
   - **相等** → 执行以下步骤
4. 读取 `docs/05-planning/deferred-items.json`
5. 筛选 `target_phase` 等于当前阶段且 `status: "open"` 的条目
6. 逐条检查是否已被该阶段的其他任务顺便修复：
   - **已修复** → 更新 `status` 为 `resolved`，填写 `resolved_by`（commit hash 或任务 ID）。**不得删除条目**（R14 审计轨迹）。
   - **未修复** → 保持 `open`，评估是否提升 `target_phase` 到下一阶段
7. 输出报告：
   ```markdown
   ## 📋 Phase N 延期待办复查
   | DEF-ID | 内容 | 状态 | 处理 |
   |---|---|---|---|
   | DEF-001 | xxx | ✅ 已修复 | 3.5 顺便完成 (commit abc) |
   | DEF-002 | yyy | ⏳ 延期 | target_phase: 3 → 4 |
   ```
8. 如有变更，提交 `deferred-items.json` 更新并 `git push origin dev-1.0`
9. 如果不是集成测试任务：提示用户执行 `/next-task-itest` 开始下一个任务。
