# T6.9 explain / failed-only rerun G5 与 G5-SIM 验证报告

**任务**：T6.9（US-14.1 / US-16.1）
**验证日期**：2026-09-03
**结论**：PASS

## 1. 验证范围

本次验证覆盖 canonical run bundle 的只读解释、failed-only 子运行创建、父子 lineage、执行路径过滤、真实设备会话和证据持久化。规格评审后采用 ADR-035：重跑元数据写入 child TestPlan v3，`result.parentRunId` 与计划交叉校验；XCUITest 仅将选中用例传给 `-only-testing`，DeviceBackend 仅调度 `selectedCaseIds`。

## 2. 静态与自动化验证

以下门禁通过：

- `bun run typecheck`
- `bun run lint`
- `bun run build`
- T6.9 contracts、engine、report 与 Phase 6 定向测试：92 pass，0 fail
- T6.9 CLI explain/rerun 定向测试：6 pass，0 fail
- `bun run test:ci`：3429 pass，39 skip，0 fail
- `bun test`：3549 pass，40 skip，0 fail
- `git diff --check`

自动化覆盖包括：完整 bundle 加载和 `latest` 跳过损坏目录、计划与结果 lineage 交叉校验、failed/flaky 用例筛选、XCUITest `only` 过滤且不覆盖配置 targets、DeviceBackend 只执行选中用例、确定性 flaky 判定、SQLite lineage 重建、CLI explain 消费真实证据和设备 session 清理。

全仓测试已将宿主依赖与纯逻辑测试分离：真实 Keychain 与完整 doctor 宿主验证使用显式集成测试开关；doctor 编排单测注入 subprocess runner；HTTP 集成测试先执行本地监听能力探针，受限沙箱仅跳过必须监听端口的用例，路由、SSE hub 与 session 逻辑测试继续执行。由此消除了 Keychain 授权、`devicectl` 探针超时和 Seatbelt 禁止监听导致的环境误报。

## 3. G5-SIM：CoreSimulator 端到端

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

## 4. G5：物理 iPhone 端到端

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

## 5. 结论边界

两类目标均证明 failed-only child run 会重新执行 readiness 和真实 DeviceBackend 会话，只调度 parent 的失败用例，并提交含 lineage 与真实截图引用的 canonical bundle。验证计划没有可判定业务通过的断言，因此 child 合法地保持 `explored`；本次设备 spike 不把截图成功解释为业务 `passed`。failed → passed 的 flaky 判定由确定性 contract/integration tests 验证，未借助无断言设备步骤制造通过结果。
