# ADR-003: 性能指标策略——主推 hitches/hangs，FPS 近似，xctrace summary 实验性

**状态**: 已接受
**日期**: 2026-07-12
**决策人**: AI Agent（基于技术选型评估）
**关联**: 红线 R5、技术选型文档 §11

## 背景

性能采集是 iTestAgent 的核心能力之一。但 iPhone 真机上的性能指标获取有显著现实限制：

1. **FPS**：真机无稳定 CLI 实时 FPS。Core Animation FPS / frame lifetimes 仅能给出近似值。承诺「精确实时 FPS」会误导用户。
2. **xctrace summary**：`xcrun xctrace export` 的 XML schema 跨 Xcode 版本会变。Xcode 26 引入 Deferred 录制模式增加解析难度。深度解析需要跟随 Xcode 版本持续维护。并非所有 GUI 可见数据都能 export（存在 not_exportable）。
3. **memory peak**：xctrace 采样值是近似值，非权威内存占用。

## 决策

**第一版性能主推 hitches/hangs（相对稳、可自动化、可做 baseline）。FPS 定义为 FPS-like 近似指标，xctrace summary 深解析为实验性。**

## 指标分级

| 指标 | 定位 | 获取方式 |
|---|---|---|
| **launch time** | 确定可采 | XCTest metrics / xctrace |
| **hitches / hangs** | 主推 | xcrun xctrace export --toc/--xpath |
| **crash** | 确定可采 | 设备 crashlog |
| **test duration** | 确定可采 | XCTest metrics / 执行计时 |
| **memory peak** | 近似值（标注） | xctrace 采样 |
| **FPS** | FPS-like 近似（标注） | Core Animation FPS / frame lifetimes / hitches 反推 |
| **xctrace summary** | 实验性（保留原始 .trace） | xcrun xctrace export |

## 实施

1. 所有近似指标在数据中显式标注 `approximate: true`
2. 不可导出的 xctrace 数据标 `not_exportable`，不编造
3. 原始 `.trace` 文件始终保留，供用户在 Instruments 中人工打开
4. xctrace 解析层对 schema 名称/列做跨 Xcode 版本容错
5. 深度 xctrace summary 归一化推迟到 Phase 6+ 增强路线

## 后果

### 正面
- 规避了「承诺精确实时 FPS」的信任风险
- 降低 xctrace 跨版本维护成本
- hitches/hangs 足够覆盖大多数性能回归场景

### 负面
- FPS 近似值可能不满足对帧率有严格要求的游戏类 App
- xctrace summary 归一化推迟意味着部分性能数据无法自动对比
- 需要向用户清晰解释「FPS-like」和「实验性」的含义

## 参考

- `AGENTS.md` — 红线 R5（不静默降级/臆造指标）
- `docs/02-architecture/技术选型文档.md` §11 — 性能采集与 .trace 解析
- `docs/03-implementation/开发避坑与关键注意点手册.md` §6 — 性能采集维护税
