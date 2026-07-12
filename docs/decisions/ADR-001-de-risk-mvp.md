# ADR-001: MVP 定位——人在环路的真机测试记录器，而非全自动测试 Agent

**状态**: 已接受
**日期**: 2026-07-12
**决策人**: AI Agent（基于可行性分析）
**关联**: 开发避坑手册 §15 可行性分析

## 背景

项目概述最初 18 条 MVP 完成标准中包含「全自动探索 + 自动断言」「从代码推断核心用户链路」「FPS 精确指标」「xctrace summary 稳定解析」等研究级能力。可行性分析表明：管道（架构 / 真机执行 / 复用）可行，但智能（推断核心链路 / 自动探索+自动断言 / FPS+xctrace summary）高风险。

## 决策

**MVP 从「全自动 iPhone 测试 Agent」重新定位为「人在环路的真机测试记录器 + 稳健性能趋势工具」。**

## 保留（第一版必做）

```
TUI + 本地 server + Vercel AI SDK + MCP + Drizzle 骨架
强 doctor：签名 / Developer Mode / 设备信任 / WDA 首次安装 引导
Project Analyzer 只做确定性层 + 带证据候选功能 + 用户勾选
Agent 辅助交互式录制：Agent 建议下一步，用户确认/纠偏，固化为可重放 Flow
稳健性能子集：launch + memory(近似) + crash + hitches/hangs
证据采集 + 报告三件套 + 失败解释 + 重跑
测试数据 + Keychain 脱敏
```

## 推迟（标注实验/尽力而为）

```
全自动探索 + 自动断言 passed
从代码推断"核心用户链路"
FPS 精确指标 + xctrace summary 稳定解析（第一版只保留原始 .trace + hitches）
XCUITest/Appium 测试代码 draft 生成（标实验性）
```

## 后果

### 正面
- 将「一天的活」和「半年的研究」拆分，MVP 真正可行
- 人在环路降低了 AI 过度自信的风险
- 交互式录制为用户提供可控的测试资产积累路径

### 负面
- MVP 能力边界比最初愿景窄
- 「人在环路」对用户操作量有要求，不是全自动体验
- 需向用户明确沟通能力边界

## 参考

- `docs/03-implementation/开发避坑与关键注意点手册.md` §15 — 可行性分析
- `docs/01-spec/全量用户故事与验收标准规格书.md` — MVP 验收总表
- `docs/05-planning/开发计划安排文档.md` — Phase 0-6 排期
