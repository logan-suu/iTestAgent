# ADR-042：已确认 Flow 的同进程多轮内存采集

日期：2026-09-09（本地2026-09-08）。状态：用户已确认实施；physical DeviceBackend三轮G5已通过（性能报告§31），其他路线/G5-SIM仍待各自验收。关联：T6.12、US-12.3 AC3–AC7、ADR-033/034/040/041。

## 约束与决策

原文：“AC3 多轮趋势仅对已确认可复现操作及轮次产生，不静默重复探索动作；同项目、目标域、设备与采集配置的 baseline 才能比较。”

采用正常Project-aware TestPlan附加明确的memoryRounds配置：Flow ID/实际来源/语义内容SHA256（解析后的Flow文档JSON，不是文件字节）、步骤预览、2–10轮、0–60秒轮间等待、同进程策略。TUI计划修改命令`/memory-rounds <flow-id> <count> <interval-seconds>`只准备草稿，原目标/设备/观察时间/指标继续展示；用户仍须确认完整计划。仅允许confirmed、physical兼容且有断言的有界Flow；不自动保存/确认Flow，独立run flow命令语义不改变。

同一backend/preflight生命周期，App准备只走一次，循环内不调用启动/终止。每轮复用backend-agnostic replayFlow及原生performance factory；每轮一个隔离的trace，先recording readiness再动作，然后观察/settling与导出。不同轮次不共享时间原点，禁止拼成连续采样或累加Leaks分配；轮间采集空白明确声明。每轮540秒触发取消（早于采集器600秒上限），整体30分钟触发取消，owner清理另有截止时间，失败/拒绝/取消/缺失指标或目标进程变化停止后续轮次。新多轮配置不能自动重放既有探索steps。

通过Appium公开mobile: activeAppInfo只取bundleId与正整数PID，核对前台目标、各动作边界及每轮结束；采集attach精确PID，PID不新增为报告字段或模型投影；原始trace中的诊断进程身份保持raw-local-only。无法核对即阻断，不将名称相同当作同进程，不承诺检测所有发生在相邻探测间的瞬时状态。Flow循环体禁止启动/终止App和跨App链接等生命周期动作。敏感或语义不确定动作逐次PermissionEngine确认；Flow内allow不是高风险豁免。wait、轮间等待和超时沿用同一AbortSignal，取消收口由原owner负责。

报告增加可选memoryRounds：每轮序号、实际状态/原因、step引用、独立trace引用、覆盖/指标/采样及时间事实；未开始轮次标not_started，无伪造step。完整多轮峰值为已观测最大峰值；增长baseline采用最后一轮相对第一轮观测终点的变化，明确不是逐轮增长之和或连续窗口。只有完整成功的多轮可建立/比较baseline，key包括Flow摘要/轮数/间隔/多轮策略，与旧单轮隔离。旧run、baseline和Flow文件均不改写。

## 验证

先做契约、规划确认/陈旧Flow、循环次序/失败停止/进程变化、逐次权限、取消/清理、报告引用与baseline隔离，以及正常TUI/PTY回归。扩展独立MemoryProbe为每次点击一个有界轮次，显示轮次完成计数，防止并发tap。它只提供工作负载对照，不证明零扫描。

生产新增采集仍限定physical DeviceBackend；Simulator/XCUITest明确阻断并保留既有行为。真实多轮构建/替换安装/WDA/Flow保存和工作负载待具体审阅后单独授权，自动化测试不冒充G5/G5-SIM。零泄漏有效扫描仍保持证据不足，不借本增量关闭T6.12。

参考：[Appium activeAppInfo公开接口](https://appium.github.io/appium-xcuitest-driver/latest/reference/execute-methods/#mobile-activeappinfo)。仅使用PID/bundleId白名单，不保留返回中的processArguments或环境变量。


## 2026-09-09真机验证补充

具体授权后首轮G5暴露共享Flow定位器固定屏幕尺寸缺陷：请求已投递但按钮未命中，工作负载零分配，文本断言失败且后续轮次未启动。定位器现要求UI树提供唯一、零原点、有限正尺寸的XCUIElementTypeApplication边界，按同一坐标空间换算；证据缺失/歧义/中心越界时阻断，不猜测机型或夹取边界坐标。显式normalized coordinate语义保留。实测失败、修复回归与重试边界见性能验证报告§30；修复尚不能代替新的G5通过证据。

独立复测授权后，修复后的正常TUI三轮真机验收已通过：18实际steps、9项完整性校验通过的证据、三次checkpoint工作负载计数、各轮完整采样和阳性Leaks、旧baseline不变且新多轮baseline来源一致。详见性能报告§31；此结果不扩展零扫描或Simulator/XCUITest能力范围。


T6.12基线草稿编辑补充（2026-09-09，用户确认）：正常TUI的Modify输入支持精确baseline=skip或baseline=local_auto，只修改未确认计划；显式选择在本planning session的重新编译/目标选择/多轮配置后保留，新会话不继承。Simulator native内存仍强制skip、拒绝开启local_auto。策略编辑不写baseline，既有执行与高风险替换权限保持。真实PTY已验证skip进入canonical且无测试基线新增；无schema/Intent扩展。证据见性能报告§41。
