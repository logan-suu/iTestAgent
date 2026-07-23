---
description: 提交当前代码变更，推送到远程仓库，并创建 Pull Request
agent: build
---

## 🚀 提交代码与创建 PR

### 第一步：前置检查（强制门禁）
0. **分支检查与创建**：禁止直接在 `main` 或 `dev-1.0` 提交 PR 代码。
   - 执行 `git branch --show-current`，获取当前分支名。
   - 如果当前分支是 `main` 或 `dev-1.0`：
     - 根据变更内容推断 `{type}`（feat/fix/docs/refactor/chore）和 `{description}`（简短英文，kebab-case）。
     - 执行 `git checkout -b {type}/{description}` 创建新功能分支（AGENTS.md §3.1.1）。
     - 输出："已创建分支 `{type}/{description}`，继续提交。"
   - 如果已在功能分支上，跳过此步骤。
1. **Git 状态检查**：
   - 执行 `git status`，确认有变更可提交。
   - 如果没有变更，输出："当前没有可提交的变更。"并退出。
   - 执行 `git branch --show-current`，获取当前分支名。
2. **延期待办检查**（防止 🟡 警告遗漏，R14）：
   - 读取 `docs/05-planning/deferred-items.json`。
   - 检查是否有 `status: "open"` 且 `task` 等于当前任务 ID 的条目。
   - 如果没有 open 条目：✅ 合规，继续。
   - 如果存在 open 条目：
     - ⚠️ 这些条目已被确认无法在当前 PR 修复（外部依赖/跨 Phase 协调/风险过大）。
     - 输出提醒并确认已记录（不阻塞 commit）。
   - ⚠️ **自行检查**：如果在实现过程中发现了与文档/架构的偏离或设计权衡：
     - **默认优先在当前 PR 修复**。仅当修复确实不可行（外部依赖、跨 Phase 协调、改动过大）时，才延期留档。
     - 延期项必须在 commit 前**立即写入** `deferred-items.json`（`source: "Sisyphus (self-review)"`，AGENTS.md §8.1.5 R14）。
     - 不得留到 `pr-review-itest` 时才记录。
   - **如果当前任务刚完成 `pr-review-itest` 且审查报告或自行检查中有延期项**尚未写入 deferred-items.json：
     - ❌ **阻断 commit** — 必须先通过 `pr-review-itest` 第五步之半写入 deferred-items.json。
     - 输出："❌ 有 N 条延期项未记录到 deferred-items.json，请先执行 pr-review-itest 完成留档。"
3. **运行质量门禁 G1-G4**：
   - G1 规格一致：确认实现与文档不冲突
   - G2 契约校验：产物过 schema（plan/result/artifact-index/project-profile）
   - G3 静态检查：`bun run typecheck` + `bun run lint` 通过
   - G4 测试通过：`bun test` 全绿
4. **证据留档**（G6）：自检报告逐条对 AC，不确定项显式标注
5. **真机能力**（G5）：涉及真机能力必须已真机 spike 实测；Simulator 能力必须 G5-SIM。非代码 Spike 报告产出至 `docs/06-verification/`。
6. **安全合规**（G7）：无敏感数据落盘明文

### 第二步：Git 提交
1. 提交信息格式遵循仓库风格（**R12：全部用英文，AGENTS.md §3.1.4**）：
   ```
   {type}({scope}): {description}

   - change 1 (in English)
   - change 2 (in English)

   Related: US-X.Y
   ```
2. 常用 type：`feat`、`fix`、`docs`、`test`、`refactor`、`chore`
3. scope 使用组件名（如 `cli`、`tui`、`engine`、`backends`、`store`）
4. 确保不提交 secrets、.env、token 等敏感文件（R6）

### 第三步：创建 PR
1. 推送代码：`git push -u origin [分支名]`
2. 创建 PR，**base 分支为 `dev-1.0`**（非 `main`，AGENTS.md §3.1.1）：
   ```bash
   gh pr create --base dev-1.0 --title "{type}({scope}): {description} [US-X.Y]" --body "..."
   ```
   **R12 约束**：PR 标题和 body 必须全部用英文（`[US-X.Y]` 编号可保留）。
3. PR 描述（英文）包含 AC 覆盖对照表。
4. 记录 PR 编号和链接。

### 第四步：更新任务状态
1. **保持当前任务的 `status` 为 `in_progress`** — 任务在 PR 合并后才设为 `done`（由 `pr-merge-itest` 命令处理）。
2. 在 `docs/05-planning/task-status.json` 中当前任务的 `notes` 字段记录：
   - PR 编号和链接（从第三步获取）
   - 简要实现摘要
3. 记录 `last_updated` 时间戳。
4. ⚠️ **不得在此步骤将 `status` 设为 `done`**。PR 合并由人类手动执行（AGENTS.md §9.3），合并后通过 `pr-merge-itest` 命令设为 `done`。
