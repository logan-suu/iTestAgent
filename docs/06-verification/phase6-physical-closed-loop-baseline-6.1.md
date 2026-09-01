# T6.1 真机全闭环契约与 RED 失败基线

## 1. 结论

T6.1 已将 Phase 6 的生产闭环出口固化为 AST/数据流语义契约。当前生产入口尚未贯通，专用 RED 运行结果为 **3 matcher pass / 11 contract fail / exit 1**，与开发计划中锁定的实现偏移一致。

本报告只证明“缺口可复现、后续修复有稳定验收目标”，不证明真机闭环已完成，不替代 T6.11 的自动化闭环测试或 T6.12 的当前真机 G5 证据。

## 2. 锁定的生产调用图

目标调用图：

```text
itestagent (TUI)
  -> real workspace + real device discovery
  -> ProjectProfile + Intent
  -> TestPlan draft
  -> TUI modify / confirm / cancel
  -> confirmed TestPlan (single source of truth)
  -> readiness + app source + build/install/launch
  -> route A: xcodebuild test -> xcresult -> parser
     or route B: Appium DeviceBackend -> dynamic actions -> RunSteps -> Flow
  -> evidence + normalized result
  -> RunStore(~/.itestagent/runs/<run_id>)
  -> plan.yaml + summary.md + result.json + artifact-index.json + artifacts/
  -> itestagent explain <run_id>
  -> itestagent rerun <run_id> --failed-only -> child run(parentRunId)
```

闭环不变量：

1. 用户可达的生产 TUI 不注册 `MockDeviceBackend`，也不返回固定成功的项目/设备 probe。
2. TestPlan 未确认不得执行；确认后的 TestPlan 驱动动作、证据策略和双路径选择。
3. 高风险操作经过 `PermissionEngine`，生产组合不得安装 allow-all 规则。
4. Appium 不可用时显式失败或按已确认策略处理，不得静默切换 mock/dry-run。
5. 同一 `runId` 贯穿计划、执行、证据、报告、解释；重跑创建带 `parentRunId` 的新 run。
6. 组件测试、独立 backend spike、手工构造报告输入不能作为生产闭环完成证据。

## 3. 当前生产调用图与源码证据

```text
itestagent (TUI)
  -> createAgentSession
  -> MockDeviceBackend + registry('mock')
  -> PermissionEngine allow-all
  -> canned analyzeProject / canned getDeviceInfo
  -> AiSdkAgentRuntime

itestagent explore
  -> real Appium exploration runtime
  -> fixed launch + screenshot
  -> temporary run directory
  -> artifact-index only

itestagent test
  -> runXcunitFlow -> xcodebuild + xcresult parser
  (独立入口，未接同一生产 run/report)

itestagent run flow --execute
  -> Appium dynamic import
  -> import failure => MockDeviceBackend dry-run fallback

itestagent explain
  -> RunStore -> FailureExplainer

itestagent rerun --failed-only
  -> load result + plan -> print pending message
  -> no execution dispatch / no child run
```

证据位置：

- `packages/itestagent-tui/src/agent-session.ts:8,185-193`：导入并注册 mock，安装 allow-all 权限规则。
- `packages/itestagent-tui/src/agent-session.ts:92-120`：项目分析与设备信息为固定返回。
- `packages/itestagent-cli/src/cli.ts:319-336`：临时 run 目录及固定 launch+screenshot 动作。
- `packages/itestagent-cli/src/cli.ts:599-607`：rerun 明确声明 execution wiring 尚未接入。
- `packages/itestagent-cli/src/cli.ts:721-733`：Flow 执行在 Appium 导入失败时切换 mock dry-run。

## 4. AC 矩阵

| US | 本任务锁定的闭环要求 | 当前基线 | 后续任务 |
|---|---|---|---|
| US-4.1 | TUI 从真实 workspace 和设备状态启动生产会话 | RED：TUI 使用 mock/固定结果 | T6.2 |
| US-5.2 | 显示并允许修改/确认/取消计划；未确认不执行 | RED：生产 TUI 无完整计划确认到执行链 | T6.3 |
| US-6.1~6.2 | TestPlan 驱动 App 来源、构建、安装和生命周期 | RED：未接 TUI 同一 run | T6.4 |
| US-7.1 | 确认前解析并锁定可执行 XCUITest 配置，走 xcodebuild -> xcresult -> parser -> report；执行后不跨路径 fallback | 部分组件存在，未接生产闭环 | T6.5/T6.8 |
| US-8.1 | 显式选择或 auto 无可执行 XCUITest 配置时由 DeviceBackend 执行，并禁止从已失败 XCUITest 静默切入 | RED：CLI 固定 launch+screenshot | T6.5/T6.6 |
| US-9.1 | 每步记录动作、目标、结果和证据引用 | 部分组件存在，未接生产 run | T6.6 |
| US-9.2 | 可重放 Flow，生产执行不得静默 mock | RED：Appium import 失败切换 mock | T6.7 |
| US-13.1 | 证据关联具体 run step/case | RED：探索只输出临时 artifact index | T6.6/T6.8 |
| US-14.1 | explain 消费同一 run 的真实证据并显式表达不确定性 | 组件存在，缺少生产闭环输入 | T6.8/T6.9 |
| US-15.1 | 同一 run 固定输出三件套与 artifacts 目录 | RED：explore 未调用 RunStore/ReportSynthesizer | T6.8 |
| US-16.1 | failed-only 真正执行、复用原计划并记录 parentRunId | RED：只读取和打印 | T6.9 |
| US-17.1 | Agent loop 调用真实工具；同设备串行、不同设备可并发 | RED：TUI 工具组合使用 mock/固定结果 | T6.2/T6.5/T6.10 |
| US-17.2 | 高风险操作 ask；deny 阻止；拒绝停止循环 | RED：TUI 生产组合 allow-all | T6.10 |

## 5. 可执行 RED 契约

测试文件：`tests/integration/phase6/phase6-physical-closed-loop-contract.test.ts`

默认门禁运行：

```sh
bun test tests/integration/phase6/phase6-physical-closed-loop-contract.test.ts
```

结果：

```text
3 pass
11 skip
0 fail
exit 0
```

显式 RED 运行：

```sh
ITESTAGENT_PHASE6_RED=1 bun test tests/integration/phase6/phase6-physical-closed-loop-contract.test.ts
```

环境与结果：

```text
Bun 1.3.14 (0d9b296a)
3 pass
11 fail
17 expect() calls
exit 1
```

失败项：

1. TUI 仍依赖 `MockDeviceBackend` 模块。
2. TUI 仍安装语义上的 allow-all 权限规则。
3. TUI 未实际调用真实项目分析器。
4. TUI 未实际调用真实设备发现。
5. explore 没有把解析后的已确认 TestPlan 传入执行调用。
6. explore 仍内嵌固定 launch+screenshot 动作。
7. explore 没有从默认 RunStore 获取 run 目录。
8. explore 没有实际执行 `ReportSynthesizer.write()`。
9. Flow 执行仍依赖 mock backend 模块。
10. rerun 仍未调用生产执行调度。
11. rerun 仍未通过 `insertRun` 创建带 `parentRunId` 的 child run。

契约通过 TypeScript AST 识别生产 command action、模块依赖、真实调用、对象语义和关键数据流；注释、未使用 import、别名或格式变化不能使契约转绿。3 个常规 matcher 回归测试明确覆盖这些防假绿条件。专用环境开关用于保存可提交的 RED 基线，同时不让预期失败永久破坏普通质量门禁。后续 T6.2-T6.10 应逐项使这些断言转绿；T6.11 负责将闭环升级为真实跨包行为测试并移除 RED 开关。

## 6. 限制与门禁声明

- 本测试检查用户可达生产入口的 AST/数据流组合约束，但它仍不是设备行为测试。
- 本任务没有修改 physical 或 simulator 行为，因此没有新增 G5/G5-SIM 证据。
- `DEF-025/029/030/031/032` 仍为 Phase 6 open，必须在 M6-PHY 出口逐条处置。
- 当前任务继续保持 `in_progress`；代码类任务需要通过 `$commit-pr-itest` 建 PR，合并后再由 `$pr-merge-itest` 完成状态转换。

## 7. Check 结果

```text
Contract default: PASS (3 matcher pass / 11 intentional RED skips / 0 fail)
Contract RED:     EXPECTED RED (3 matcher pass / 11 contract fail / exit 1)
Typecheck:        PASS (tsc --noEmit -p tsconfig.base.json)
Lint:             PASS (biome check .; 781 files)
G7:               PASS (7 pass / 0 fail)
JSON parse:       PASS (task-status.json + deferred-items.json)
Full tests:       PASS (3349 pass / 13 skip / 0 fail; 312 files)
```

在受限执行环境运行全库 `bun test` 时，macOS Keychain 写入授权不可用，既有 `packages/itestagent-cli/test/keychain-secret-store.test.ts` 出现 3 个 `security` exit 152。随后在获准访问 macOS Keychain 的环境重跑相同命令，结果为 **3349 pass / 13 skip / 0 fail**，证明首次失败属于执行环境限制而非代码缺陷。
