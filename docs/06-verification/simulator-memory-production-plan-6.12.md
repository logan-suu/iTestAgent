# T6.12 Simulator内存与零扫描生产接线计划

状态：用户已回复“确认”；三个生产代码单元及文末具体正常TUI G5-SIM动作已授权，三个代码单元已实现并通过门禁；首次正常TUI尝试按计划停止于额外安装提示（§37），后续另经批准的DEF-036修复及正常TUI两组G5-SIM已通过（§38），历史尝试不重写。2026-09-09 UTC。

## 已锁定的依据

本机macOS26.5/Xcode26.5/iOS18.2工具spike提供两类独立证据：公开footprint按唯一Simulator宿主PID取得41个有效样本/101.68秒；公开leaks取得目标绑定阳性17项/4456448bytes及完成零扫描0/0。详情见性能报告§34、§36。Activity Monitor的Simulator设备/默认宿主路径失败记录保留，不自动回退重试。

US-12.3原文：“AC5 正常生产 TUI 到报告三件套贯通，采集期间有持续活动、阶段与耗时提示；报告列出指标、限制和本地证据路径；请求指标不可用时不显示全项成功。”

US-12.3原文：“AC7 真机与 Simulator 能力分别实测，不能以独立后端 probe 或 fixture 单测替代生产链路验收。”

本单元目标为Simulator DeviceBackend单次确认计划的峰值/增长及真实泄漏扫描贯通。分三个可验证代码单元执行；完成工具spike不是本单元已完成。Simulator多轮、baseline建立/比较/接受、XCUITest新增性能、物理零扫描和其他指标仍有后续工作，不能由本单元覆盖。

## 单元一：明确source、计量与完成证据

修改contracts的`memory-analysis.ts`、`performance-capture.ts`、`run-result-contracts.ts`、相关cross-field校验与`schemas/result.schema.json`，必要时同步schema registry对应项。

- MemoryGrowth保留已有activity-monitor-process-live结构与旧报告可读性；增加native-footprint来源，明确取processes[0].footprint、byte/1换算MiB，时间为host_command_completed，并附每次measurementDurationMs。不得使用auxiliary.phys_footprint_peak代替本次区间峰值，不能换成其他字段后维持旧source。纯聚合函数接收已验证来源，禁止将所有曲线硬编码成Activity Monitor。
- 仅请求峰值时也必须携带峰值来源/单位，避免脱离memoryGrowth后失去source。新native来源必须绑定simulator_only环境；旧无来源报告保留兼容语义，不能反向注入新来源。
- MemoryLeaks改为按source区分的诊断结构：已有xctrace-leaks-detail仍只允许detected；新增native-leaks scan_snapshot允许detected/not_detected。native结果要求扫描开始/完成时间、合法退出与完成判定、目标绑定及证据引用；not_detected必须count0/bytes0/exit0，detected必须正count/bytes及exit1。timeout、取消、身份变化、无summary、矛盾summary/exit均无诊断值，只给明确collection失败原因。native合法计数不继承xctrace行数读取上限。
- Result环境与source做交叉验证；原始PID/路径/可执行名与诊断全文只存在raw-local-only证据，报告/模型只保留稳定source、派生事实及artifact ID。不能将无效扫描当零或判健康。

新增ADR记录上述新source与证据边界，批准后才标accepted，并同步规格、技术选型、数据流、ADR-039/040及INDEX。

## 单元二：后端采样、扫描和owner生命周期

修改`performance-xctrace-analyzer`包：新增Simulator目标绑定、native footprint解析/采样与native leaks解析模块；复用`capture-process.ts`，不创建新第三方依赖或另一个DeviceBackend。

- engine显式传入confirmed Simulator ID、bundle与DeviceBackend返回的实时PID；performance backend只通过公开simctl/ps核验PID、App container/realpath、启动时间和当前用户所有权。不得按名字或扫描所有进程；Backend不调用另一个Backend，engine负责组合。
- Simulator选择已验证的native路线；physical保留现有xctrace路径和结果语义。目标/来源在执行前确定，失败后不跨路线重试。
- factory在首个真实有效样本或合法绑定准备完成后才resolve；峰值/增长采样持续跨越动作与settling，约2秒串行snapshot、每次10秒、总时长依据确认的观察配置有界、最多300个样本、采样生命周期600秒硬上限，并保留最小有效覆盖约束。每个样本前后核对身份和exit/JSON/单位，出现无效样本停止并共享abort，不隐式丢弃错误。
- `finish()`幂等；动作结束后达到实际覆盖/settling才停止采样，再在同进程上运行一次120秒上限native leaks（仅请求时）。执行前后核对身份，严格解析唯一对应PID的完成summary及退出码。仅请求leaks时仍核验目标、结束业务动作后扫描，不额外制造footprint指标。
- 原始JSON/命令输出与扫描记录通过artifact manifest以raw-local-only纳入run evidence，稳定引用且校验hash/size；公共进度仅阶段/耗时/样本数。abort等待正在执行的自有子进程退出；失败/取消不得形成baseline或后续成功诊断。

## 单元三：正常生产入口、报告与边界

修改`itestagent-engine/src/production-run-executor.ts`及生产组合、`itestagent-report/src/summary-generator.ts`、必要的TUI plan review/progress，并添加phase6集成与真实PTY检查。

- Simulator在已确认目标与App启动后接入native capture，不直接删除physical判断让未验证路径混入。传递真实AbortSignal和目标信息，ready失败不执行依赖采集的测试动作。
- 采样中途失败必须中止依赖流程并保留失败事实；完成UI断言不能覆盖性能失败。报告分别展示峰值/增长/native scan状态、来源/单位/时间覆盖/近似限制，not_detected文案为“本次扫描未发现”，不得沿用“xctrace Leaks trace”措辞。
- 本单元Simulator验证计划显式baseline=skip；现有physical baseline key和内容不变。增加跨source/跨physical-simulator拒绝比较回归，Simulator native自动baseline仍明确未启用，不静默调用physical策略。
- 现有physical同进程多轮范围不扩展；native source不能混入已确认physical轮次结果。已知physical xctrace的Ctrl-C提示readiness不足仍作为T6.12后续必改/实测项，不借本单元宣称已修复。

## 检查与正常TUI G5-SIM具体授权范围

编码后运行typecheck、lint、全库bun test，以及schema parity、G2/秘密检查。针对性测试覆盖：真实格式脱敏fixture、错误PID/用户/启动身份、非法单位/多进程/errors/warnings、计时/覆盖不足、exit/summary矛盾、取消子进程、报告native零语义、native来源不能进入physical baseline或physical rounds。PTY只验证交互和生产组合，不替代真实G5-SIM。

自动化通过后，允许复用原专用iOS18.2 iPhone16Pro与已安装MemoryProbe，核对owner后boot，准备专用Appium/WDA；通过正常生产CLI/TUI和实际已配置provider完成两份分别确认的TestPlan：

1. fresh launch后只点击Run Leak Workload一次，等待20秒并断言完成，采集峰值/增长/leaks，最低70秒观察+10秒settling，baseline=skip。
2. 前一run完整成功、真实扫描为detected且收口后，fresh launch只点击Run Released Workload一次，同样20秒等待/完成断言和采集配置、baseline=skip。

每个按钮只允许该次动作；不安装覆盖fixture、不重建项目、不保存/覆盖Flow、不修改系统权限或凭证。正常入口如要求额外build/install或遇到权限不符，停止报告具体情况；不绕过产品权限。用户不需要手工操作Instruments或导出文件。失败不自动重试、不执行依赖它的后续run；零诊断由工具实际结果决定，不能为了得到0反复启动。

核验canonical plan/steps/result/artifact-index/summary与schema、证据完整性、source/Simulator域、真实工作负载和诊断状态；所有设备原始内容只保存在本地run artifacts。结束后清理自有采集/诊断/Appium/WDA/AUT，关闭专用Simulator，核对其他设备状态及2份既有baseline哈希不变。未授权任何新物理iPhone动作、baseline写入、提交推送或合并。

交付更新性能报告、handoff、task-status和相关ADR/规格；T6.12保持in_progress，不能仅凭本单元将全部出口标完成。
