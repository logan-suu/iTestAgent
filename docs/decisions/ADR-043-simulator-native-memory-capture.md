# ADR-043：Simulator原生内存采样与完成零扫描

**当前结论**：2026-09-09最新实证（性能报告§38）：DEF-036修复完成；正常生产CLI/TUI Simulator单次阳性与释放两组均passed，36个有效native-footprint样本/组，真实扫描分别20项/5MiB与完成0/0。目标/数值/原始证据/canonical/owner收口均核验，baseline=skip且既有基线未变。本结论仅覆盖Simulator DeviceBackend单次内存路径，未关闭全部T6.12出口；下方旧“未接线/G5-SIM阻塞”均是历史阶段描述。


状态：已接受（用户确认simulator-memory-production-plan-6.12.md），2026-09-09。

## 背景与证据

US-12.3要求正常TUI自动采样/诊断、明确失败和来源、真机与Simulator分别验收。公开xctrace的Simulator Activity Monitor服务不可用；默认host attach同一Simulator宿主PID也exit21，原始失败保留。替代工具已单独授权实测：footprint单PID41样本/101.68秒，native leaks阳性17项/4456448bytes和完成零扫描0/0（性能报告§34–36）。这不是正常TUI G5-SIM完成证据。

## 方案对比

1. 继续把Simulator送入同一xctrace模板：本机已实测失败，不能自动重试或静默切换。
2. 把Allocations或历史峰值当当前footprint：量纲/时间域不同，拒绝。
3. 复用系统footprint与leaks，显式新source、目标绑定和完成证据：已取得工具证据，采用；无需私有框架、新依赖或人工导出。

## 决策

- Simulator DeviceBackend单次确认计划使用native-footprint（JSON processes[0].footprint、unit=byte、bytes per unit=1）。近似MiB时间点为宿主命令完成，附单次测量耗时。auxiliary.phys_footprint_peak不是本区间峰值，不能替代。physical继续现有xctrace来源。
- engine组合目标和执行，performance backend通过公开simctl/ps验证Simulator ID、bundle、PID、executable realpath、启动时间与当前用户；不调用其他Backend，不按进程名或all-processes采集。
- 首个有效样本才ready；串行约2秒snapshot、单次10秒、最多300样本、600秒采样硬上限。每样本核对前后身份，失败abort依赖动作，不能跳过无效样本拼健康曲线。finish幂等，按实际时间覆盖和操作后settling收口。
- native-leaks是scan_snapshot来源，动作/采样完成后一次有界扫描，要求开始/结束、唯一匹配PID完成summary、身份前后稳定、合法退出及原始证据引用。exit0且0/0才not_detected；exit1且正数才detected；其他情况无诊断值。旧xctrace-leaks-detail保持detected-only。
- 原始命令/JSON/身份/诊断只进raw-local-only artifacts；模型/报告只保留source、派生数值与artifact引用。新source必须在simulator_only、representativeOfPhysicalDevice=false环境；未验证的Simulator baseline本单元skip，拒绝与physical或旧source混比。
- 生产UI断言通过不覆盖性能失败；取消贯穿采样/业务/扫描/子进程，失败后没有跨路线fallback。

## 后果与验证

扩展兼容现有result schema结构，旧报告不被反向赋予新source；native值不进入physical多轮或baseline。契约/负例/owner/engine/报告及真实PTY自动化已通过；正常生产TUI实测在确认计划后遇到多余replace_device_app提示，按批准计划拒绝并停止，阳性/释放工作负载均未执行（性能报告§37、DEF-036）。修复与新复验方案见`../06-verification/simulator-production-entry-fix-plan-6.12.md`，待确认。只有该实测完成才能声称产品路径通过。Simulator多轮/baseline、XCUITest新增性能、physical零扫描与旧physical Ctrl-C readiness门禁仍独立待完成；本ADR不把工具spike变成整项T6.12完成。

## 正常入口补充（2026-09-09，用户确认DEF-036修复计划）

无实际高风险前置动作时，正常TUI使用execute_confirmed_test_plan语义，不能制造replace_device_app请求；实际Simulator Appium WDA构建/启动使用独立prepare_wda权限，physical/XCUITest的构建安装门禁保留。拒绝与取消阻止后续backend命令，allow不跨动作记忆。

正常CLI接受四个成组的瞬时选项：`--simulator-appium-url`、`--simulator-wda-port`、`--simulator-mjpeg-port`、`--simulator-wda-derived-data`。只作用于Simulator生产composition，不改provider或physical Route B，不落持久化配置。URL限HTTP loopback字面地址，不接受凭证/query/hash；三个端口互异且合法，DerivedData是明确绝对路径。计划审阅展示本地连接与WDA准备边界；本机目录细节不传给模型。创建专用Simulator会话前检查WDA/MJPEG端口，无响应超时或已有监听则失败，不接管其他进程；该预检不承诺消除所有竞态，Appium仍负责实际bind失败。不是新增权限放行或跨路线fallback。
