# T6.12 Simulator内存对照：零扫描证据与采集阻断

**当前结论**：2026-09-09最新实证（性能报告§38）：DEF-036修复完成；正常生产CLI/TUI Simulator单次阳性与释放两组均passed，36个有效native-footprint样本/组，真实扫描分别20项/5MiB与完成0/0。目标/数值/原始证据/canonical/owner收口均核验，baseline=skip且既有基线未变。本结论仅覆盖Simulator DeviceBackend单次内存路径，未关闭全部T6.12出口；下方旧“未接线/G5-SIM阻塞”均是历史阶段描述。


2026-09-09 UTC。最新状态：**公开footprint的Simulator单PID采样spike已通过（41样本/101.68秒），已有本地leaks阳性/完成零扫描证据。生产接线与正常TUI G5-SIM仍未完成**。历史xctrace阻断记录保留，最新事实见文末。

## 授权与范围

用户对`simulator-memory-evidence-plan-6.12.md`回复“确认授权”。允许专用Simulator、临时unsigned fixture构建安装、阳性/释放各一次、目标绑定采集及cleanup；方案明确失败停止、不自动重试、不删除已有设备/runtime/证据。此轮未修改生产代码、契约或baseline。

约束原文（US-12.3 AC4）：“泄漏结论必须来自真实诊断证据，区分检测到、本次检测未发现与无法检测；内存增长不能直接判为泄漏，未发现不承诺不存在所有泄漏。”

## 已实际完成

- 同名不存在检查后新建唯一owner设备：`itestagent-memory-evidence-t612`，iOS18.2 runtime、iPhone16Pro类型；未选择/接管原有两台booted Simulator。
- 创建新的临时项目，使用仓库MemoryProbe v2源码与XcodeGen配置；`iphonesimulator` SDK、`CODE_SIGNING_ALLOWED=NO`构建成功，安装到本次新设备成功。没有读取/改写真机签名配置。
- 公开xctrace device inventory列出了新设备；只证明可选择目标，不代表Leaks/Activity Monitor已能成功采集。
- Appium/WDA端口4727/8213及MJPEG9213启动前检查空闲；WDA DerivedData位于本次项目的独立目录。复用production createAppiumDeviceBackend与真实Appium driver，未注入设备替身。

## 阻断与排查

三个候选按证据排查：Appium服务启动失败、WDA构建/启动失败、fixture进程自身启动失败。

Appium日志显示REST listener启动成功；WDA端口连接ECONNREFUSED。Xcode构建输出包含明确错误：`NSPOSIXErrorDomain Code=28` / `No space left on device`，发生在保存本次WDA构建日志时。`backend.launchApp`返回失败，会话未建立，探针停止于positive.launch。证据支持WDA构建阶段的磁盘空间阻断；尚未进入AUT身份检查，不能归因为MemoryProbe业务错误，也不将ECONNREFUSED单独解释为网络配置问题。

事后关闭专用Simulator并收口后，宿主总容量约460.43GiB，可用空间约4.52GiB。本次临时项目166.09MiB，其中fixture DerivedData47.07MiB、WDA DerivedData119.00MiB；专用Simulator约1044.19MiB。事后可用空间不等于失败瞬间空间，不能据此否定构建期间ENOSPC，也不能承诺清理某个固定数量必定解决。未执行删除或自动重试。

## 未执行与证据语义

| 项目 | 本次事实 |
| --- | --- |
| 阳性/释放按钮 | 0次，权限回调0次；释放对照未启动 |
| fixture工作负载receipt验证 | 未到达 |
| Simulator/宿主PID绑定 | 未到达 |
| xctrace录制与trace | 0次，0个新trace |
| 本地leaks扫描 | 0次 |
| detected/not_detected | 均没有新结果，不能补零 |
| baseline | 未调用写入口，当前仍2份 |

公开本地`man leaks`已核对退出码：0为未发现、1为发现泄漏、>1为工具错误。这只是后续解析判定依据，没有提供本次实际扫描或有效零样本。

## 清理

探针子进程exit1；驱动器捕获失败后终止本次Appium，Appium退出码1（不能声称正常exit0）。backend cleanup报告already_closed；专用Simulator shutdown exit0。后续只读复查与本次临时路径/目标匹配的宿主进程为0，xcodebuild/xctrace均0；专用设备Shutdown，两台原有Simulator仍Booted。安装、专用设备、临时项目与证据均保留，没有删除runtime或现有设备。

原始日志只在`~/.itestagent/runs/sim-memory-evidence-1788920322/artifacts/`；包括unsigned构建/安装日志、Appium日志、进度、probe-summary、redacted error projection和cleanup projection。工具输出未传原始设备树/截图/内存/签名信息给模型；只有固定状态、脱敏错误及占用统计。私有owner ID与临时路径位于本地`/private/tmp/itestagent-sim-memory-state.json`，恢复时须重核，不能盲用旧PID。

## 首次恢复申请（历史，后由用户自行清理并授权继续）

Xcode全局`~/Library/Developer/Xcode/DerivedData`约9.45GiB，属于可重新生成的构建缓存；本次失败WDA构建目录另约119MiB。用户此前没有授权删除缓存，且原计划禁止失败后自动重试，所以本轮停在具体恢复申请：

1. 新授权后先检查活跃构建与缓存使用情况；只清理上述DerivedData中未在使用的缓存，以及本次owner项目的失败WdaDerivedData。保留源码、当前fixture构建产品、所有`~/.itestagent`报告/trace/baseline、已安装runtime和所有Simulator设备。清理会导致后续项目重新编译；不主动删除其他应用数据或用户项目。
2. 重新检查可用空间，至少预留10GiB作为本次工程余量（不是Apple保证或成功证明）；未达到则暂停，不扩大删除范围。
3. 复用本次创建且身份/状态核对通过的专用Simulator和已安装fixture，启动它并重新准备本次WDA/Appium会话。无需新建同名设备、重新构建或覆盖安装fixture。
4. 按原计划执行尚未发生的阳性/释放各一次，身份绑定、录制就绪、70秒有效采样、10秒settling、20秒业务等待、独立本地leaks扫描和清理要求不变。仍不自动重试，不把tool spike当正常TUI G5-SIM。

此次只记录实测准备与阻断；沿用既有4057 pass/7 existing skip/0 fail及typecheck/lint结果，不虚称重跑。任务保持6.12 in_progress、6.13 pending，未提交推送或合并。

## 用户清理后复测（2026-09-09 UTC）

用户回复“已清理磁盘空间，请继续”。恢复前可用137.98GiB；Agent没有执行删除。核对原owner的名称/runtime/Shutdown状态与已构建fixture后，只启动这台专用Simulator，核实既有安装与xctrace inventory。没有新建设备、重新构建/覆盖安装fixture、重跑真机或写baseline。Appium重新准备WDA成功，未再次观察到ENOSPC。

环境：macOS26.5、Xcode26.5 build17F42、iOS18.2 iPhone16Pro Simulator、Bun1.3.14、Appium3.6.0；`leaks`为本机系统`/usr/bin/leaks`。以上版本来自本轮真实命令，不推断其他runtime可用性。

### 独立本地诊断事实

两组均绑定Appium activeAppInfo、专用Simulator的launchctl进程、bundle app container、宿主PID可执行文件realpath及ps启动时间；工作负载各步骤、扫描前后重复核对。两组之间显式结束AUT并fresh launch，不作为同进程趋势。

| 事实 | 阳性 | 释放对照 |
| --- | --- | --- |
| 实际按钮/一次性allow | Run Leak Workload / 1次 | Run Released Workload / 1次 |
| receipt | allocations20 / freed0 / completedRounds1 | allocations20 / freed20 / completedRounds1 |
| 标题与完成文本断言 | passed | passed |
| 本地leaks开始→结束（UTC） | 03:32:03.098→03:32:09.518 | 03:32:38.202→03:32:42.056 |
| 工具退出/失败 | exit1 / 无timeout或工具failure | exit0 / 无timeout或工具failure |
| 对应PID完成summary | 唯一1条 | 唯一1条 |
| 实际leakCount / totalBytes | 17 / 4456448 | 0 / 0 |
| 前后目标身份 | targetBound、identityStable均true | targetBound、identityStable均true |

命令为`/usr/bin/leaks --list --nostacks --noContent <exact bound host PID>`，120秒上限。阳性exit1与正count/bytes、对照exit0与0/0分别符合公开man语义；不是把非零退出统一当失败，也不是把缺失输出补零。阳性只宣称工具实际报告17项，不声称20次fixture分配全部被识别。释放receipt本身不构成零扫描证据；本次结论额外依赖真实完成summary、退出语义、时间与目标绑定。该结果仅能说明本次Simulator宿主进程扫描未发现泄漏，不能证明不存在所有泄漏或物理iPhone零扫描能力。

### xctrace失败及探针控制缺口

按证据检查三个候选：磁盘问题复发、目标进程退出/身份错误、目标不提供所选instrument服务。两组xctrace均exit2，明确错误为`Activity monitoring service not available on this device.`；AUT前后身份稳定，日志没有ENOSPC。支持的结论是本机该Simulator设备目的地不提供Activity Monitor服务，不能扩展为所有Simulator/宿主PID路径都不支持。

两组真实Leaks+Activity Monitor录制都提前结束，未获得有效采样或导出；`memory_peak`、`memory_growth`、`memory_leaks`均failed / `performance.recording_incomplete`。原始目录保留2个不完整trace，但capture输出artifactCount均0，无峰值/增长值，不满足70秒覆盖。独立`leaks`成功不会覆盖这三个失败状态。

生产capture当前把`Ctrl-C to stop`提示也当readiness。此次两组输出均包含该提示、没有`Recording started`，随后exit2，说明提示本身不足以证明instrument可用。原临时探针只检查工作负载与native扫描成功，未检查capture.finish返回的failed状态，因此还执行了释放对照。它是原定另一组，不是同组自动重试，但违反原计划完整采集失败后应停止后续阶段的严格门禁；不能把probeExit0或probe-summary.completed解释为整份计划通过。

已在临时探针补上failed/cancelled capture结果立即停止的检查，仅执行Bun语法编译验证，未再次运行。生产readiness逻辑未改；下一单元须基于真实开始信号、进程存活/错误与最终采样证据验证，不能仅延长等待时间。新的宿主采集路径仍须独立确认与实测，见`simulator-memory-host-capture-plan-6.12.md`。

### 清理与证据边界

backend.closeSession=closed/reusable；probe、Appium、专用Simulator shutdown均exit0。事后专用设备Shutdown、autLaunched=false、本次owner匹配宿主进程0；安装/临时项目/设备保留。其他Simulator事后Booted数量为1，不能沿用上一轮“2台仍运行”的结论；本轮没有向其他设备发送boot/shutdown命令。baseline仍2份，脚本未调用写入口。

原始证据：`~/.itestagent/runs/sim-memory-evidence-retry-1788924619/artifacts/`。两组workload receipt、checkpoint XML、command stdout/stderr、capture-result和native-leaks-projection均留在本地；另有capture-errors/readiness/cleanup等脱敏投影。旧ENOSPC目录完整保留。模型只读取固定标记、版本、聚合和脱敏工具错误，没有读取原始内存地址、UI树、trace内容或设备标识。

这是部分工具证据成功、完整采集失败的spike，不是产品入口G5-SIM。生产MemoryLeaksSchema仍detected-only；不得拿本次native零结果直接填入xctrace-leaks-detail source。T6.12保持in_progress，T6.13 pending。本轮没有生产/测试代码变更，沿用4057 pass/7 existing skip/0 fail及typecheck/lint；不声称全库重跑，未提交推送。

本轮文档收口检查：git diff --check通过，G2 worktree/all 80文件通过，task-status JSON字段与6.12/6.13状态通过，56个变更文件gitleaks脱敏扫描无发现。未重跑全库测试。

## 宿主PID路径：就绪前严格阻断（2026-09-09 UTC）

用户对`simulator-memory-host-capture-plan-6.12.md`回复“确认”。本次可用139.28GiB，复用原owner专用设备和既有安装，未删除、重建或覆盖安装。Appium/WDA准备成功；fixture fresh receipt明确0分配/0轮/未开始，防止复用旧完成receipt。

### 门禁检查

公开`notifyutil -h`确认`-1 key`注册并报告1次通知；独立唯一key的本地握手post exit0、observer exit0、收到精确key、stderr0bytes。该握手只验证通知机制，不算xctrace录制开始。

临时进程fixture测试4 pass/0 fail/8 assertions：Ctrl-C提示后工具错误不能放行；缺少真实开始通知超时；ready后capture退出阻断后续阶段；abort后两个自有子进程均不可再探测。最初测试将Bun子进程启动写死为100–300ms而出现时序失败，改为有界等待实际PID/更合理的fixture期限后通过；未因此放宽真实采集的30秒通知期限。临时probe语法编译通过。没有生产源代码/包测试修改，也没有把这些测试作为设备能力证明。

### 真实执行与三假设核对

本次实际仅调用一次`xctrace record --template 'Activity Monitor' --attach <bound host PID> ... --notify-tracing-started <unique owner key>`，按已确认方案省略--device，600秒time-limit/630秒子进程上限。命令exit21，唯一脱敏错误为`Cannot find process for provided pid: [number]`。无Recording started、无有效开始通知、无trace目录；tapApprovals0，工作负载/采样/导出/native leaks扫描均0次。

| 假设 | 实际核对 | 结论 |
| --- | --- | --- |
| 宿主目的地的xctrace进程解析范围与Simulator宿主PID不同 | 精确参数及默认host选择确认，xctrace明确无法解析PID；前一轮Simulator目的地又不提供Activity Monitor | 当前候选解释，未证明工具内部过滤规则，不能泛化所有runtime/模板 |
| AUT在绑定后、attach前退出 | 启动前后Appium activeAppInfo/launchctl/ps realpath及启动时间匹配；失败后wrapper的fixture terminate exit0 | 失败瞬间没有第二份identity快照；cleanup成功不足以证明同PID一直存活，因此该时序解释尚不能完全排除 |
| attach参数错误、旧PID或错误owner | 原始argv中的PID与本轮bound identity完全相等；launchctl PID相等；fresh receipt通过，原owner唯一ID与runtime匹配 | 已有证据排除简单传参/旧state错误 |

本次没有ENOSPC或权限错误文本，不能根据exit21直接要求root、修改系统安全设置或签名。可确认阻断发生在xctrace目标解析阶段；底层原因仍inconclusive。未尝试all-processes、名称attach、其他模板、修改目的地或第二次启动。

### 清理与结果边界

本次guard收到recording提前退出后abort：probe exit1；notifyutil观察器被取消exit143/`performance.cancelled`；backend closed/reusable，fixture cleanup/Appium/shutdown exit0。专用Simulator Shutdown，本轮owner匹配宿主进程0；所有其他设备状态与开始快照一致；baseline2份，文件集合及SHA256完全一致。没有用户项目/Flow/baseline写入。

原始证据目录`~/.itestagent/runs/sim-host-memory-evidence-1788925514/artifacts/`保留通知、命令日志、初始receipt、仅本地PID身份、参数核验、设备前后/基线哈希快照、清理投影与本次临时脚本。模型只读取固定状态与脱敏错误；没有原始设备UI或内存内容进入上下文。本次停止门禁起效，纠正了上一probe继续执行对照的控制缺口，但生产readiness逻辑仍未更改。

独立本地leaks阳性/零扫描证据保持有效，未重扫。Simulator内存峰值/增长仍未取得，不能用前轮native leaks或真机曲线代替。本轮不形成新的生产source或ADR决策。

### 下一候选，仅阅读公开帮助

本机`footprint -h`与`man footprint`描述按指定PID输出内存摘要、JSON以及bytes格式；还有sample/sample-duration。man说明其统计强调内核计账的dirty memory，且只有检查非当前用户进程才要求root。这些是格式/权限边界说明，不是本次Simulator能力证明。未执行任何footprint/vmmap目标扫描，不把footprint数值预设等同Activity Monitor的physical-footprint列。

已准备`simulator-memory-footprint-plan-6.12.md`，申请明确的单目标公开工具验证与一次工作负载；未自动切换。当前6.12 in_progress、6.13 pending；沿用既有4057 pass/7 existing skip/0 fail及typecheck/lint，当前只新增临时探针检查和文档验证。

宿主单元收口检查：git diff --check、G2 worktree/all 80文件、task-status JSON/字段/依赖与状态检查通过；57个变更文件gitleaks扫描无发现。没有生产代码变更，未重跑全库测试。


## 原生footprint采样spike通过（2026-09-09 UTC）

用户确认`simulator-memory-footprint-plan-6.12.md`。恢复前137.15GiB，仍为macOS26.5、Xcode26.5 build17F42、专用iOS18.2 iPhone16Pro；复用已安装fixture和owner WDA目录，未删除/创建/覆盖安装。fresh receipt0分配/0轮/未开始；Appium、launchctl、app container/realpath、ps启动时间以及当前用户UID均匹配。

### 真实格式与计量

一次15秒上限的`/usr/bin/footprint -p <exact PID> -f bytes --noCategories -j <new-json>`返回exit0，JSON含unit="byte"、bytes per unit=1、processes长度1且pid与绑定一致，errors/warnings为空。预检聚合：processes[0].footprint=33278448、total footprint=33278448；auxiliary.phys_footprint=33294832、phys_footprint_peak=34408944。不同字段实际不相等，所以本单元明确只取processes[0].footprint，source记native-footprint，不把辅助历史峰值或Activity Monitor physical-footprint当同一指标。

公开man说明footprint默认强调内核dirty memory计账；这里记录工具原生字段的观测趋势，不声称与旧xctrace来源等价。root unit与bytes per unit构成实际单位证据，MiB=bytes/1048576。预检数据未混入正式采样；首次正式有效样本后才放行唯一工作负载。

临时通用验证5 pass/15 assertions（非法/缺失JSON、错误PID/bytes、exit/timeout、时间/覆盖不足、abort回收），实际格式解析2 pass/8 assertions（当前footprint不取历史峰值，拒绝不明单位、多个目标、errors/warnings及总计矛盾），均0 fail。只测试临时编排/解析，没有更改生产schema/source。

### 实际工作负载与采样

同一AUT进程一次Run Leak Workload tap allow，20秒等待、标题/完成文本断言通过；receipt20分配/0释放/completedRounds1。设备外部调用通过队列串行化；footprint采样与业务等待并行，共享AbortSignal，采样命令自身串行且每次10秒上限。没有自动重试、释放对照或leaks重扫。

| 字段 | 实测 |
| --- | --- |
| footprint调用 | 42次：1次格式预检+41次正式样本，全部exit0，无failure |
| 样本目标/单位/值 | 41份JSON逐项核对通过，errors/warnings均空 |
| 实际首尾跨度 | 101677.879459ms，coverage=complete（最低70000ms） |
| 首值→末值 | 31.549301147460938→37.29930114746094MiB |
| 样本区间峰值 | 37.62742614746094MiB |
| 末值减首值 | +5.75MiB |
| 实际相邻样本间隔 | 2458.295291–2986.278ms，包含命令/身份检查开销 |
| 最长单次footprint测量 | 346.9915ms |
| 目标绑定 | targetBound=true、identityStable=true、当前用户owned |

每个样本保留宿主单调开始/完成时间与wall-clock，采样时间明确为命令完成时刻；不能当精确内核瞬时时间。趋势标approximate、environment=simulator、representativeOfPhysicalDevice=false、comparisonScope=simulator_only。+5.75MiB只是观察区间变化，不单凭增长推断泄漏；当前已知leaks诊断来自先前独立证据，不伪称本轮重新扫描。

### 清理、留档与完成边界

probe/Appium/shutdown exit0，backend closed/reusable；AUT正常terminate成功、owner匹配宿主进程0、专用Simulator Shutdown。其他设备状态与开始快照一致；baseline仍2份，文件集合和SHA256全部不变。保留原有设备/安装/项目以及本轮证据，无trace产物，不提交推送。

原始目录`~/.itestagent/runs/sim-footprint-evidence-1788964535/artifacts/`：preflight/sample JSON、各命令stdout/stderr及状态、真实UI checkpoint和receipt、bound identity、本次临时脚本、派生samples/memory/verification-cleanup投影。只有白名单结构/单位/聚合及状态进入模型，没有原始进程标识、地址、region或UI树进入上下文。

本次通过的是公开footprint+真实CoreSimulator单进程业务采样spike。它与先前native leaks完成零扫描共同支撑下一生产设计；不能替代US-12.3 AC5/AC7正常TUI验收。下一计划`simulator-memory-production-plan-6.12.md`具体覆盖source契约、目标绑定、采样/诊断/abort、报告与baseline边界、自动化和两次正常TUI G5-SIM，尚待确认；未提前开始生产编码。

footprint单元收口：git diff --check、G2 worktree/all 80文件及任务JSON/字段/依赖/状态检查通过；58个变更文件gitleaks扫描无发现。生产代码未变，未重跑全库。


## 生产接线后续（2026-09-09）

ADR-043新source/目标绑定/完成零扫描已接入生产并通过自动化。正常CLI/TUI尝试在计划确认后因无安装需求仍请求replace_device_app而被拒绝；两组工作负载均未执行，G5-SIM未通过。证据与收口见性能报告§37，阻塞DEF-036。专用Simulator已Shutdown，2份baseline及其他设备不变。
