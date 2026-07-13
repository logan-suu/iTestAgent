# ADR-005: 采用可插拔 Backend 架构，各层多候选横评而非绑定单一工具

**状态**: 已接受
**日期**: 2026-07-13
**决策人**: AI Agent（基于调研产出与架构分析）
**关联**: ADR-001~004、调研文档 00-最终架构设计

## 背景

iTestAgent 最初的技术选型在各层绑定了具体工具：真机执行绑定 Appium/WDA、TUI 绑定 OpenTUI+Solid、存储绑定 Drizzle、性能采集预设「自研 xctrace 薄封装」。2026-07-12 完成独立调研后（见 `/Users/logansu/Desktop/new docs/` 中 10 份分析文档），发现：

1. **真机执行层**：`mobile-mcp`、`@blitzdev/iphone-mcp`、`appium-mcp`、`iphone-use` 等多个候选均可作为底层执行器，在 Phase 0 应做多路横评而非预设 Appium/WDA 为唯一路径。
2. **其他各层同样存在多候选**：TUI（OpenTUI/Rezi/Ink）、Agent 编排（AI SDK/Mastra/LangGraph）、存储（Drizzle/Kysely）、项目分析（XcodeQuery/XcodeProj）、性能采集（XcodeTraceMCP core/instrumentsmcp/raw xcrun）。
3. **「预设单一工具」的风险**：企业安全软件可能阻断特定二进制、工具 schema 变更影响上层、某些 App 的 UI accessibility 在某些工具上表现差、未来需要接入云真机或 iPhone Mirroring 等场景。

## 决策

**iTestAgent 全栈采用「稳定上层接口 + 可替换底层 Backend」架构。**

核心原则：
```
稳定的是 iTestAgent 语义层：ProjectProfile / TestPlan / RunStep / Flow / ArtifactRef / result.json
可变的是 backend：mobile-mcp / Appium / iphone-use / XcodeTraceMCP / XcodeQuery / Drizzle / Kysely 等
engine 不直接拼底层命令，只调用内部 backend 接口
所有 backend 输出归一化为 iTestAgent 自己的数据契约
```

## 各层 Backend 接口与候选

| 层 | Backend 接口 | MVP 第一候选 | Fallback | 增强候选 |
|---|---|---|---|---|
| **Device** | `DeviceBackend` | `mobile-mcp` | `Appium/WDA` | `iphone-use`、`blitz-iphone-mcp` |
| **Performance** | `PerformanceBackend` | `XcodeTraceMCP core` | `raw xcrun` | `instrumentsmcp`、`instruments-analyzer` |
| **TUI** | `TuiShell` | `OpenTUI` | `Ink` | `Rezi` |
| **Build** | `BuildDriver` | `xcodebuild + xcbeautify` | `fastlane` | `Codemagic CLI` |
| **Project Analysis** | `ProjectAnalyzerBackend` | `XcodeQuery CLI` | `XcodeProj helper` | `SwiftSyntax`、`SourceKit` |
| **Store** | `StoreDriver` | `Drizzle` | `Kysely` | `raw bun:sqlite` |
| **Agent Runtime** | `AgentRuntime` | `AI SDK + MCP TS SDK` | — | `Mastra`、`LangGraph` |

## 备选方案

| 方案 | 优点 | 缺点 | 结论 |
|---|---|---|---|
| **绑定单一工具**（原方案） | 实现简单，路径明确 | 被工具锁死，切换成本高，无法适应不同环境 | ❌ 弃用 |
| **可插拔 Backend**（选定） | 灵活、未来可扩展、各层独立演进 | 接口设计和归一化工作量大 | ✅ 选择 |
| **不做抽象，每次手工适配** | 零设计成本 | 代码耦合严重，维护灾难 | ❌ 不选 |

## 实施

### Phase 0：多 Backend 横评
- T0.2: Device backend 四路横评（mobile-mcp / Appium/WDA / iphone-use / mock）
- T0.3: Performance backend 三路横评（XcodeTraceMCP / instrumentsmcp / raw xcrun）
- T0.4: TUI backend 三路横评（OpenTUI / Rezi / Ink）
- T0.5: Project analyzer 两路横评（XcodeQuery / XcodeProj）
- T0.6: 输出决策矩阵，确定 MVP 各层主力 + fallback

### 文档更新
- 架构设计文档：替换为最终合并版本（原有 + 调研），新增 Backend 接口设计与决策矩阵
- 技术选型文档：各层从「[采用]单工具」改为「候选横评」表格
- 开发计划：Phase 0 从「双 Spike」改为「多 Backend 横评」
- task-status.json：Phase 0 从 4 tasks 改为 6 tasks
- 全面同步术语：`adapters` → `backends`、`Appium/WDA 探索路径` → `DeviceBackend 探索路径`

### Backend 选择规则
1. 用户显式指定 backend 时优先
2. 未指定时按 preference 顺序
3. backend healthcheck 不通过则尝试下一个
4. fallback 会改变测试语义时必须询问用户
5. 所有 fallback 记录到 result.json

## 后果

### 正面
- 不被单一工具锁死，可适应不同企业环境和个人开发场景
- 同一套 TestPlan/Flow 可在不同 backend 下执行
- 未来接入云真机（BrowserStack/Sauce Labs）、iPhone Mirroring 等几乎零上层改动
- Mock backend 保障无真机开发和 CI
- 各层可独立演进（如性能模块单独升级 instruments-analyzer）

### 负面
- 接口设计和归一化工作量显著增加
- 每个 backend 需要独立测试和维护
- 初期决策成本（Phase 0 多路横评）增加
- 错误处理和状态映射需要覆盖多种 backend 输出

## 参考

- `docs/02-architecture/架构设计文档.md` — 新版架构设计
- `docs/02-architecture/技术选型文档.md` — 各层候选排序
- `docs/05-planning/开发计划安排文档.md` — Phase 0 横评计划
- `docs/05-planning/task-status.json` — 任务状态
- `/Users/logansu/Desktop/new docs/` — 10 份调研产出
- `docs/decisions/ADR-001`~`004` — 前置决策
