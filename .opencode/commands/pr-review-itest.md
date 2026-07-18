---
description: 基于 iTestAgent 架构规约对当前 PR 进行 AI 预审 + 处理 PR 评论，输出风险清单
agent: build
---

## 🔍 PR 架构预审

请按 iTestAgent 项目 AGENTS.md 的质量门禁 G1-G7 对当前 PR 进行审查：

### 第一步：获取变更
1. 确定 PR 编号（用户提供或自动检测当前分支）。
2. 使用 `git diff` 或 GitHub API 获取变更文件列表。
3. 仅审查新增或修改的文件，忽略纯数据/资源文件。

### 第二步：架构合规检查（核心）
按以下清单逐一扫描变更代码：
1. **红线检查（R1-R11）**：
   - R1：是否碰了 Apple 私有框架？
   - R2：是否自研了已复用底座（WDA/Appium/xcodebuild）？
   - R5：是否静默降级/臆造指标？
   - R6：是否有敏感数据落盘明文？
   - R9：命名是否统一 `itestagent-*`？
    - R10：是否引入了 Effect-TS / SQLite 事件溯源？
    - R12：commit/PR/评论/代码注释是否全部使用英文（AGENTS.md §3.1.4）？
2. **架构分层**：上层是否反向依赖了下层？engine 是否直接拼了命令（应经 backend 接口）？
3. **复用策略**：是否复用了既定库（AI SDK/MCP/Appium/Drizzle 等）？
4. **EPCC-V**：是否遵循了 Plan→Code→Check→Verify？

### 第三步：上下文验证
1. 对关键文件进行逐项检查。
2. 验证代码逻辑是否与相关 AC 描述一致。
3. 检查 CI 状态。

### 第四步：输出报告
每条问题包含：
- **风险等级**：🔴 严重（违反红线/G1-G7） / 🟡 警告 / ✅ 合规
- **问题描述**：具体违反了哪条规约
- **文件位置**：`文件名:行号`
- **修改建议**：具体的代码修改示例
- **关联规约**：引用 AGENTS.md 中的章节编号

### 第五步：审查结论
- **阻断项（🔴）**：存在任何 🔴 项 → "❌ 审查未通过，建议拒绝合并。"
- **警告项（🟡）**：仅存在 🟡 项 → "⚠️ 审查有条件通过，建议修复警告后再合并。"
- **全部合规（✅）**："✅ 审查通过，建议合并。"

### 第六步：处理 PR 中的评论（CodeRabbit / 人工 review）

> PR 中可能有 CodeRabbit 等 AI 审查机器人或人工 reviewer 的评论。需逐条分析并处理。

1. **获取所有评论**：
   ```bash
   gh pr view {PR编号} --json comments,reviews
   ```
   - 区分 review comments（代码行级评论）和 issue comments（PR 级评论）
   - 重点关注 CodeRabbit 等机器人的评论

2. **逐条分析每个评论**：
   对每条评论判断是否合理，依据：
   - AGENTS.md 红线 R1-R11 和质量门禁 G1-G7
   - 对应的 AC 原文
   - 代码逻辑与架构规约
   - 技术选型文档

3. **处理合理的评论（按严重度分流）**：

   **a) 合理且立即修复（🔴/🟠 级别）**：
   - 按评论建议修复代码
   - 运行 `bun run typecheck && bun run lint && bun test` 验证
   - 提交修复并推送
   - 回复评论说明修复内容（**R12：回复必须用英文**）
   - **Resolve conversation**（标记为已解决）：
     ```bash
     gh api graphql -f query='mutation { resolveReviewThread(input: {threadId: "THREAD_ID"}) { thread { isResolved } } }'
     ```

   **b) 合理但延期修复（🟡 Minor / Phase 后续）**：
   - **必须在 `docs/05-planning/deferred-items.json` 留档追踪**：
     - 新增条目到 `items` 数组，**必须保存完整上下文**，避免日后遗忘：
       ```json
       {
         "id": "DEF-NNN",
         "source": "CodeRabbit",
         "pr": 11,
         "pr_url": "https://github.com/REPO/pull/11",
         "comment_id": 3608463027,
         "comment_url": "https://github.com/REPO/pull/11#discussion_rXXXX",
         "task": "1.9",
         "severity": "major|minor",
         "item": "一句话摘要",
         "detail": "完整的问题描述、影响范围、修复建议（从评论原文摘录）",
         "target_phase": 3,
         "status": "open",
         "resolved_by": null,
         "created_at": "ISO timestamp"
       }
       ```
     - `detail` 字段是**强制必填**的——保存原始评论的完整技术上下文，确保数月后仍可理解问题
     - `comment_url` 可直接跳转查看原始讨论线程
   - 回复评论说明延期原因和追踪 ID（**R12：回复必须用英文**）
   - 如评论不阻塞当前合并，resolve conversation

4. **处理不合理的评论（❌）**：
   - 无意义的评论（WAL 模式误报、工具链版本差异误判等）→ **hide**
   - 选择合适的 reason：
     | Reason | 适用场景 |
     |---|---|
     | `OUTDATED` | 评论引用的代码已不存在或已更新 |
     | `RESOLVED` | 评论的问题已在代码中正确处理 |
     | `DUPLICATE` | 评论内容与已有评论重复 |
   - **获取 GraphQL node ID**（hide 需要 GraphQL ID，非 REST API 的 databaseId）：
     ```bash
     gh api graphql -f query='
     query { repository(owner:"REPO_OWNER", name:"REPO_NAME") {
       pullRequest(number:PR_NUMBER) {
         reviews(first:5) { nodes { comments(first:20) { nodes { databaseId id bodyText } } } }
       }
     }}' --jq '.data.repository.pullRequest.reviews.nodes[].comments.nodes[]'
     ```
   - **Hide comment**：
     ```bash
     gh api graphql -f query='mutation { minimizeComment(input: {subjectId: "NODE_ID", classifier: OUTDATED}) { minimizedComment { isMinimized } } }'
     ```
   - 如果无法 hide（权限不足），回复说明不采纳的理由并 resolve conversation

5. **输出评论处理报告**：
   ```markdown
   ## 📋 PR 评论处理报告
   | # | 评论来源 | 内容摘要 | 判断 | 处理方式 |
   |---|------|------|------|------|
   | 1 | CodeRabbit | xxx | ✅ 合理 | 已修复 (commit hash) + resolve |
    | 2 | CodeRabbit | yyy | ✅ 合理，延期 | DEF-002 → deferred-items.json (Phase 3) |
    | 3 | CodeRabbit | zzz | ❌ 无意义 | hidden (OUTDATED) |
    ```

### 第七步：阶段出口检查（防止延期项被遗忘）

> 每个 Phase 的集成测试（如 `1.16`, `2.8`, `3.17`）完成时，必须检查 `deferred-items.json`。

1. **Phase 完成时**：
   - 读取 `docs/05-planning/deferred-items.json`
   - 筛选 `target_phase` 等于当前阶段的 `status: "open"` 条目
   - 逐条检查是否已被该阶段的其他任务顺便修复：
     - 已修复 → 将 `status` 更新为 `done`，填写 `resolved_by`（commit hash 或任务 ID）
     - 未修复 → 保持 `open`，评估是否需要提升 `target_phase` 到下一阶段
   - 输出检查报告：
     ```markdown
     ## 📋 Phase N 延期待办检查
     | DEF-ID | 内容 | 状态 | 处理 |
     |---|---|---|---|
     | DEF-001 | 连接统一 | ✅ 已修复 | 3.2 顺便完成 (commit abc) |
     | DEF-002 | 事务测试 | ⏳ 延期 | → target_phase: 4 |
     ```

2. **启动新阶段时**（如 `next-task-itest`）：
   - 读取 `deferred-items.json`
   - 如果存在 `target_phase` 为当前阶段且 `status: "open"` 的条目，提醒执行者检查
