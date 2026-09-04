# T6.9 explain / failed-only rerun G5 与 G5-SIM 验证报告

**任务**：T6.9（US-14.1 / US-16.1）
**验证日期**：2026-09-03
**结论**：PASS（XCUITest failed-only 已完成 G5-SIM 与 G5；原 DeviceBackend 证据仅作组合参考）

## 1. 验证范围

本次原始验证覆盖 canonical run bundle 的只读解释、failed-only 子运行创建、父子 lineage、执行路径过滤、真实 DeviceBackend 会话和证据持久化。PR #78 复审后修订 ADR-035：DeviceBackend 自动探索即使按 `selectedCaseIds` 限制，也没有重放 parent 的动作、数据和断言，不能称为可复现重跑；T6.9 的真实 failed-only 验收改为 XCUITest 权威 `Target/Class/Method` + `-only-testing`。以下原始数据继续保留，结论按新边界重新分类。

## 2. 静态与自动化验证

以下门禁通过：

- `bun run typecheck`
- `bun run lint`
- `bun run build`
- T6.9 rerun boundary、runId contract 与 Phase 6 定向测试：29 pass，0 fail
- xcresult 权威 identifier 与 JUnit 解析定向测试：17 pass，0 fail
- T6.9 CLI explain/rerun 定向测试：6 pass，0 fail
- `bun run test:ci`：3436 pass，39 skip，0 fail
- `bun test`：3559 pass，40 skip，0 fail
- `git diff --check`

自动化覆盖包括：完整 bundle 加载和 `latest` 跳过损坏目录、计划与结果 lineage 交叉校验、failed/flaky 用例筛选、XCUITest `only` 过滤且不覆盖配置 targets、DeviceBackend 在权限/backend/child run 前阻断、确定性 flaky 判定、SQLite lineage 重建、CLI explain 消费真实证据、统一 runId 边界，以及 Apple xcresult test node 到 `-only-testing` identifier 的解析。真实 G5/G5-SIM 进一步证明该 identifier 只执行选中 case。

全仓测试已将宿主依赖与纯逻辑测试分离：真实 Keychain 与完整 doctor 宿主验证使用显式集成测试开关；doctor 编排单测注入 subprocess runner；HTTP 集成测试先执行本地监听能力探针，受限沙箱仅跳过必须监听端口的用例，路由、SSE hub 与 session 逻辑测试继续执行。由此消除了 Keychain 授权、`devicectl` 探针超时和 Seatbelt 禁止监听导致的环境误报。

## 3. 历史 G5-SIM：CoreSimulator DeviceBackend 组合证据

**目标**：iPhone 16 Pro，iOS 18.2；设备标识通过运行时参数注入，未写入报告
**路径**：Appium DeviceBackend，Simulator WDA 端口 8500，MJPEG 端口 9500

执行结果：

- parent run：`g5-simulator-6-9-parent`
- child run：`g5-simulator-6-9-child`
- child `parentRunId`：`g5-simulator-6-9-parent`
- `selectedCaseIds`：仅 `settings-failed-checkpoint`
- 真实步骤：启动 Settings；对选中 case 截图；两步均 `completed`
- 证据：真实截图 215,642 bytes，`redactionStatus=raw-local-only`
- child 状态：`explored`

验证产物位于宿主临时目录 `/var/folders/_r/6dh_2jf542d4p97jl9nqwk480000gn/T/itestagent-g5-simulator-6-9-AG1pJ4/runs/g5-simulator-6-9-child`。原始设备证据未复制进仓库。

## 4. 历史 G5：物理 iPhone DeviceBackend 组合证据

**目标**：iPhone 14 Plus，iOS 18.2.1；设备标识通过运行时参数注入，未写入报告
**路径**：Appium 3.6.0 DeviceBackend，managed-xcodebuild WDA，WDA 端口 8600，MJPEG 端口 9600
**签名与准备**：用户已明确确认 `prepare_wda` 高风险操作；使用已配置的 Apple Development 签名和 Team ID 执行。

执行结果：

- parent run：`g5-physical-6-9-parent`
- child run：`g5-physical-6-9-child`
- child `parentRunId`：`g5-physical-6-9-parent`
- `selectedCaseIds`：仅 `settings-failed-checkpoint`
- 真实步骤：启动 Settings；对选中 case 截图；两步均 `completed`
- 证据：真实截图 306,703 bytes，`redactionStatus=raw-local-only`
- child 状态：`explored`

验证产物位于宿主临时目录 `/var/folders/_r/6dh_2jf542d4p97jl9nqwk480000gn/T/itestagent-g5-physical-6-9-tFpAkj/runs/g5-physical-6-9-child`。原始设备证据未复制进仓库。

## 5. 规格修订后的 G5-SIM：XCUITest failed-only

**目标**：iPhone 16 Pro，iOS 18.2 Simulator；设备标识仅通过运行时参数注入
**工程**：临时 SpikeApp fixture，shared scheme `SpikeApp`
**路径**：production executor → XCUITest readiness → xcodebuild `-only-testing` → xcresulttool/xcresultparser → canonical child bundle

执行结果：

- parent run：`g5-simulator-6-9-xcuitest-parent`
- child run：`g5-simulator-6-9-xcuitest-child`
- selected / parsed case：`SpikeAppUITests/SpikeAppUITests/testLaunchSystemSettings`
- 未选控制用例：`SpikeAppUITests/SpikeAppUITests/testControlNotSelected`，未出现在 child result
- child `parentRunId`：与直接 parent 一致
- child 状态：`flaky`（parent `failed` → child `passed`）
- 权限动作：`execute_project_build`、`replace_device_app`
- xcresult：271,064 bytes，`redactionStatus=raw-local-only`
- canonical child bundle：`/var/folders/_r/6dh_2jf542d4p97jl9nqwk480000gn/T/itestagent-g5-simulator-6-9-xcuitest-hcCh0h/runs/g5-simulator-6-9-xcuitest-child`

首次验证使用非 shared scheme 时在 build 前被 readiness 正确阻断。第二次验证发现真实成功 JUnit 使用自闭合 `<testcase/>`，且 `xcresultparser --target-info` 在无 coverage report 时不可用；实现据此改为使用 Apple `xcresulttool get test-results tests` 的 `nodeIdentifierURL` 恢复权威三段 ID，并补齐自闭合 JUnit 解析。修复后同一真实 xcresult 可稳定解析为 selected case。

## 6. 规格修订后的 G5：物理 iPhone XCUITest failed-only

**目标**：iPhone 14 Plus，iOS 18.2.1；设备标识仅通过运行时参数注入
**工程**：与 G5-SIM 相同的 SpikeApp fixture 和 shared scheme
**签名与副作用**：使用工程既有 Apple Development 自动签名；用户已确认 `execute_project_build` 与 `replace_device_app`

执行结果：

- parent run：`g5-physical-6-9-xcuitest-parent`
- child run：`g5-physical-6-9-xcuitest-child`
- selected / parsed case：`SpikeAppUITests/SpikeAppUITests/testLaunchSystemSettings`
- 未选控制用例：`SpikeAppUITests/SpikeAppUITests/testControlNotSelected`，未出现在 child result
- child `parentRunId`：与直接 parent 一致
- child 状态：`flaky`（parent `failed` → child `passed`）
- 权限动作：`execute_project_build`、`replace_device_app`
- xcresult：279,377 bytes，`redactionStatus=raw-local-only`
- canonical child bundle：`/var/folders/_r/6dh_2jf542d4p97jl9nqwk480000gn/T/itestagent-g5-physical-6-9-xcuitest-CFaLn0/runs/g5-physical-6-9-xcuitest-child`

## 7. 最终结论

修订后的 US-16.1 AC1-AC8 已获得双目标运行时证据：权威 `Target/Class/Method` 从 Apple xcresult test node 恢复，failed-only 只传入 selected case，配置 test target 未被覆盖，控制用例未执行，parentRunId 与 flaky 证据进入 canonical bundle。DeviceBackend 自动探索 rerun 由契约、engine 和生产 executor 三层阻断，发生在权限、backend 和 child run 创建之前，并引导 confirmed Flow 重放。原 Appium 两次 spike 保留为生产组合参考，不再作为重跑验收依据。
