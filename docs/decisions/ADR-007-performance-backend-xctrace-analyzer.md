# ADR-007: PerformanceBackend 选型——xctrace-analyzer-core + 自研 hitches parser + raw xcrun fallback

**状态**: 已接受
**日期**: 2026-07-15
**决策人**: AI Agent（基于 T0.3 横评实测）
**关联**: ADR-003、ADR-005、T0.3 横评文档

## 背景

iTestAgent 需要采集 iOS 真机性能指标（launch time、memory、hitches、hangs、crash、FPS、test duration）。ADR-003 确定了主推 hitches/hangs、FPS 近似、xctrace summary 实验性的策略。ADR-005 确定了可插拔 PerformanceBackend 架构。

候选：XcodeTraceMCP / `@xctrace-analyzer/core`、instrumentsmcp、raw xcrun。

## 横评结果

### 真实 trace 测试覆盖

| Trace 类型 | 数据量 | raw xcrun | xctrace-analyzer | instrumentsmcp |
|---|---|---|---|---|
| Time Profiler (fixture) | 23 schema | ✅ 23 schema 导出 | ✅ summary/stats/topFunctions/supportStatus | ✅ profile_cpu |
| Allocations / Leaks (真机) | 23 traces | ✅ TOC 暴露 21/23 | ✅ `not_exportable` | ❌ 报 "0 allocations"（误导） |
| App Launch + Network | 906 requests | ✅ 数百行 network 表 | ✅ 906 requests 统计 | ❌ 报 "0 HTTP requests"（漏报） |
| Time Profile + Hitches | 49 hitches | ✅ 49 行 hitches-summary | — | ❌ 报 "No hitches detected"（漏报） |

### 关键发现

1. **instrumentsmcp 有数据诚信问题（R5 风险）**：
   - Network：raw xcrun 有数百行，xctrace-analyzer 统计 906 requests，instrumentsmcp 报 0
   - Hitches：raw xcrun 有 49 行 hitches-summary，instrumentsmcp 报 "No hangs or hitches detected"
   - Allocations/Leaks：不可导出时 instrumentsmcp 报 "0 allocations" / "No leaks detected"——应标 `not_exportable`
   - **不能作为默认可信 backend**

2. **`@xctrace-analyzer/core` 符合 R5 诚实降级**：
   - 正确区分 `supported` / `unsupported` / `empty` / `not_exportable`
   - `supportStatus` + `exportAttempts` 语义符合 iTestAgent "不确定就标注"原则
   - Allocations/Leaks 正确标 `not_exportable`，不臆造

3. **hitches-* schema 无公开 parser 可直接替代**：
   - 真实 trace 中的 schema：`hitches-summary`、`hitches-lifetime-interval`、`hitches-render-interval`、`hitches-gpu-interval`、`hitches-commit-interval`
   - 现有工具（instruments-analyzer、agent-device、SwiftUI-Agent-Skill）支持不同 schema 名
   - `hitches` ≠ `hitches-summary`，不能直接复用
   - iTestAgent 需自研，但可借鉴 XML id/ref 解析、row streaming、frame health 聚合思路

## 决策

```
PerformanceBackend = xctrace-analyzer-core（默认）
                    + 自研 hitches-* schema parser（内部模块，待实现）
                    + raw xcrun（fallback）
instrumentsmcp = 录制/report 工作流参考，不作为默认可信 backend
```

### 职责划分

| 模块 | 职责 |
|---|---|
| xctrace-analyzer-core | TOC 导出、Time Profiler、Network、Virtual Memory、supportStatus、exportAttempts、not_exportable |
| 自研 hitches-* parser | hitches-summary + hitches-*-interval（借鉴现有公开实现思路，iTestAgent 自有实现） |
| raw xcrun fallback | 未知 schema 导出、fixture 生成、backend 调试 |

### hitches parser 实现优先级

1. 第一版：只解析 `hitches-summary`（count、max duration、severity breakdown、Hitch Type）
2. 第二版：多表关联（hitch-id / swap-id 关联 5 个 interval 表）
3. 第三版：DuckDB/Parquet（Phase 6+，借鉴 instruments-analyzer）

## 备选方案

| 方案 | 优点 | 缺点 | 结论 |
|---|---|---|---|
| **xctrace-analyzer-core + 自研 hitches** | 诚实降级、R5 合规、not_exportable 正确 | hitches 需自研、无直接替代 | ✅ 选择 |
| instrumentsmcp 为默认 | 工具面全、一体化 | 数据诚信问题（漏报/误导）、违反 R5 | ❌ 不作为默认 |
| 纯 raw xcrun | 最可控、最接近 Apple 官方 | 无高层语义、维护成本高 | ❌ 仅 fallback |

## 后果

### 正面
- 性能模块最重视可信性，xctrace-analyzer-core 的 not_exportable 语义符合 R5
- 原始 .trace artifact 保留，可后续深解析
- hitches parser 分阶段实现，MVP 第一版只解析 hitches-summary 即可

### 负面
- hitches-* parser 需自研，全网搜索未找到直接替代
- xctrace-analyzer-core 当前不解析 hitches-* schema，需扩展
- dSYM symbolication 未在 T0.3 验证，Phase 4 需补

## 参考

- `docs/02-architecture/架构设计文档.md` §5.2 — PerformanceBackend 接口与候选
- `docs/02-architecture/技术选型文档.md` §11 — 性能采集与 .trace 解析
- `~/Desktop/横评/T0.3 Performance backend 横评.md` — 三路横评 + hitches parser 搜索
- `docs/decisions/ADR-003` — 性能指标策略（hitches/hangs 主推，FPS 近似，xctrace summary 实验性）
- `docs/decisions/ADR-005` — 可插拔 Backend 架构
