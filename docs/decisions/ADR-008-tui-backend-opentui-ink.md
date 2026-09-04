# ADR-008: TuiShell 选型——OpenTUI+SolidJS 目标候选 + Ink fallback

**状态**: 已接受，生产门禁由 ADR-036/T6.10 复核
**日期**: 2026-07-15（决策）/ 2026-07-16（初始实施）/ 2026-08-31（实施状态同步）/ 2026-09-04（规格复审）
**决策人**: AI Agent（基于 T0.4 横评实测）
**关联**: ADR-005、T0.4 横评文档、Phase 1 T1.2

> **2026-09-04 supersession update**：ADR-036 将产品验收从框架名称改为真实 PTY 行为门禁。OpenTUI 继续作为目标候选，但只有当前稳定版本同时通过首帧、输入、流式更新、resize、退出与资源清理才能成为生产默认。显式 renderer 不可用时 fail-closed，不得静默切换。Route 的最终选择以 T6.10 的 renderer matrix 证据为准。

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
目标候选 = OpenTUI + SolidJS（OpenCode-style build pattern；生产资格受 ADR-036 行为门禁约束）
Fallback = Ink + shared TuiShell view model / reducer
Rejected = Rezi（当前 npm registry 下不存在为 TUI 框架）
```

### 选择 OpenTUI+SolidJS 为目标候选的理由

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

### Phase 1 T1.2 TuiShell 实现（✅ 已完成，2026-07-16）

```
TuiShellViewModel / TuiShellEvent / reducer: framework-independent ✅
OpenTUIRenderer: 目标 renderer 已实现；package range 为 ^0.4.3，当前 lock 解析为 0.4.5，T6.10 将复验当前稳定版本
InkRenderer: 已实现的交互式 fallback（src/renderers/ink-renderer.tsx）
ANSI renderer: 当前生产交互入口使用，直至 T6.10/DEF-025 解决 OpenTUI 动态更新阻塞
Renderer selector: 已实现能力与显式配置策略，但尚未接入 entry.ts
```

实施细节：
- `tui-shell.ts`：纯 TypeScript State/Event/reducer，无框架依赖
- `renderer.ts`：`TuiRenderer` 抽象接口（`start(state, dispatch) => Promise<void>`）
- `opentui-renderer.tsx`：SolidJS App 组件，集成 `tuiShellReducer` 驱动状态
- `entry.ts`：`startTui()` 入口，非 TTY 环境优雅降级
- `tsconfig.base.json`：`jsxImportSource: "@opentui/solid"`

### 2026-08-31 实施状态同步

后续真实渲染验证发现 OpenTUI 0.4.3 native render loop 启动后会阻塞 JS event loop，导致计时器、输入回调和服务端流式更新无法继续。该证据已记录在 `DEF-025`，生产交互入口因此暂时直接使用 ANSI renderer。2026-09-04 评审确认旧版本证据不能永久替代当前版本复验，也不能继续把框架名称写成产品 AC；T6.10 按 ADR-036 先运行真实 PTY matrix，再依据行为证据选择生产 renderer。

### OpenTUI 交互式 shell 验证状态

- ⚠️ OpenTUI 0.4.3 仅证明首帧；输入回调、计时器与异步更新失败，因此未通过生产交互门禁
- ⏳ 长日志和 scrollback（Phase 3-4 随 agent 交互逐步实现）
- ⏳ Markdown 渲染（Phase 3 随工具调用卡片实现）
- ⏳ 工具调用卡片（Phase 3 T3.4c ToolDispatcher 实现）
- ✅ 输入行（Input 组件已验证）

### Ink fallback 状态

Ink 16/16 通过 T0.4 横评，且仓库已经实现 `src/renderers/ink-renderer.tsx`。现有测试主要使用 mocked Ink 模块，T6.10 仍需用与 OpenTUI 相同的真实 PTY 门禁验证；通过后才能在 OpenTUI 未通过时作为生产交互 renderer。`TuiRenderer` 接口与 shared reducer 保持 renderer 可替换。

## 后果

### 正面
- OpenTUI+SolidJS renderer 已在 Phase 1 实现（PR #2），但当前生产入口因 DEF-025 暂用 ANSI
- OpenTUI + SolidJS 对齐 OpenCode，长期可复用 TUI 经验
- framework-independent reducer 设计已在实际实现中验证（TuiShellState/TuiShellEvent/tuiShellReducer 纯函数不依赖任何渲染器）
- `TuiRenderer` 接口使 renderer 可无痛切换（后续 Ink/其他 renderer 只需实现接口）

### 负面
- OpenTUI 0.4.3 的 `onSubmit` 类型定义存在交并兼容问题，当前通过 `onInput` 绕过
- 长会话 scrollback、Markdown 渲染、工具调用卡片等高级 TUI 能力待 Phase 3-4 逐步实现

## 参考

- `docs/02-architecture/架构设计文档.md` §3 — TuiShell 组件职责
- `docs/02-architecture/技术选型文档.md` §5 — 交互层 CLI 与 TUI
- `~/Desktop/横评/T0.4 TUI backend 横评.md` — 三路横评 + T0.4b OpenTUI 补充验证
- `docs/decisions/ADR-005` — 可插拔 Backend 架构
