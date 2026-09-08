# ADR-040：内存增长与泄漏诊断产品链路

状态：已批准设计，实施及真机验证中。日期：2026-09-08。关联：T6.12、US-12.1/12.2/12.3、ADR-039。

**正常 TUI 最新实证（验证报告 §13）**：真实生产 CLI/PTY、无依赖替换的 `run_01a082a3-9a09-7000-94bc-26e9d6da37bf` 自动完成一次按钮工作负载、75个footprint样本（约179秒，完整覆盖）及20条/5 MiB Leaks诊断，三指标collected，canonical bundle重加载通过。因计划无确定性断言，run为explored，不宣称功能passed或完整baseline验收；零泄漏语义、完整断言、多轮与Simulator仍待完成。下文“完整TUI未完成”的历史记录，现应按此阳性性能链路与剩余范围区分。

**最新实证（验证报告 §10）**：用户批准独立对照 App 后，公开 Leaks 详情自动导出阳性 20 条/5 MiB，释放对照为空；生产工厂另一次阳性录制自动解析 19 条/4.75 MiB。已新增 memoryLeaks 阳性契约、官方详情导出、严格 parser 和 canonical 报告接线。下文“无自动诊断”为历史调查状态，已被本增量部分推进；仍未定义空结果为有效零扫描，完整 TUI G5、Simulator 和任意 retain cycle 覆盖未完成。

**最新要求与调查纠正**：2026-09-08 用户拒绝人工导出 memgraph 的半自动提议，要求测试采集/诊断/报告全自动；首次必要环境准备和安全授权不等于把测试步骤交给用户。现有 trace 的 TOC 不仅有 data/table，还有 tracks/track[name=Leaks]/details/detail[name=Leaks]；之前仅按 schema 检查就断言没有入口，结论过早。对该官方详情 XPath 的只读验证 exit 0，但返回空 node，无诊断行，仍不能判为无泄漏。后续验证导出层级、真实扫描执行与正向诊断样例，不采用人工导出交付，也未证明全自动通道已完成。

## 背景与决策

用户要求的是通用 iTestAgent 性能检测能力，不是证明验收 App 健康。原规格只定义峰值与跨 run baseline，不足以表达单次运行增长及泄漏诊断。2026-09-08 用户确认扩展计划。

遵守原文“AC1 不要求用户配置性能阈值”“AC5 明确失败仅限 crash / 功能失败 / 执行失败”。新增分析结果不自动把功能成功改为失败；请求证据缺失仍按 ADR-039 标 inconclusive。

- Intent、TestPlan 与 result 使用显式 memory_growth / memory_leaks 指标，不再把明确请求替换为固定指标包。
- 内存趋势从目标进程的时间戳和 physical footprint 字节采样计算；报告首尾、峰值、变化与采样区间，使用 MiB 并标近似。只有不同时间的有效采样才能产出趋势；不重采样、填零或从分配总量推断占用。
- 观察时间、操作后等待区间须在计划中显示并确认。普通探索只执行确认的操作一次；多轮操作必须有可复现的已确认 Flow/测试资产及轮次，不能暗中重复有副作用的探索动作。单区间首尾差不标为“多轮增长”。
- 等待参数解析修正（2026-09-08）：明确“操作/动作/测试后等待”或英文 after actions 等后置等待表达优先于工作负载中的普通 wait；例如“等待20秒…操作后等待10秒”仍保留原目标中的20秒动作等待，但 memoryObservation.settleDurationMs=10000。明确零秒保留，超出契约范围不截断；无明确后置表达时保留既有普通等待/默认5秒行为。
- 泄漏采集复用公开 Leaks instrument，先验证实际 TOC/XPath。仅真实诊断观测能产生 detected / not_detected；空表、未知 schema、未执行扫描不代表无泄漏。未发现仅限该工具、本次检查覆盖范围，不排除 reachable retain cycles 等问题。
- 保留 trace 供 Instruments 查看，不逆向二进制；报告仅提供数值和证据引用。原始 trace/XML 留在当前 run artifacts 的 raw-local-only 边界。
- 既有 BaselineStore/Manager 应通过生产编排接线，按项目、目标域、设备/系统、已确认操作及采集配置隔离；失败、崩溃、缺失指标不建立 baseline，已有 baseline 不自动覆盖。写新 baseline 的授权规则不变。
- 分单元交付：契约/意图→真实采集/分析→生产报告→多轮与 baseline；尚未接通或验证的部分必须留档，不能用单元测试/独立 probe 关闭 T6.12。

## 方案取舍

拒绝从内存增长直接判泄漏；拒绝未测量返回零；拒绝要求用户手写 Instruments 命令作为产品完成。公开通道无法导出诊断时，产品应给出具体限制，自动诊断能力保持未完成，另行评估已选型 backend，不自动引入新依赖。保留本地 trace 仅供可选排查，不把人工查看或导出作为功能完成条件。

## 当前实现与验证边界（2026-09-08）

- 已接入显式指标解析、计划中的有界观察/操作后等待、目标进程带时间戳的 footprint、单区间增长、报告采样范围、观察倒计时、生产首次成功 baseline 与后续对比。当前新增采集只在 physical DeviceBackend 路线；不是全部路线/指标已完成。
- 峰值沿用向后兼容字段 memoryPeakMB，但新增可选 memoryPeakUnit；Activity Monitor 明确写 MiB，报告及差值使用该单位，baseline key 包含单位以免与旧 MB 数据混比。旧报告无单位字段时保留原展示，不擅自重解释历史数据。
- 实测录制约 30 秒但导出样本只跨 7.274 秒。因此 `recordingDurationMs` 与样本 `durationMs` 分别记录；样本跨度不足确认窗口时，保留实际数据并标 `coverage: partial`、`xctrace.memory_window_incomplete`，不得把这些数据升级为完整采集或创建 baseline。
- baseline 复用既有 Manager/Store，隔离项目引用、设备/系统、execution（含目标、断言和指标）、appSource 与观察配置。只在 canonical run 发布成功后首次建立，不覆盖已有 baseline；当前尚未补齐 TUI 接受新 baseline、跨进程首次创建竞争与 Xcode 环境指纹验证。
- 真机 Leaks + Activity Monitor 一次成功录制后，公开 TOC 没有可验证的泄漏诊断表；另一次在 readiness 超时后取消。当前 `memory_leaks` 因此只能提供明确失败/不可导出状态和已完成的本地 trace，**尚无自动 detected / not_detected 诊断输出**。
- 已选型候选 [memorydetective](https://github.com/carloshpdoc/memorydetective) 的公开说明也将自动 memgraph 捕获限于 Mac/Simulator，物理 iOS 需 Xcode Memory Graph 导出。未安装新依赖；不能声称简单切换该 backend 即解决真机自动采集。引导导入 memgraph 或 App 内集成属于下一步待确认方案，不在本轮隐式实施。
- 多轮已确认 Flow/测试工作负载尚未接线；真实 TUI→canonical 内存性能 G5、受影响 Simulator/XCUITest G5-SIM/G5 仍待完成。本次 probe 不是正式产品入口验收，不能据此关闭 US-12.3 或 T6.12。
- 后续纯 Leaks 模板真机对照已完成录制，官方 Allocations 详情有数据而 Leaks 仍为空；与旧 trace 的文件导出对照一起，说明只改组合参数或 stdout/文件模式不足以修复。需要独立已知泄漏阳性与修复后对照验证真实诊断通路；测试 App 的构建、既有 Team 签名、首次安装等待逐项授权，不覆盖原验收 App。详见验证报告 §9；未新增生产代码或宣称自动诊断通过。
