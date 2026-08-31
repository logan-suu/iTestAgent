# Task 6.2 G5 / G5-SIM 设备发现验证报告

**任务**：T6.2 TUI 生产 AgentSession 组合

**验证时间**：2026-08-31

**环境**：macOS 26.5（25F71）、Xcode 26.5（17F42）

## 验证范围

本报告只验证 T6.2 新增的生产设备发现链路：

```text
TUI AgentSession
  -> AppiumDeviceBackend.listDevices()
  -> shared device-discovery adapter
  -> devicectl（physical）+ simctl（simulator）
```

测试计划编译、设备操作、运行证据和报告生成分别属于 T6.3、T6.5 与 T6.8，不在本次 G5/G5-SIM 结论范围内。

## 验证步骤与证据

### G5：真实 iPhone 发现

通过仓库中的 `discoverDevices()` 生产实现执行真实 `xcrun devicectl list devices --json-output`，未注入 fixture 或 mock。结果成功解析出：

- physical 设备：1 台
- 连接状态：booted/connected
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

## 自动化证据

- `packages/itestagent-backends/device-appium/test/device-discovery.test.ts`：5 项解析与失败关闭测试通过。
- `packages/itestagent-tui/test/agent-session.test.ts`：真实组合 seam、双目标状态、禁止静默跨目标选择、权限桥与未接能力显式阻断测试通过。
- Phase 6 RED contract 中归属 T6.2 的 4 项已转绿：无生产 mock、无 allow-all、真实 analyzer 可达、真实 `listDevices()` 可达。

## 限制与后续责任

- 本次未启动 Appium WebDriver 会话，也未执行 WDA 操作；这些不属于 T6.2 的设备发现职责。
- TUI 当前仍由既有 ANSI 入口启动；OpenTUI 主线切换由 T6.10/DEF-025 负责，本任务不将 renderer 现状伪报为已解决。
- AgentSession 默认只绑定明确发现的 physical 设备；即使存在 booted Simulator，也不会静默跨目标回退。Simulator 执行目标选择由后续计划/执行任务显式传入。
