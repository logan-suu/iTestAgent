# ADR-008: TuiShell 选型——OpenTUI+SolidJS 目标主线 + Ink 已验证 fallback

**状态**: 已接受
**日期**: 2026-07-15
**决策人**: AI Agent（基于 T0.4 横评实测）
**关联**: ADR-005、T0.4 横评文档

## 背景

iTestAgent 是 TUI-first 的 Agent。ADR-005 确定了可插拔 TuiShell 架构——iTestAgent 定义自己的 TuiShell 接口和 UI view model，renderer（OpenTUI/Rezi/Ink）可替换。

候选：OpenTUI+Solid、Rezi、Ink（React TUI）。

## 横评结果

### 评分矩阵（0-2 分 × 8 维度 = 满分 16）

| Candidate | D1 install | D2 import | D3 event model | D4 stream render | D5 Markdown | D6 tool card | D7 build | D8 interactive shell | Total | 结果 |
|---|---|---|---|---|---|---|---|---|---|---|
| **Ink** | 2 | 2 | 2 | 2 | 2 | 2 | 2 | 2 | **16/16** | ✅ Pass |
| **OpenTUI** | 2 | 2 | 1 | 1 | 1 | 1 | 1 | 0 | **9/16** | Partial |
| **Rezi** | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | **0/16** | ❌ Fail |

### 关键发现

1. **Rezi 不存在为 TUI 框架**：npm `rezi@1.0.0` 是 2015 年发布的 CSS post-processor，非 TUI 框架。`@rezi/core` 返回 404。**排除**。

2. **Ink 全通过（16/16）**：workspace/device/thinking/tool card/progress/logs/Markdown answer 全部渲染通过。pseudo-TTY 交互式 shell 证明通过（`script` 提供 pseudo-terminal）。满足 M0 出口标准"至少一路能跑通交互式 Shell"。

3. **OpenTUI 标准 `bun build` 失败**：`@opentui/core-*` optional native dynamic imports 无法 resolve。**但 T0.4b 补充验证解决了**：OpenCode-style build pattern（`bun install --os="*" --cpu="*"` + `@opentui/solid/bun-plugin` + `target: "bun"`）可解。编译后 binary 运行成功。

4. **架构建议**：TuiShell ViewModel/Event/reducer 应 framework-independent。OpenTUI 和 Ink 都只是 renderer，共享同一套 event model 和 reducer。

## 决策

```
目标主线 = OpenTUI + SolidJS（OpenCode-style build pattern）
MVP fallback / M0 proven = Ink + shared TuiShell view model / reducer
Rejected = Rezi（当前 npm registry 下不存在为 TUI 框架）
```

### 选择 OpenTUI+SolidJS 为目标主线的理由

1. 对齐 OpenCode TUI 技术栈（keymap/scrollback/tool card/plugin 经验复用）
2. T0.4b 证明标准构建问题可解（native variant install + Solid plugin + Bun target build）
3. 原生渲染、流式输出、键盘交互能力适合长会话 Agent TUI

### Ink 作为已验证 fallback 的理由

1. 16/16 满分通过，M0 出口标准由 Ink 满足
2. React 心智模型，生态成熟
3. CI-friendly minimum shell（无 native dependency）

## 备选方案

| 方案 | 优点 | 缺点 | 结论 |
|---|---|---|---|
| **OpenTUI 目标 + Ink fallback** | 对齐 OpenCode、M0 已验证、双保险 | 两套 renderer 需维护 | ✅ 选择 |
| Ink only | 最稳、零构建问题 | 不对齐 OpenCode、长期偏离目标 | ❌ 降级为 fallback |
| OpenTUI only | 对齐 OpenCode | T0.4 交互式 shell 未验证、native build 需特殊处理 | ❌ 需 Ink 兜底 |
| Rezi | — | 不存在为 TUI 框架 | ❌ 排除 |

## 实施

### Phase 1 T1.2 TuiShell 实现

```
TuiShellViewModel / TuiShellEvent / reducer: framework-independent
OpenTUIRenderer: 目标 default renderer（需 OpenCode-style build）
InkRenderer: fallback / CI-friendly minimum shell
```

### OpenTUI 进入 Phase 1 前仍需补齐

1. 真实交互式 shell（T0.4 只到了 import/build/compile，未到真实 TTY 交互）
2. 长日志和 scrollback
3. Markdown 渲染
4. 工具调用卡片
5. 输入行 / keymap / command palette

## 后果

### 正面
- M0 出口标准已由 Ink 满足，不阻塞 Phase 1
- OpenTUI + SolidJS 对齐 OpenCode，长期可复用 TUI 经验
- framework-independent reducer 设计使 renderer 可无痛切换

### 负面
- 需维护两套 renderer（OpenTUI + Ink）
- OpenTUI 交互式 shell 仍未验证（Phase 1 需补齐）
- Rezi 排除后候选减少，但 Ink fallback 降低了风险

## 参考

- `docs/02-architecture/架构设计文档.md` §3 — TuiShell 组件职责
- `docs/02-architecture/技术选型文档.md` §5 — 交互层 CLI 与 TUI
- `~/Desktop/横评/T0.4 TUI backend 横评.md` — 三路横评 + T0.4b OpenTUI 补充验证
- `docs/decisions/ADR-005` — 可插拔 Backend 架构
