# Task 6.10 G5 / G5-SIM 验证报告

**日期**：2026-09-04
**任务**：真机闭环可靠性与安全收口
**当前结论**：自动化门禁、G5-SIM 与真机 Route B G5 均已通过。

## 验证范围

- OpenTUI、Ink、ANSI 在真实 PTY 中的首帧、逐字符输入、提交、resize 与退出清理。
- 三层 JSONC 配置、显式 renderer fail-closed 与可观察选择原因。
- 高风险 `allow` 仅对当前动作有效；只允许全局持久化 `deny`，并支持查看与撤销。
- 首次凭证默认仅当前进程使用；Keychain 保存单独披露、二次确认，并在写入后验证。
- 同一 `AbortSignal` 贯穿 production dispatcher、DeviceBackend exploration、xcodebuild 与 xcresult parser。
- Appium session 创建/删除采用有界 teardown；超时或取消使 backend/driver 终态且不可复用，并保留已完成结果。
- physical production 默认 Route B；Route C 只有显式 diagnostic 用途可选，无跨路线静默 fallback。

## 自动化门禁

| 检查 | 结果 |
|---|---|
| `bun run typecheck` | PASS |
| `bun run lint` | PASS：837 files |
| `bun run build` | PASS |
| `bun run gate:g1` | PASS：6 pass |
| `bun run gate:g4b` | PASS：19 pass |
| `bun run gate:g7` | PASS：7 pass |
| TUI suite | PASS：469 pass / 0 fail |
| T6.10 关键回归 | PASS：Appium suite 110 pass；runtime/dispatcher/TUI signal bridge 89 pass |
| `bun test` | PASS：3576 pass / 40 skip / 0 fail（341 files） |
| `git diff --check` | PASS |

真实 PTY 的完整环境、行为矩阵和原始 byte 观察值见 `docs/06-verification/tui-renderer-matrix-6.10.md`。

## G5-SIM

环境：

- iPhone 16 Pro，iOS 18.2 Simulator；设备标识仅以运行时参数注入。
- Appium 3.6.0，本机 production `AppiumDeviceBackend`。
- App：Settings（`com.apple.Preferences`）。
- 独立 WDA/MJPEG 端口，避免接管其他 session。

### 正常 teardown

- Appium/CoreSimulator session 创建成功，Settings 启动成功。
- UI tree：38,780 bytes。
- 截图：214,152 bytes，`redactionStatus=raw-local-only`，只保存在本机临时目录。
- `closeSession` 返回 `status=closed`、`reusable=true`、`issues=[]`。

### 取消 teardown 与新实例隔离

首次复验发现一个真实缺陷：在进入 `closeSession` 前已经取消的 `AbortSignal` 不会通过后来注册的 listener 补发事件，旧实现会误报 `closed`。实现已增加同步 `signal.aborted` 检查并补充单元测试，修复后在同一 Simulator 重跑通过：

- 取消后的 cleanup 返回 `status=timed_out`、`reusable=false`、`issues=[session deletion aborted]`。
- 当前 backend 后续动作返回 `backend_not_reusable`，没有建立第二个 session。
- 等待晚到删除收敛后，使用独立新 backend 与端口建立 session 成功。
- 新 backend 正常 cleanup 返回 `status=closed`、`reusable=true`。

这证明 timeout/abort 不会把旧实例重新标记为可用，晚到完成也不会污染新 driver/backend 实例。

## G5 真机

环境：

- iPhone 14 Plus，iOS 18.2.1；设备与签名标识仅以运行时参数注入，未写入本报告。
- Developer Mode 与 DDI services 可用；Appium 3.6.0。
- App：Settings（`com.apple.Preferences`）。
- production Route B（external WDA URL）；临时 `iproxy` 与 WDA 均由本轮验证 owner 管理。

### 首轮失败与修复

首轮 session 与 WDA readiness 成功，但第一次读取 UI tree 时发生 `socket hang up`。清理审计确认 `iproxy` 已退出，但验证 owner 启动的 `xcodebuild WebDriverAgent` 仍残留。根因是 `WdaManager.stop()` 只向 Bun 返回的进程句柄发信号，无法保证 `xcrun/xcodebuild` 的完整进程树退出。

实现已改为让 WDA launch 使用独立进程组；stop 对整个 owner process group 发送 `SIGTERM`，宽限期或取消后发送 `SIGKILL`。残留的确切旧进程在复测前单独终止。该失败不计为通过证据。

### Route B 正常与取消路径

修复后在同一真机复测：

- WDA `/status` 在 6,568 ms 后 ready，并观察到 runtime WDA identity。
- Settings 启动成功；截图 305,843 bytes，`redactionStatus=raw-local-only`；UI tree 首次读取成功，45,456 bytes，没有使用诊断重试。
- 正常 cleanup 返回 `status=closed`、`reusable=true`、`issues=[]`。
- 已取消的 cleanup 返回 `status=timed_out`、`reusable=false`、`issues=[session deletion aborted]`；旧 backend 后续动作返回 `backend_not_reusable`。
- 独立新 backend 随后建立 session 成功，cleanup 返回 `status=closed`、`reusable=true`。
- 结束后 Route B 端口不可达，验证 owner 的 `iproxy` 与 `xcodebuild WebDriverAgent` 进程均不存在；验证前已存在的 Appium 服务仍 ready，未被接管或终止。

原始 UI tree 与截图只保存在系统临时目录，没有复制进仓库、模型上下文或报告正文。

最终代码自审还发现 TUI 组装层最初没有把 `AiSdkAgentRuntime` 的 run-scoped signal 传给 `ToolDispatcher`。修复后，runtime SDK call、dispatcher、pending permission、custom execution、DeviceBackend exploration 与 XCUITest dispatch 使用同一 signal；新增测试直接验证 signal identity、pending ask 取消和 TUI execute seam 收到运行时 signal。该缺口修复并完成全量回归后才关闭 DEF-033。

## 当前判定

- DEF-025 已满足关闭条件：OpenTUI 0.5.10 在真实 PTY 的行为门禁通过，production `auto` 选择结果与原因可观察。
- DEF-029 已满足关闭条件：超时/取消使 backend 与 driver 终态且不可复用，late completion 与新实例隔离，自动化、G5-SIM 和真机 Route B 均通过。
- DEF-033 已满足关闭条件：同一 signal 已贯穿 permission、DeviceBackend、xcodebuild 与 xcresult parser；真实 child abort 测试通过，真机 Route B 取消/owner cleanup 无残留。Route C 保持显式 diagnostic 且其限制不会被静默降级。
- 原始 Simulator 与真机 UI tree、截图均未复制进仓库或报告正文。
