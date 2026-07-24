# ADR-010: Agent Harness Runtime 边界——自研编排/权限/生命周期，复用 AI SDK + MCP

**状态**: Accepted
**日期**: 2026-07-16
**决策人**: AI Agent（基于 Harness Runtime 架构与实施报告）
**关联**: ADR-001（去风险 MVP）、ADR-005（可插拔 Backend 架构）、AGENTS.md §4 架构与命名

## 背景

iTestAgent 需要一个 Agent Harness Runtime 来编排 iPhone 真机测试的全流程：意图理解 → 计划确认 → 构建/安装 → 执行 → 证据采集 → 失败归因 → 报告。

关键问题：Harness 的自研边界在哪里？哪些能力复用成熟库，哪些必须自研？

当前状态（Phase 1 进行中）：
- T1.1 CLI/Config 已完成（PR #1 合并到 dev-1.0）
- T1.3b 核心接口契约、T1.3 Server/Engine 尚未实现
- `itestagent-engine/src/index.ts` 和 `itestagent-server/src/index.ts` 仍为 `export {};`
- AI SDK、MCP TS SDK 尚未安装或锁定版本

## 方案对比

### 选项 A：全自研 Agent 平台
- 自研 tool-calling、message model、stream protocol、MCP 替代
- 优势：完全控制
- 劣势：重复造轮子，与 R2（不自研已复用底座）冲突，开发周期极长

### 选项 B：直接使用 OpenCode core
- Fork/import OpenCode 的编排内核
- 优势：成熟 TUI/loop/permission 模式
- 劣势：OpenCode core 是 private/未发布/绑 Effect-TS + SQLite 事件溯源，与 R10 冲突

### 选项 C（决策）：轻量领域化 Harness——自研编排策略层 + 复用成熟原语
- 自研：Agent loop policy、PermissionEngine、RunStateMachine、iPhone 测试语义
- 复用：Vercel AI SDK（multi-step tool-calling）、MCP TS SDK、Provider、Appium/WDA、xcodebuild、xctrace、XcodeProj
- 禁止：fork OpenCode core、Effect-TS 全局编排、SQLite 事件溯源、通用 Agent hosting 平台

## 决策

采用 **选项 C**：轻量领域化 Harness Runtime。

### 自研与复用边界

| 能力 | 分类 | 说明 |
|---|---|---|
| Agent loop policy | 自研 | continue/idle/abort/run coordination |
| AgentRuntime interface | 自研 | `streamTurn/executeToolCall/abort` |
| LLM stream/tool primitives | 采用 | Vercel AI SDK multi-step tool-calling |
| Tool protocol | 采用 | MCP TS SDK |
| Provider compatibility | 采用 | AI SDK/OpenAI-compatible，不自研 router |
| PermissionEngine | 自研 | allow/ask/deny、记忆规则、高风险拦截 |
| RunStateMachine | 自研 | 生命周期、暂停/恢复/取消、错误状态 |
| Project/Test semantics | 自研 | Profile/TestPlan/Flow/断言/归因/baseline |
| Device/Perf/Build | 复用+适配 | 只自研接口和归一化，不重写底座 |
| Storage | 采用+封装 | bun:sqlite/Drizzle/filesystem/Keychain |
| OpenCode | 借鉴不依赖 | 借鉴 TUI、loop、permission 模式 |

### 运行时原语复用约束

Harness 的自研范围只包括领域 policy；实现阶段必须复用以下成熟原语：

| 场景 | 必须优先复用 | iTestAgent 只扩展 |
|---|---|---|
| 多步 tool loop | AI SDK `streamText/generateText`、`tool.execute`、`stopWhen`、`prepareStep`、step-count helper | 权限暂停、backend fallback、Run 状态、人机恢复 |
| 消息与流 | AI SDK `UIMessage`、message parts、tool-call/tool-result parts、data stream | run/permission/artifact/backend progress events |
| 取消 | 单 Run `AbortController/AbortSignal` + AI SDK abort + `Bun.spawn({signal})` | 取消策略、grace timeout、资源清理 |
| 重试 | 统一轻量 retry primitive（先验证 Bun/ESM/运行时版本兼容；可选 `p-retry` 或统一 adapter） | L1-L4 业务分类和可重试错误判定 |
| Schema | Zod 4 `toJSONSchema` 或等效生成 | iTestAgent 领域 contract |

**推荐数据链**：
```
Zod contract（唯一源码）
├─ Runtime parse / TS inference
├─ MCP tool 直接消费 Zod schema
└─ 使用 Zod 4 z.toJSONSchema 生成 schemas/*.json
```

**推荐流式链**：
```
AI SDK stream parts -> AgentEvent adapter -> SSE -> OpenTUI
```

**推荐取消链**：
```
Run AbortController -> AI SDK -> MCP tool -> Backend -> Bun.spawn
```

不要另造平行的 assistant/tool message model、取消 token、tool loop 或散落在各 backend 的 retry 实现。

### Harness 核心组件

1. **AgentRuntime**：包装已锁定版本的 AI SDK；负责 stream/event/abort，不直接执行设备命令
   ```
   interface AgentRuntime {
     streamTurn(input: AgentTurnInput): AsyncIterable<AgentEvent>;
     executeToolCall(call: ToolCall): Promise<ToolResult>;
     abort(reason: string): Promise<void>;
   }
   ```

2. **PermissionEngine**：`{action, resource, effect: allow|deny|ask}`；所有 tool call 必须经过权限层

3. **RunStateMachine**：`created → planning → awaiting_confirm → preparing_device → building_installing → executing → collecting → parsing → explaining → reported → done`；异常分支：cancelled/blocked/infra_failed/failed

4. **SessionManager**（建议显式组件）：session 创建/关闭、workspace、runId、SSE subscriber、session 隔离

5. **ToolRegistry/ToolDispatcher**（建议显式组件）：`ToolCall → Zod parse → PermissionEngine → BackendSelector → backend method → normalize ToolResult → RunStep/Artifact → AgentEvent`

6. **BackendSelector**（建议显式组件）：Engine 负责选择和 fallback policy；Server 负责子进程启动/signal forwarding/timeout/回收

7. **ContextBuilder**（建议显式组件）：输入 ProjectProfile/Intent/TestPlan/Run state；禁止 secret 明文和大体积原始证据进入模型上下文

### Harness Event Model

```
session.started → turn.started → assistant.delta → tool.requested
→ permission.requested → permission.resolved → tool.started → tool.progress
→ tool.completed/tool.failed → run.state.changed → artifact.created
→ turn.completed → session.idle/session.aborted
```

要求：有序、可追踪、terminal event 唯一、SSE 可重连、不同 session 隔离。

### 人在环路检查点

Harness 必须把以下行为实现为状态和事件，不能只写进 prompt：
1. 候选核心链路确认
2. TestPlan 开始/修改/取消
3. 探索动作确认/纠偏
4. 真实账号/OTP 内存输入
5. PermissionEngine ask/deny
6. 接受新 baseline
7. 覆盖/固化 Flow
8. 生成/写入测试代码草稿

### Abort、超时与子进程

```
TUI cancel → server command → AgentRuntime.abort → ToolDispatcher cancel
→ backend AbortSignal → child SIGTERM → grace timeout → SIGKILL if needed
→ release WDA ports/tunnels/files → RunStateMachine cancelled/failed
→ preserve partial evidence index
```

不变量：
- abort 幂等
- session 结束后无 pending tool
- 无 orphan child process
- 已生成 evidence 仍可索引
- ask 可取消且有 timeout
- 同一设备串行，不同设备可并行

### 安全与可靠性

- **Permission**：高风险（清数据/卸载/写项目/凭证/baseline/Flow/草稿/非 HTTP URL/隐私媒体）默认 ask
- **Secret**：TUI input → session memory → valueRef → backend → clear memory；记住时才写 Keychain；禁止 secret 写 JSONC/prompt/history/RunStep/log/result
- **Error levels**：L1 瞬态（3 次指数退避）/ L2 需确认（暂停等待用户）/ L3 阻断（中止+doctor 建议）/ L4 不确定（inconclusive，不编造）
- **Fallback**：healthcheck fail → next backend；语义变化 → ask user；reason → result
- **Evidence**：ArtifactRef 带 redactionStatus；隐私截图/视频默认 `raw-local-only`；日志写入前脱敏；外传前脱敏或询问

## 后果

### 正面
- 约 1/10 OpenCode 复杂度获 90% 收益
- 领域 policy 自主可控
- 复用成熟原语降低实现风险
- 可插拔 Backend 不绑定单一工具

### 负面
- AI SDK major version 尚未 pin，部分 API 名称版本敏感
  - 缓解：T1.3 必须先 pin AI SDK major，再采用对应名称
  - `streamText`、`generateText`、`stopWhen`、`prepareStep`、`abortSignal` 跨版本稳定
  - `stepCountIs(n)`(v6) vs `isStepCount(n)`(v7) 等需按锁定版本确认
- RunStateMachine 需要明确 owning task
  - 缓解：新增 T1.3c 或纳入 T1.3

## 非目标

- 不 fork/import OpenCode core
- 不引入 Effect-TS 全局编排或 SQLite event sourcing
- 不做通用 Agent hosting 平台
- 不自研 tool-calling/MCP/Appium/WDA/xcodebuild/xctrace
- 不做云中心服务或强制登录
- 不承诺精确实时 FPS
- 不逆向 .trace 或使用 Apple 私有框架
- 不把未确认链路当事实
- 不允许模型绕过权限层
