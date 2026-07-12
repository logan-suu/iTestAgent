# ADR-003: docs/ 目录按分层结构重组

**状态**: 已接受
**日期**: 2026-07-12
**决策人**: AI Agent（结构重组任务）
**关联**: 目录结构优化

## 背景

原 `docs/` 目录下 8 份文档扁平放置，无分类。参照 Echo 项目的分层结构（`01-spec/`、`02-architecture/`、`03-implementation/`、`04-ai-native/`、`05-planning/`），iTestAgent 的文档也应按相同模式组织，便于 AI Agent 和人类快速按类别定位。

## 决策

**将 `docs/` 按 5 个子目录重组，并对齐 Echo 项目结构。**

## 实施

| 原路径 | 新路径 | 类别 |
|---|---|---|
| `docs/全量用户故事与验收标准规格书.md` | `docs/01-spec/` | 规格与需求 |
| `docs/架构设计文档.md` | `docs/02-architecture/` | 架构设计 |
| `docs/技术选型文档.md` | `docs/02-architecture/` | 技术选型 |
| `docs/数据流全链路技术说明文档.md` | `docs/02-architecture/` | 数据流 |
| `docs/开发避坑与关键注意点手册.md` | `docs/03-implementation/` | 开发避坑 |
| `docs/AI Native 开发理念与实战技巧手册.md` | `docs/04-ai-native/` | AI Native |
| `docs/开发计划安排文档.md` | `docs/05-planning/` | 开发计划 |
| `docs/INDEX.md` | `docs/INDEX.md`（保留在 docs 根） | 文档索引 |

同步更新所有交叉引用路径（AGENTS.md、README.md、INDEX.md、14 条命令、task-status.json、文档间互相引用）。

## 后果

### 正面
- 按类别分目录，文档地图更清晰
- 与 Echo 项目结构一致，降低认知负担
- AI Agent 可根据任务类型直接定位子目录

### 负面
- 一次性变更涉及 13 个文件，需同步更新所有引用

## 参考

- `docs/INDEX.md` — 文档索引
- `/Users/logansu/Documents/Dev/SwiftProjects/Echo/docs/` — Echo 项目结构（参照对象）
