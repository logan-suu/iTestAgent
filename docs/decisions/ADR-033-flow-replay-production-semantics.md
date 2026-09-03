# ADR-033：Flow 生产重放语义与责任边界

**状态**：Accepted

**日期**：2026-09-02
**决策者**：Logan Su

---

## 背景

T6.7 规格评审发现，US-9.2 只规定“支持 `itestagent run flow <flowId>` 重放”，未锁定默认是执行还是校验、多 target Flow 的目标解析、Flow 状态门禁、backend 选择和证据边界。当前 CLI 默认只校验，只有传入 `--execute` 才执行；执行分支使用错误 workspace 包名和构造方式，并在失败时切换 MockBackend。这与命令名称、Target-explicit 与 R5 不一致。

现有 replay evidence 还会吞掉采集错误，生成空路径 UI tree ArtifactRef，并把原始 UI tree 标为 `safe`，与 US-13.1、ADR-031 和 ADR-032 冲突。T6.7 与 T6.8 之间也需明确“执行事实”与“统一持久化”的责任边界。

## 方案比较

### 方案 A：保留默认校验 + `--execute`

优点：现有 CLI 变化最小。
缺点：`run` 与 AC 声称重放却默认不执行；自动化容易得到假成功。

### 方案 B：默认生产重放 + 显式纯校验（决策）

优点：命令语义与 US-9.2 一致；纯校验仍有明确入口；配合目标、状态和权限门禁可以 fail-closed。
缺点：需要调整 CLI 参数和现有测试。

### 方案 C：始终从 Flow 首个目标推断设备

优点：参数少。
缺点：把 YAML 数组顺序当成用户意图，违反 Target-explicit，且对多目标 Flow 不安全。

## 决策

1. `itestagent run flow <flowId>` 默认执行生产重放。`--validate-only` 只执行 schema、状态、目标和能力校验，不启动 backend、session 或设备副作用。旧 `--execute` 不是 canonical 语义。
2. 重放前必须将目标显式解析为 `targetKind + device identity`。来源只能是命令参数或交互选择；不得从 `supportedTargetKinds` 或 `lastValidatedTargets` 数组顺序推断。跨 targetKind fallback 不得静默发生。
3. `confirmed` Flow 可重放。`draft` Flow 只能在本次交互确认后重放，且本次确认不改写 Flow；非交互模式返回 blocked。`deprecated` Flow 返回 blocked。
4. BackendSelector 是唯一 backend 选择组件，输入至少包含 targetKind、Flow `requiredCapabilities`、显式偏好与 lightweight healthcheck。设备 discovery/配对只证明候选对象存在，已配对 physical 设备在 CoreDevice tunnel 尚未按需建立时不能仅因 disconnected 状态判为 unhealthy；BackendSelector 选定单一 backend 后，组合入口必须另行执行 session/WDA active readiness。该 active readiness 一旦开始便已进入选定路线，失败时必须结构化返回并在同一路线修复后重试，不得改选其他 backend。`requiredCapabilities` 是可扩展字符串集合，canonical 词汇为 `appLifecycle | uiTree | screenshot | coordinateTap | swipe | textInput | pressButton | openUrl | video | logs | crashLogs | visualScreenshot | visualTap | location | push`。Flow compiler 必须从实际 steps 推导而非从 backend 名称推测；仅 comment/wait 的 Flow 允许空集合。BackendSelector 先归一化 backend 能力再比对，未知能力必须以 unsupported 失败关闭。生产重放禁止加载或 readiness 失败后切换 MockBackend/dry-run。
5. 能力、配置、设备、Appium/WDA 或 readiness 不足时 fail-closed，输出结构化 blocked/infra failure、原因与可执行修复建议。
6. 重放组合入口负责 session/readiness 前置，并在成功、失败、blocked 和取消路径执行同 owner 清理。若 cleanup 自身失败，返回值必须显式标为结构化 infra failure，保留已完成的 replay step/evidence 事实和更早的失败上下文，不得以 finally rejection 覆盖或静默吞掉。abort 继续遵循 ADR-010；DEF-029/DEF-033 的全链路取消与子进程收口仍由 T6.10 负责，T6.7 不得提前宣称已解决。
7. FlowStep v2 增加可选 `caseId`，Flow compiler 必须保留录制时的 case 语义。这是兼容性增量，按 ADR-022 不提升 schemaVersion；旧 Flow 无该字段时仍可读取。T6.7 产生真实、稳定且可关联的 replay step/evidence 事实：`stepId`、严格递增 `sequence`、`targetKind`，当 Flow 步骤带有 case 语义时保留 `caseId`。T6.8 负责用单一 RunStore/RunWriter 写入 SQLite、`steps.json`、artifacts 和报告三件套。
8. 证据结果必须显式区分 `success | not_requested | not_applicable | unsupported | failed`。采集失败不得静默吞掉；只有指向当前 run 隔离目录中普通、非空文件且脱敏状态正确的证据才能生成 ArtifactRef，禁止空路径、目录路径或伪造产物。T6.8 RunStore 接入前，T6.7 可使用按 runId 隔离的本地 staging artifacts，但不得使用跨 run 共享的原始证据目录。
9. secret 仅以内存值或 SecretRef 传递。screenshot、video、UI tree 原文属于 ADR-032 `raw-local-only` 域，目录权限至少为 `0700`、原始文件权限至少为 `0600`，不得标为 `safe`或进入模型、报告正文或外部传输。`typeText` 不能把空字符串当作已执行输入；空值是无效 no-op 并必须显式 blocked，未来清除已有内容应建模为独立 action。
10. 重放默认不改写 Flow/`lastValidatedTargets`。若用户要求回写当次验证目标，必须单独经过 `overwrite_flow` 确认，并由 canonical Flow writer 执行。
11. T6.7 必须对生产真机路径完成 G5；由于 CLI 和 replay engine 是双目标共享能力，同时完成 G5-SIM 回归。验证只能宣称真实运行时已证明的能力。
12. Flow 查找语义必须确定：未传 `--project` 时仅查找 `~/.itestagent/flows`；传入 `--project` 时先查项目 `.itestagent/flows`，未命中才 fallback 全局。同一 flowId 同时存在时项目级胜出，CLI 必须输出实际命中的来源与路径类型。
13. 依赖方向固定为 `itestagent-engine → itestagent-flow`：Flow 包只承载 schema、读取、编译与 backend-agnostic replay；Engine 负责生产 backend 装配、BackendSelector、目标和 readiness。禁止让 Flow 包反向依赖 Engine 或具体 backend。

## 后果

### 正面

- `run flow` 与用户心智模型、US-9.2 一致。
- 多目标 Flow 保留可移植性，同时不牺牲 Target-explicit。
- 生产失败不再被 mock 假成功掩盖。
- T6.7 与 T6.8 的事实/持久化边界可独立测试。
- 同 ID Flow 的解析结果可预期且可审计；case 关联从录制到重放不丢失。

### 负面

- CLI 存在行为变更，旧 `--execute` 调用方需迁移到默认执行或 `--validate-only`。
- draft Flow 和目标选择需要交互/非交互双模式测试。
- 证据失败语义需要显式 contract，不能继续使用空数组代表所有原因。
- Flow schema/compiler、读取 API 和 backend 能力归一化都需要兼容性改造。

## 验证要求

- CLI 测试证明默认路径调用生产重放，`--validate-only` 不启动 backend/session。
- 测试覆盖 confirmed/draft/deprecated 与交互/非交互组合。
- 测试证明 targetKind/device 不由 Flow 数组顺序推断，且 requiredCapabilities 在 backend 选择前校验。
- 测试覆盖 FlowStep `caseId` 新旧数据兼容，requiredCapabilities 按 steps 推导、空集合和未知能力失败关闭。
- 测试覆盖未传 `--project`、项目命中、全局 fallback 和同 ID 项目优先，并断言实际来源输出。
- 生产代码和可达调用图不得依赖 MockDeviceBackend/dry-run fallback。
- 测试覆盖证据五态、非空路径、step/case 关联和 `raw-local-only` 边界。
- G5 在真实 iPhone 上运行至少一个 confirmed Flow；G5-SIM 在真实 CoreSimulator runtime 上回归相同生产命令与共享 replay engine。

## 关联文档

- ADR-010：Agent Harness Runtime Boundary
- ADR-011：iOS Simulator First-Class Support
- ADR-022：Persisted Schema Migrations
- ADR-031：Run、Case、Step、Evidence 关联与自包含 Run 目录
- ADR-032：本地原始证据、模型安全投影与语义 UI 风险边界
- US-9.2：可重放 Flow
- US-13.1：自动采集证据
