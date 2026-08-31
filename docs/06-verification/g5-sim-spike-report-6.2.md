# Task 6.2 G5 / G5-SIM 设备发现验证报告

**任务**：T6.2 TUI 生产 AgentSession 组合

**验证时间**：2026-08-31

**环境**：macOS 26.5（25F71）、Xcode 26.5（17F42）

## 验证范围

本报告只验证 T6.2 新增的生产设备发现链路：

```text
TUI AgentSession
  -> Engine production session composition
  -> DeviceDiscoveryProvider contract
  -> Appium discovery provider
  -> devicectl（physical）+ simctl（simulator）
```

CLI `devices` 同样通过 `DeviceDiscoveryProvider` 暴露详细发现结果；发现发生在目标选择之前，因此不要求预先构造绑定 UDID 的 `DeviceBackend`。目标选定后的设备操作仍严格走 `BackendSelector -> DeviceBackend`。

`DeviceDiscoveryProvider.discover({ lanes })` 支持限制发现通道；CLI 的 `--physical-only` / `--simulator-only` 只启动请求的 provider lane，不先执行无关命令再过滤结果。

测试计划编译、设备操作、运行证据和报告生成分别属于 T6.3、T6.5 与 T6.8，不在本次 G5/G5-SIM 结论范围内。

## 验证步骤与证据

### G5：真实 iPhone 发现

通过仓库中的 `discoverDevices()` 生产实现执行真实 `xcrun devicectl list devices --json-output`，未注入 fixture 或 mock。结果成功解析出：

- physical 设备：1 台
- 连接状态：paired/available（physical 不伪装为 Simulator boot state）
- 设备 UDID 与用户设备名称未写入报告，避免不必要的本机标识留档

结论：**通过（限设备发现能力）**。

### G5-SIM：CoreSimulator 发现

同一次 `discoverDevices()` 调用执行真实 `xcrun simctl list devices --json`，并通过共享解析器得到：

- Simulator：35 台
- booted：2 台
- shutdown：33 台
- runtime 覆盖 iOS 17.5、18.2、26.5

另外直接执行 `xcrun simctl list devices --json`，确认 CoreSimulatorService 返回的原始设备集与适配器汇总一致。

结论：**通过（限设备发现能力）**。

### 评审修复后复验（2026-08-31）

评审修复引入 `ok / partial / failed` 聚合状态、分通道 limitation、Simulator 状态归一化与 ready 判定后，重新执行生产 `discoverDeviceInventory()`，并对每条结果运行 `DeviceInfoSchema.parse()`：

- discovery status：`ok`，physical/simulator 两通道均无 issue
- physical：1 台，保持显式 `targetKind: physical`，不写入 Simulator state
- Simulator：35 台，其中 booted 2 台、shutdown 33 台
- 所有真实设备记录均通过运行时 schema；shutdown Simulator 保留在 discovered 清单，但不计为 ready
- 本报告继续省略设备名称与 UDID，避免本机标识不必要落盘

结论：**修订后的发现状态与 ready 语义通过 G5/G5-SIM 复验**。

### Provider 契约与 CLI 等价性复验（2026-08-31）

将预选择发现抽象为 contracts 包中的 `DeviceDiscoveryProvider` 后，分别执行 Appium provider 与 CLI provider 的真实实现。两者未注入 fixture 或 mock，并得到完全一致的汇总：

- discovery status：`ok`
- physical：1 台
- Simulator：35 台
- booted Simulator：2 台
- issues：空数组

失败诊断在进入 `DeviceDiscoveryIssue` 前会进行敏感值脱敏并限制为 2,000 字符，避免工具 stderr 将凭证或无界输出带入 TUI、CLI 日志与报告。进程归属依 ADR-023：provider、backend 与 Server 分别管理自身启动的进程；Server 不再被描述为全部子进程的唯一 owner。

结论：**预选择发现契约合理，Appium 与 CLI 两个生产 provider 均通过 G5/G5-SIM 等价性复验**。

## 自动化证据

- `packages/itestagent-backends/device-appium/test/device-discovery.test.ts`：7 项覆盖双通道聚合、partial limitation、状态归一化、schema 安全与临时路径唯一性。
- `packages/itestagent-contracts/test/device-discovery.test.ts`：覆盖 provider snapshot、lane、issue 与状态的运行时契约。
- `packages/itestagent-cli/test/devices/format.test.ts`：覆盖 CLI 对 partial/failed discovery limitation 的显式输出。
- `packages/itestagent-tui/test/agent-session.test.ts`：覆盖 Engine 生产组合 seam、failed discovery 显式呈现、刷新事件、双目标状态、权限桥与未接能力显式阻断。
- `packages/itestagent-engine/test/tool-dispatcher.test.ts`：覆盖 nullable 自定义参数不会在设备锁提取阶段崩溃。
- 评审修复定向回归与架构测试：211 pass / 0 fail。
- Provider 契约、CLI/Appium 等价性及架构定向回归：123 pass / 0 fail。
- 全库门禁：typecheck 0、lint 0；`bun test` 在具备 Keychain/CoreSimulator 权限的环境以 3370 pass / 13 skip / 0 fail 完整通过。单 lane 修复后 `devices --simulator-only` 从约 6.3 秒降至约 0.21 秒，且 provider 单元测试确认不启动未请求通道。
- Phase 6 RED contract 中归属 T6.2 的 4 项已转绿：无生产 mock、无 allow-all、真实 analyzer 可达、真实 `listDevices()` 可达。

## 限制与后续责任

- 本次未启动 Appium WebDriver 会话，也未执行 WDA 操作；这些不属于 T6.2 的设备发现职责。
- TUI 当前仍由既有 ANSI 入口启动；OpenTUI 主线切换由 T6.10/DEF-025 负责，本任务不将 renderer 现状伪报为已解决。
- AgentSession 默认只绑定明确发现的 physical 设备；即使存在 booted Simulator，也不会静默跨目标回退。Simulator 执行目标选择由后续计划/执行任务显式传入。
