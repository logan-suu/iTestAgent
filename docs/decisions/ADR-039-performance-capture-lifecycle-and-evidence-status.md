# ADR-039：性能采集生命周期与逐指标证据状态

**当前结论**：2026-09-09最新实证（性能报告§38）：DEF-036修复完成；正常生产CLI/TUI Simulator单次阳性与释放两组均passed，36个有效native-footprint样本/组，真实扫描分别20项/5MiB与完成0/0。目标/数值/原始证据/canonical/owner收口均核验，baseline=skip且既有基线未变。本结论仅覆盖Simulator DeviceBackend单次内存路径，未关闭全部T6.12出口；下方旧“未接线/G5-SIM阻塞”均是历史阶段描述。


**当前状态（覆盖下文历史阶段描述）**：2026-09-09生产接线更新（ADR-043）：用户已确认Simulator原生内存方案。代码现支持native-footprint和native-leaks完成扫描，目标绑定、共享abort、raw-local-only证据、报告和baseline=skip已接入；旧xctrace-leaks-detail仍只允许detected。该增量不代表正常TUI G5-SIM或全部T6.12出口通过，实测/门禁结论见性能报告§37。


**状态**：已接受；physical DeviceBackend内存增量已取得正常TUI G5（性能报告§24/27/31），其他指标、Simulator/XCUITest新增采集仍待各自验证。

**最新工具证据**：性能报告§34已取得Simulator宿主PID的本地leaks阳性/有效零扫描；Simulator设备目的地Activity Monitor报service unavailable，三指标仍failed。native工具证据不等于生产source接线或正常TUI G5-SIM；Ctrl-C提示readiness及探针失败阻断问题已留档，后续宿主PID采集也在工作负载前exit21且严格停止（§35）。后续footprint工具spike通过41样本/101.68秒（§36），生产接线计划待确认；尚未修改生产生命周期或source，也未完成正常TUI G5-SIM。
**日期**：2026-09-08。
**关联**：US-12.1、US-12.2、T6.12、ADR-003/007/011/031/036。

## 背景

用户澄清此前真实 iPhone 验收跑通的是 UI，而非内存增长、泄漏等性能检测。只读复核的成功 DeviceBackend run 的 `metrics` 为空；既有性能包有录制/导出函数，但生产执行器未接线，且空 XML 被解析成 `crashDetected:false` 和 `hangCount:0`。因此不能用 UI 成功或 fixture 测试宣称性能验收完成。

规格原文：

> AC1 覆盖 launch time / memory peak(近似) / crash / test duration / hitches/hangs
> AC3 深度 xctrace summary 解析为实验性，第一版保留原始 .trace 供人工打开
> AC5 memory peak 标注为近似值

项目红线原文：

> 不静默降级/臆造指标(尤其 FPS、xctrace summary)，不确定必须显式标注

## 方案对比

1. 直接调用旧 `recordTrace` 后立即导出：返回的路径不表示录制已结束，存在导出竞争和取消泄漏，不采用。
2. 把缺失数值填成零：会把未观测误当成健康，不采用。
3. 增加可注入的采集会话，分离开始就绪与最终收尾，逐指标声明证据状态：采用。

## 决策

- 保留既有五方法 `PerformanceBackend` API，增加 contracts 层 `PerformanceCaptureFactory`/`PerformanceCapture` 生命周期边界。工厂仅在录制就绪后返回；`finish()` 幂等，等待所属录制进程退出后再导出。engine 只编排，不拼底层命令；TUI/CLI 组合根注入现有 xctrace backend 包提供的生命周期适配器。
- 该增量适配器使用已有选型允许的公开 `xcrun xctrace record/export` 通道，不引入第三方依赖、不逆向 trace，不把此接线视为重新完成 ADR-007 全部解析底座与 schema 覆盖。实际表是否可导出、可解析仍以运行证据为准。
- 历史判断纠正（2026-09-09）：早期以 `Ctrl-C to stop the recording` 作为就绪证据，已被性能报告§34的启动失败实证推翻；该提示及 `Recording started` 文本均不再独立放行。physical采集改用下述公开Darwin开始通知。内存公开表 `activity-monitor-process-live` 按列 mnemonic/type 读取 `memory-physical-footprint`，只接受 `size-in-bytes`，按确切进程名/PID 过滤并解析类型一致的 id/ref；未知单位、损坏引用或截断输出不生成指标。转换除以 1024²，沿用现有 `memoryPeakMB` 字段，报告解释为近似 MiB；本次不新增增长/泄漏结论。
- 当前物理 DeviceBackend 路径在 AUT preflight 就绪后、探索动作前开始 attach，使用经过验证的 executable name，而非把 bundle ID 当作进程名。设备 UDID 始终显式传递。内存请求使用 Activity Monitor 模板并通过 `--instrument 'VM Tracker'` 加入 VM Tracker，其余使用 Animation Hitches；不自动重启 AUT、多次重跑或跨模板静默 fallback。2026-09-08 本机 Xcode 26.5 的 `list templates/instruments` 证明 VM Tracker 是 instrument 而不是独立 template；参数修正不代表真实录制或指标已验收。
- 每个子进程有明确 owner、输出上限、超时和同一 run AbortSignal。停止录制先 SIGINT，超期强杀并等待退出；导出和采集错误仅输出固定原因码，原始输出不进入模型或日志。
- 完成的 `.trace` 经 RunWriter 导入、校验和索引，标为 `raw-local-only`；不向模型传送 trace/XML，不在结果中留下被删除的 staging 路径。取消时只保留已完成的证据。
- `result.json` 的 `metrics` 向后兼容新增可选 `collection` 与 `testDurationMs`。每个请求指标对应 `collected / not_exportable / failed / cancelled` 及稳定原因码。没有观测到 crash/hang 事件时不填 false/0；`approximate:true` 不是伪造数值的许可。
- 原本 `passed` 的 run 若缺少请求的性能指标，改为 `inconclusive`，UI case 的通过事实保留。失败、取消及基础设施失败不被性能缺失覆盖。summary 明确列出缺失指标与原因；完成通知不能把该 run 显示为全项 SUCCESS。

## 当前增量边界及后果

> 以下保留第一单元的边界记录。2026-09-08 用户随后批准增长/泄漏产品能力扩展；单区间采样与生产 baseline 接线已有增量，当前事实以 [ADR-040](ADR-040-memory-growth-and-leak-diagnostics.md) 及验证报告 §31 为准，不将旧记录中的“尚待接线”误读为最新实现状态。

- 这是采集—收尾—报告的第一可验证单元，**不是全量性能能力完成**。attach 在启动后发生，不能测冷启动；未识别的真实 XML、实验性 summary 仍 `not_exportable`。现有有限格式解析不是跨 Xcode 版本已验收的证明。
- Simulator 和 XCUITest 目前没有新增并行 trace 接线，原有 xcresult 指标保留，其余请求显式缺失；需要后续按执行路线确定生命周期并做 G5-SIM/G5。不得借用真机指标或把模拟器数据当真机代表值。
- 当前不自动建立生产性能 baseline，不生成假零 delta。US-12.2 的生产 baseline 接线与验收尚待完成，`local_auto` 计划字段不能证明已经建立 baseline。
- 内存峰值不等于增长趋势，增长不等于泄漏。多轮增长趋势、泄漏诊断与明确采样窗口仍需后续专项实现/验收，不宣称“无泄漏”。
- T6.12 保持 `in_progress`，已通过的真实 UI 流程不要求重复证明；下一阶段只补性能相关证据与受影响回归。本次不操作真实设备、构建/签名/安装，不自动提交或推送。


## physical就绪与连续失败补充（2026-09-09，用户已确认计划）

- backend通过同一notifyutil进程依次注册本次随机开始通知、独立注册探针，并仅自发探针；收到探针证明订阅已建立后才启动带`--notify-tracing-started`的xctrace。精确开始通知、通知进程成功结束及录制仍存活共同构成就绪门禁；30秒内没有事实、错误、退出、取消均阻断，不采用文本/固定延时fallback。
- 录制子进程exited信号立即传播至PerformanceCapture.signal，不等输出排空；physical单次和已确认多轮均停止依赖采集的动作。正常finish使用所属进程的SIGINT/有界收割，不触发提前退出；用户取消与内部采集失败保持不同结果语义，未开始轮次仍not_started。
- 启动失败复用PerformanceCaptureStartError保存安全状态与本地审计引用。录制/通知的有界原始输出、命令及开始事件写入raw-local-only审计；只有正常完成的trace进入trace引用，失败审计不能冒充有效采样。单次缺少必需采集factory也阻断；无性能请求、Simulator原生采集与XCUITest原路由保持原范围。
- 正常生产G5需另行具体授权；公开主机通知/真实owned Bun子进程及fixture回归只验证本单元逻辑与transport。计划和记录见`../06-verification/physical-capture-readiness-plan-6.12.md`、性能报告§39。
