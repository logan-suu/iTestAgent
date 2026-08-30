# ADR-025：Codex 开发工作流迁移

- **状态**：Accepted
- **日期**：2026-08-30
- **决策者**：项目所有者（单人开发者）
- **关联**：AGENTS.md R8/R11/R12/R14、ADR-011、ADR-012

## 背景

iTestAgent 原先主要在 OpenCode 中开发。仓库的规格、任务状态、Git hooks、CI 与 `AGENTS.md` 均为 Agent 无关资产，但 14 个复用工作流位于 `.opencode/commands/`，本机 Simulator 验证依赖的 Argent MCP 也只配置在 OpenCode 用户目录。Codex 不会自动导入 OpenCode 命令、插件或会话状态。

此外，根 `AGENTS.md` 已略高于 Codex 默认 32 KiB 的项目指令合并上限，存在尾部规则被截断的风险。

## 方案对比

### 方案 A：继续只维护 OpenCode 命令

- 优点：无迁移成本。
- 缺点：Codex 无法发现工作流；提交、PR review、任务状态与人工确认门禁依赖临时提示，容易漂移。

### 方案 B：将全部命令复制为 Codex 自定义 Prompt

- 优点：迁移直接。
- 缺点：Codex 自定义 Prompt 已不再是推荐的复用格式；逐字复制会重复 `AGENTS.md` 并占用大量上下文。

### 方案 C：使用仓库级 Codex Skills + 项目配置（采用）

- 优点：工作流可由仓库共享和自动发现；每个 Skill 保持单一职责；项目级 MCP 可恢复 Argent 能力；OpenCode 旧命令可在过渡期保留。
- 缺点：Codex 使用 `$skill-name` 调用语法；首次加载项目配置需要信任仓库；两套入口在过渡期需要同步检查。

## 决策

1. 将 14 个 OpenCode 工作流迁移为 `.agents/skills/<name>/SKILL.md`，名称保持兼容，Codex 使用 `$skill-name` 调用。
2. Skill 不机械复制通用能力；R1-R14、EPCC-V 和质量门禁继续由 `AGENTS.md` 统一定义，Skill 仅保留自身独有的状态机、授权边界与停止条件。
3. 新增 `.codex/config.toml`：将 `project_doc_max_bytes` 提高到 65536，并配置 Argent MCP，恢复既有 G5-SIM/headless Simulator 工具能力。
4. 不迁移 OpenCode 的 `oh-my-openagent` 角色/模型映射、provider 凭证、`.omo/` 会话续跑文件、`.codegraph` 或依赖目录。
5. `.opencode/commands/` 暂时保留为兼容参考；待 Codex 工作流实际验证后，再由独立、经确认的清理任务决定是否删除。
6. `.agents/skills` 中的版本控制内容使用英文，满足 R12；`docs/` 内迁移记录继续使用中文。

## 后果

- Codex 能从仓库自动发现任务、测试、提交、PR review 与任务完成确认工作流。
- `AGENTS.md` 不再因默认 32 KiB 限制而截断，但仓库必须被 Codex 标记为 trusted 才会加载项目配置。
- Argent 仍通过 `npx -y @swmansion/argent mcp` 启动，与现有 OpenCode 配置等价；版本固定与升级验证属于后续依赖治理工作，不在本迁移中擅自改变。
- OpenCode 与 Codex 可在过渡期并存；发生差异时，以 `AGENTS.md`、`docs/` 和 `.agents/skills/` 为 Codex 开发工作流真源。
