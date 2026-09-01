# Task 6.5 双路径调度 G5 / G5-SIM 验证报告

**任务**：T6.5 双路径生产调度：XCUITest 与 DeviceBackend 探索按项目资产自动选择

**验证时间**：2026-09-01

**当前结论**：G5-SIM 与真机 G5 均通过。Simulator 使用 SpikeApp AUT 完成 1/1 case；真机在用户明确确认后，以无 AUT host 的 UI test 驱动系统 Settings，完成 1/1 case。任务按代码类任务状态机保持 `in_progress`。

## 验证工程与范围

用户确认后，从既有 SpikeApp 验证工程创建临时副本，并用 XcodeGen 增加一个最小 `SpikeAppUITests` UI test target。原验证工程未修改，临时工程与原始 xcresult 不纳入版本控制。

本轮验证以下链路：

```text
Project graph XCUITest target
  -> generic-platform scheme/Test action enumeration
  -> execution route resolution
  -> canonical TestPlan v3
  -> confirmed dual dispatcher
  -> exact destination xcodebuild test
  -> xcresultparser
  -> normalized execution result
```

DeviceBackend 的动态探索动作属于 T6.6，本报告不宣称 DeviceBackend 探索闭环通过。

## G5-SIM

环境：已启动的 iPhone 16 Pro Simulator，iOS 18.2。

最终结果：

- analyzer 找到 1 个 XCUITest 配置：scheme `SpikeApp`，target `SpikeAppUITests`；
- `prefer=auto` 解析为 `resolvedPath=xcuitest`、`selectionReason=runnable_xcuitest`；
- dispatcher 只执行 XCUITest，不启动 Appium/WDA；
- `xcodebuild test` exit code 0；
- xcresultparser 得到 1 total / 1 passed / 0 failed / 0 skipped；
- `fallbackHistory=[]`；
- G5-SIM 结论：**PASS**。

首次执行时，`xcodebuild test` 已通过，但本机缺少项目技术选型要求的 `xcresultparser` CLI，dispatcher 按 R5 返回 failed，没有把未解析结果误报为完成。用户授权安装 `xcresultparser 2.2.0` 后重试，完整闭环通过。

## 真机 G5

环境：已连接的 iPhone 14 Plus，iOS 18.2.1；设备标识未写入报告。

第一轮真机资产探测暴露了两个实现问题：

1. 对具体 iPhone 执行 `xcodebuild test -enumerate-tests` 会尝试安装 test runner，违反确认前无副作用边界；
2. enumeration 可能在 JSON 中返回安装错误但进程仍 exit 0，仅检查 exit code/target 名称会产生假阳性。

实现与 ADR-029 已同步修正：规划与重验只使用 generic platform、`CODE_SIGNING_ALLOWED=NO`，不选择具体设备；JSON 中只有“generic destination 需要具体设备”作为预期 limitation，其他 `errors` 全部 fail-closed。具体 destination、provisioning 与安装只在计划确认及 `replace_device_app` 权限后执行，真机 runner 此时才传 `-allowProvisioningUpdates`。

修正后真机生产 dispatcher 成功完成：

- 1 个配置解析为 XCUITest；
- 自动签名更新与 test runner 安装；
- 实际测试启动；
- xcresult 生成并成功解析；
- 路径保持 XCUITest，`fallbackHistory=[]`。

测试 case 最终失败，xcresult 明确显示免费开发者 profile 的 App 数量已达上限：本轮 test runner、既有 WDA runner 和既有 echo 验证 App 已占满三个槽位，SpikeApp AUT 无法安装。iTestAgent 未自动删除或替换 WDA/echo App。

为避免删除用户 App，改用无 AUT host 的 UI test 启动系统 Settings，只验证真实 test runner/XCUITest/xcresult 链路。该操作改变了此前授权的设备侧 payload，执行权限审查先行阻断；取得用户对系统 Settings 自动化的明确确认后才继续执行。

最终结果：

- analyzer 找到 1 个 XCUITest 配置，自动解析为 `resolvedPath=xcuitest`；
- 计划确认及 `replace_device_app` 权限后，真实 iPhone runner 使用 `-allowProvisioningUpdates` 完成签名与安装；
- 系统 Settings 启动并进入前台，1 total / 1 passed / 0 failed / 0 skipped；
- xcresult 生成并由 xcresultparser 成功解析；
- `fallbackHistory=[]`，未跨路径 fallback；
- 执行后只读进程清单未发现 `SpikeAppUITests`/`xctrunner` 继续运行；Settings 在检查时仍运行；
- 未删除或替换既有 WDA、echo 验证 App 或其他用户 App；测试 runner 未卸载；
- 真机 G5 结论：**PASS**。

此 PASS 证明任务 6.5 的真实 iPhone XCUITest runner、系统 App 启动、xcresult 解析和无 fallback 调度链路；受免费开发者 App 上限影响，它**不证明** SpikeApp AUT 的真机安装或业务 UI 测试通过。

## 自动化门禁

- `bun run lint`：通过；
- `bun run typecheck`：通过；
- discovery/build/dispatcher/TUI/Phase 6 定向用例：82 pass / 0 fail（真机安全修正后）；
- 最终相关 contracts/engine/analyzer/build/TUI、Phase 2/6 与架构套件：1952 pass / 11 skip / 0 fail；
- 提交前自评进一步收紧旧 v1/v2 `auto + scheme` migration 和 XCUITest route 的 `fallback=abort` 交叉字段约束；新增回归后全仓 `bun test`：3468 pass / 13 skip / 0 fail；
- `bun run lint`、`bun run typecheck` 与 `git diff --check` 全部通过。

## 当前限制

- 真机 G5 仅覆盖无 AUT host 的系统 Settings case，不覆盖 SpikeApp AUT 真机安装；
- XCUITest 的 AbortSignal 尚未贯通 generic revalidation、test 与 parse 子进程，继续由 DEF-033/T6.10 跟踪；本报告不宣称取消验证；
- DeviceBackend 动态动作与逐 case checkpoint 属于 T6.6。
