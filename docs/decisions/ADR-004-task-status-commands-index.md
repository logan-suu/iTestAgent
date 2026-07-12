# ADR-004: 新增 task-status.json、14 条自定义命令、INDEX.md

**状态**: 已接受
**日期**: 2026-07-12
**决策人**: AI Agent（工程化任务）
**关联**: 开发流程标准化

## 背景

iTestAgent 作为 AI Native 项目，需要一套标准的开发工具链来保障 AI Agent 和人类开发者的协作效率：
1. 任务状态追踪（当前进度、依赖关系、历史决策）
2. OpenCode 自定义命令（会话初始化、任务执行、测试、PR 流程）
3. 文档索引（快速定位规格文档）

这三者 Echo 项目已有成熟实现，可直接借鉴模式。

## 决策

**参照 Echo 项目，新增三个工程化基础设施。**

## 实施

### 1. task-status.json（`docs/05-planning/task-status.json`）
- 7 个 Phase、48 个任务、依赖关系、documents_required
- `current_phase` 追踪当前阶段
- `decisions` 记录历史决策（后续迁移至 ADR）

### 2. 14 条 OpenCode 自定义命令（`.opencode/commands/`）
| 命令 | 用途 |
|---|---|
| `init-session-itest` | 新会话初始化：读规约→定位进度→锁定 AC |
| `status-itest` | 项目状态速览 |
| `next-task-itest` | 执行下一个 ready 任务（EPCC-V） |
| `do-task-itest` | 执行指定任务（EPCC-V） |
| `read-spec-itest` | 规格速读，不写代码 |
| `test-unit-itest` | 运行 `bun test` |
| `test-integration-itest` | 全量回归测试 |
| `test-phase-itest` | 阶段验收测试 |
| `commit-pr-itest` | 提交+PR（G1-G7 门禁） |
| `pr-review-itest` | PR AI 预审 |
| `pr-merge-itest` | PR 合并（人类确认） |
| `retry-task-itest` | 重试中断任务 |
| `sync-docs-itest` | 文档同步，防规格漂移 |
| `explain-itest` | 代码溯源到规格文档 |

### 3. INDEX.md（`docs/INDEX.md`）
- 文档地图：按类别列出 8 份文档
- 按模块快速定位：30+ 条场景→文档路径映射
- Epic 概览 + 架构核心速查 + 技术栈速查
- Agent 使用指引

## 后果

### 正面
- AI Agent 首次启动即可通过 `init-session-itest` 自动定位当前任务、锁定 AC 和架构约束
- task-status.json 替代人工追踪，进度一目了然
- 14 条命令覆盖完整开发循环（启动→执行→验证→提交→审查→合并→同步）
- INDEX.md 作为快速参考入口

### 负面
- task-status.json 需要随开发进度持续更新（可通过 `sync-docs-itest` 自动化）

## 参考

- `/Users/logansu/Documents/Dev/SwiftProjects/Echo/.opencode/commands/` — Echo 命令（参照对象）
- `AGENTS.md` — 项目宪法
- `docs/05-planning/开发计划安排文档.md` — 任务拆解依据
