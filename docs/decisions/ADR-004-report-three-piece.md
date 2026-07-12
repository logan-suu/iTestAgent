# ADR-004: 报告形态——三件套（summary.md + result.json + artifact-index.json），不输出 HTML

**状态**: 已接受
**日期**: 2026-07-12
**决策人**: AI Agent（基于数据流设计）
**关联**: 数据流全链路 S9、规格书 US-15.1

## 背景

测试执行后的报告是 iTestAgent 的最终交付物。需要同时满足：
- **人类可读**：开发者能快速理解发生了什么
- **机器可解析**：可被后续工具（explain、rerun、baseline）读取
- **证据可追溯**：每个结论都有 artifact 支撑

常见的报告形态有 HTML、Markdown、JSON 等。需要决定固定输出格式。

## 决策

**每次 run 固定输出三个文件，不输出 HTML 报告。**

## 三件套定义

| 文件 | 格式 | 内容 | 消费者 |
|---|---|---|---|
| `summary.md` | Markdown | 结论 / 失败原因 / 关键指标 / 证据路径 / 建议下一步命令 | 人类开发者 |
| `result.json` | JSON（带 schemaVersion） | run 状态 / Project Profile 引用 / 设备信息 / 执行方式 / 性能指标 / baseline 对比 / artifactRefs / 失败归因 | Engine（explain/rerun/baseline） |
| `artifact-index.json` | JSON（带 schemaVersion） | artifacts [{id, type, path, relatedStep}] | Engine（证据索引） |

所有文件型证据（截图、视频、日志、xcresult、trace、crashlog）走文件系统，索引入 result.json 的 `artifactRefs` 和 artifact-index.json。

## 备选方案

| 方案 | 优点 | 缺点 | 结论 |
|---|---|---|---|
| **HTML 报告** | 视觉效果好，可浏览器打开 | 需要维护模板引擎、CSS、截图嵌入方案；与 TUI-first 定位冲突 | ❌ 不选 |
| **纯 JSON** | 机器可解析 | 人类不可读，需额外工具查看 | ❌ 不选 |
| **三件套** | 人机皆可消费、工具链简单、可版本化 | 无可视化图表（可后续扩展） | ✅ 选择 |

## 后果

### 正面
- 极简工具链：不需要 HTML 模板引擎、CSS 框架
- Markdown 天然支持代码块、表格，渲染效果好
- JSON 带 schemaVersion，支持跨版本兼容
- artifact-index.json 解耦证据索引与运行结果

### 负面
- 无内置可视化图表（性能趋势图等需后续扩展）
- Markdown 的排版能力有限（复杂表格可能不美观）

## 参考

- `docs/02-architecture/数据流全链路技术说明文档.md` §12 — 报告合成与消费
- `docs/01-spec/全量用户故事与验收标准规格书.md` US-15.1 — 三件套报告 AC
- `docs/02-architecture/架构设计文档.md` §7 — 数据模型
