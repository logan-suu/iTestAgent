# T6.12 真机采集就绪与失败传播修复计划

状态：用户已回复“确认”，批准本单元实现计划；代码已实施，最终全库4094 pass/7 existing skip/0 fail及typecheck/lint已通过；未启动真实设备采集，新G5申请见physical-capture-readiness-g5-plan-6.12.md。

## 恢复点与依据

性能报告§38的DEF-036修复和正常CLI/TUI Simulator单次阳性、释放对照均已通过。4077 pass / 7 existing skip / 0 fail为上一单元门禁；本次不重复这些设备操作。T6.11 done、T6.12 in_progress、T6.13 pending，当前open延期项为0。

规格原文（US-12.3）：

> AC5 正常生产 TUI 到报告三件套贯通，采集期间有持续活动、阶段与耗时提示；报告列出指标、限制和本地证据路径；请求指标不可用时不显示全项成功。
> AC6 复用公开工具，不逆向 trace；原始 trace/XML 不进入模型上下文。取消贯穿录制、等待、导出及所属进程清理。
> AC7 真机与 Simulator 能力分别实测，不能以独立后端 probe 或 fixture 单测替代生产链路验收。

ADR-039要求工厂仅在录制就绪后返回，但历史条目把Ctrl-C提示作为就绪事实。§34实证推翻该判断，本计划须同步纠正该历史规则。现有PerformanceCapture.signal契约已经要求持续采集失败时停止依赖动作，不需要新增来源、指标或结果schema。

## 按证据排序的假设与结论

1. **启动提示误判为就绪，已确认。** production-capture.ts的正则接受Ctrl-C提示。隔离复现只发该提示，工厂立即返回；随后模拟exit2，finish才返回performance.recording_incomplete，artifactCount=0。未使用真实设备或替换生产文件。
2. **提前退出没有传播至业务动作，已确认接线缺口。** physical采集对象未提供signal；真机单次执行器捕获启动失败后继续探索；memory-rounds只使用外部取消信号，未订阅recording.signal。现有行为允许在缺少采集时消耗已确认工作负载。
3. **单纯延长等待能恢复正确性，不成立。** 文本提示与开始录制是不同事件，延时不提供开始事实；进程还可能在就绪后退出。既有§35临时notify握手仅证明工具通道，不能替代生产接线或真机验收。

本机公开xctrace usage列出：`--notify-tracing-started` — `Send Darwin notification with this name when a recording has started`。notifyutil帮助列出`-# key`订阅并报告指定次数的通知，以及`-p key`发送通知。此次仅调用帮助；xctrace record --help以exit46打印usage，未开始录制。

## 拟实施的可验证单元

1. **后端就绪门禁。** 新增performance-xctrace-analyzer/src/capture-readiness.ts，使用已有有界子进程transport管理notifyutil订阅与xctrace。每次创建随机owner专用通知名；先建立订阅，以独立注册探针握手验证订阅已就绪，再启动带--notify-tracing-started的录制。不得向真实开始通知名发送测试通知。启动通知须精确匹配、订阅退出成功、录制仍存活且无已知错误；通知缺失/订阅失败/取消/提前退出均阻断，无文本或固定sleep降级。全部等待有上限，清理全部本次owner进程。具体公开参数组合须先以无设备通知测试验证，不能照搬临时probe的250ms等待。
2. **连续失败与证据。** 修改production-capture.ts，移除提示正则放行，维护独立失败取消信号；提前退出立即终止依赖动作。正常finish停止不误判提前退出，保持幂等。启动失败复用PerformanceCaptureStartError，保留有界raw-local-only采集审计，只有已完成trace才作为trace产物。内部采集失败保持failed，用户取消为cancelled；不以内部abort伪装用户取消。不引入泄漏零值、补采样或自动重录。
3. **单次与多轮编排。** 修改production-run-executor.ts和memory-rounds.ts，将physical capture.signal接入业务调用；采集启动失败或缺少必需factory时阻断工作负载，保存安全原因和审计引用。多轮每轮订阅并解除监听，首次采集失败停止后续轮次，未开始轮次保持not_started。正常采集完成后的证据收尾不使用已失效的业务信号。保持Simulator原生路径、无性能请求与XCUITest路由原语义。
4. **验证。** 扩展production-capture.test.ts、production-memory-capture.test.ts，新增readiness测试；覆盖跨chunk提示无通知、通知前退出、通知与退出竞争、通知错误/超时、就绪后失败、正常finish/重复finish、等待/导出期间取消、审计脱敏及引用。扩展Phase6 physical/native/memory-rounds跨包回归，证明失败前0业务调用、失败后无后续动作和轮次、canonical失败与用户取消可区分、不写baseline。使用真实本机owned Bun子进程验证中止/收割，使用公开notifyutil做无设备订阅握手验证；其余边界fixtures不冒充G5。
5. **文档和门禁。** 同步ADR-039/040、规格/数据流中采集失败语义、性能报告、handoff和task-status。执行定向测试、typecheck、lint、全库bun test、G2、gitleaks与diff检查。保持T6.12 in_progress，不自动提交推送或合并。

## 真机验证边界

代码及自动化通过后，再核对当前iPhone、临时MemoryProbe项目与可复用签名/WDA事实，提供具体正常TUI G5动作清单供逐项确认；不沿用已消费的构建/替换安装/WDA/tap授权。本次实现计划确认允许上述代码、文档、隔离测试和无设备通知握手，不授权新的真实iPhone操作。

拟验收真实开始通知先于一次已确认工作负载、有效内存采样与阳性诊断、canonical证据及owner收口；取消场景按届时明确计划执行。physical有效零扫描、Simulator多轮/baseline、XCUITest新增性能与其余指标仍是独立剩余项。本修复未通过新G5前不得标为完整验收。

## 确认来源

AGENTS.md R8：`未经人确认的实现计划不得进入编码`。
`.agents/skills/do-task-itest/SKILL.md`第7步：`Produce an implementation plan covering changed files, interfaces/contracts, tests, documentation, and verification evidence. Wait for explicit approval under R8.`

本次是新的physical就绪与失败传播实现范围，上一份Simulator入口计划已经完成；确认后从上述第1项继续。
