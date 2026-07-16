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

3. **处理合理的评论**：
    - 按评论建议修复代码
    - 运行 `bun run typecheck && bun run lint && bun test` 验证
    - 提交修复并推送
    - **Resolve conversation**（标记为已解决）：
      ```bash
      gh api graphql -f query='mutation { resolveReviewThread(input: {threadId: "THREAD_ID"}) { thread { isResolved } } }'
      ```
    - 回复评论说明修复内容（**R12：回复必须用英文**）

4. **处理不合理的评论**：
   - 选择合适的 reason hide comment：
     | Reason | 适用场景 |
     |---|---|
     | `OUTDATED` | 评论引用的代码已不存在或已更新 |
     | `RESOLVED` | 评论的问题已在代码中正确处理 |
     | `DUPLICATE` | 评论内容与已有评论重复 |
   - **Hide comment**：
     ```bash
     gh api graphql -f query='mutation { minimizeComment(input: {subjectId: "COMMENT_ID", classifier: REASON}) { minimizedComment { isMinimized } } }'
     ```
   - 如果无法 hide（权限不足），回复说明不采纳的理由并 resolve conversation

5. **输出评论处理报告**：
   ```markdown
   ## 📋 PR 评论处理报告
   | 评论来源 | 内容摘要 | 判断 | 处理方式 |
   |---|---|---|---|
   | CodeRabbit | xxx | ✅ 合理 | 已修复 + resolve |
   | CodeRabbit | yyy | ❌ 不合理 | hidden (OUTDATED) |
   ```
