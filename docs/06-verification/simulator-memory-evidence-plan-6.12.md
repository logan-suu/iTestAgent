# T6.12 Simulator 内存与零扫描证据验证计划

状态：已授权执行；首次ENOSPC后用户自行清理磁盘并授权继续。复测获得本地leaks阳性与有效零扫描，Simulator设备路径Activity Monitor不支持，完整计划未通过。2026-09-09 UTC。详情见证据报告的复测节；不是正常TUI G5-SIM。

## 现状与原文约束

- physical DeviceBackend三轮内存G5已通过（性能报告§31）；零扫描、Simulator/XCUITest新增性能仍未完成。不得重复消费之前的真机授权。
- US-12.3 AC4：“泄漏结论必须来自真实诊断证据，区分检测到、本次检测未发现与无法检测；内存增长不能直接判为泄漏，未发现不承诺不存在所有泄漏。”
- ADR-011：“Simulator reports must carry `environment = simulator`, `representativeOfPhysicalDevice = false`, `comparisonScope = simulator_only`.”
- 当前engine仅在physical preflight后启动新增capture；capture固定向xctrace传deviceId。不能删除physical判断就宣称支持Simulator；Simulator target与宿主进程身份、模板、采样列、签名/权限和baseline域都须实测。
- 2026-09-09只读检查：iOS17.5/18.2/26.5 runtime可用；现有iOS18.2 iPhone16Pro和iOS26.5 iPhone17Pro均已booted，归属未知，本次不占用或关闭它们。
- `/usr/bin/leaks --help`声明可扫描PID或memory graph，提供`--list --nostacks --noContent`。这些参数不是物理iPhone远程扫描接口；Simulator宿主进程是否可用与有效零结果尚未实测。

## 本单元范围与明确授权请求

1. 使用已经安装的`com.apple.CoreSimulator.SimRuntime.iOS-18-2`和`com.apple.CoreSimulator.SimDeviceType.iPhone-16-Pro`创建一个本次专用临时Simulator，名称`itestagent-memory-evidence-t612`；保留返回的唯一ID作为owner，不使用名称选中已有设备。若同名设备已存在，停止并报告，不擅自覆盖或删除。启动本次设备，结束后只关闭本次创建的设备，保留它供审阅；不删除runtime或任何既有Simulator。
2. 从仓库`fixtures/ios-memory-control/`复制到新临时项目，生成Xcode工程并构建Simulator版MemoryProbe，显式使用iphonesimulator与`CODE_SIGNING_ALLOWED=NO`。不读写真机签名Team，不改用户项目或原临时真机工程。
3. 只在新建专用Simulator安装`com.itestagent.spike.MemoryProbe`，准备本次专用Appium/WDA Simulator会话。显式许可fixture安装及WDA准备，不修改系统权限或凭证；出现新的系统安全阻断即报告，不能隐式授权。
4. 两次独立工作负载各一次：先fresh launch并点击`Run Leak Workload`一次；完成后结束fixture，再fresh launch点击`Run Released Workload`一次。均保留20秒业务等待、完成文本断言与每轮20分配/正向0释放或对照20释放的本地receipt核对。两次有意重启是分别批准的阳性/释放对照，不冒充同进程多轮趋势。
5. 对每个目标进程核对公开设备/Appium/simctl信息，将宿主PID与本次Simulator、fixture bundle/可执行文件和启动身份绑定；无法证明归属则停止。仅用公开CLI与既有Appium driver，不使用私有框架、trace二进制解析或新第三方依赖。
6. 在明确绑定目标后分别做有界真实采集：先验证xctrace支持的Simulator/host attach路径，确认路径后才启动一次Leaks + Activity Monitor录制（最低观察70秒、settling10秒、采样余量30秒，录制600秒硬上限）；真实录制就绪后执行该次已批准的按钮操作，结束与导出沿现有owner机制。不在失败后静默换路径/模板重跑工作负载。
7. 同次fixture进程工作负载完成、xctrace录制结束与导出收口后，通过`/usr/bin/leaks --list --nostacks --noContent <exact PID>`进行一次明确扫描，120秒上限，输出仅保存到本地run artifacts。分别记录真实命令开始/结束、退出状态、扫描完成summary、计数/bytes及前后身份校验；不只用正则匹配一句文字判成功。positive退出码含义依公开man及真实结果核实，不假设只有exit0才是合法诊断。没有成功零结果就保持证据不足，不反复启动直到取得0。
8. 结束本次Appium/WDA/xctrace/leaks子进程、fixture进程和专用Simulator；保留安装与证据。所有动作由Agent自动执行，用户不需要手动导出Instruments/memgraph。原始UI/trace/XML/诊断输出保持raw-local-only，模型仅获取固定状态、聚合数值与身份匹配布尔值。此次不生成memgraph、不覆盖baseline、不提交推送。

任一目标绑定、准备、工作负载断言、采集或扫描环节失败时停止依赖该环节的后续操作并留档；没有自动重试授权。独立对照只能在前一阶段已完成且身份可核验时推进，不用对照掩盖失败。

## 产物与判定

- 版本控制产物：`docs/06-verification/simulator-memory-evidence-6.12.md`（真实工具版本/环境、两次结果、正确目标绑定、采样覆盖/泄漏scan结果、取消/清理事实及限制）、性能报告下一节、handoff与task-status同步。
- 临时脚本只编排已复用公开工具、限定目标并投影安全聚合；不注入生产模型/设备/capture输出，不以mock替代实际采样。原始数据仅存`~/.itestagent/runs/<unique-probe-id>/artifacts/`。
- 阳性证明工具在此环境可发现已知不可达分配；释放receipt只证明fixture释放，只有真实工具明确完成并报告0/0、退出语义合法且目标/时间绑定完整时，才得到可供后续设计的零扫描样本。
- 取消、空输出、permission denied、进程不存在/身份变化、缺少完成summary均是负例，不能当零结果。真实零输出与未扫描/工具错误的区别必须在报告中逐项写清。
- 此单元是真实CoreSimulator工具可行性spike，**不是正常产品入口的G5-SIM完成证明**。不直接修改MemoryLeaks契约或生产capture。证据满足后，下一单元再给出schema/source/target binding/生产生命周期/安全/回归与正常TUI G5-SIM的实现计划；物理iPhone零扫描不会因Simulator结果而宣称完成。

## 后续实现需要证据才能确定的文件

候选变更归属：contracts的memory-analysis/performance-capture、performance-xctrace-analyzer的production-capture与新的Simulator采集适配、Appium DeviceBackend的目标身份能力、engine production-run-executor中的Simulator生命周期、报告与baseline域隔离，以及对应包单测和phase6集成/PTY测试。当前仅列归属，不预设输出schema或批准跳过真实格式验证；无新依赖或技术路线决策已被暗中采纳。

参考：[Apple Finding Memory Leaks](https://developer.apple.com/library/archive/documentation/Performance/Conceptual/ManagingMemory/Articles/FindingLeaks.html)、[WWDC22 Profile and optimize your game's memory](https://developer.apple.com/videos/play/wwdc2022/10106/)。官方资料说明公开工具用途；本机可用性、退出码和实际输出仍以本单元实测为准。


## 本次执行结果

实测与恢复申请见`simulator-memory-evidence-6.12.md`。专用Simulator已关闭、原有设备未动，报告/安装保留。用户随后自行清理磁盘并授权复测；Agent未删除缓存。两组独立扫描已执行并留档，但capture失败状态未阻断对照的探针控制缺口已记录，临时guard已修正且未重跑。新的宿主PID采集计划见`simulator-memory-host-capture-plan-6.12.md`，尚待确认；不得重跑create或删除现有设备。
