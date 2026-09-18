# T6.12 调试进程所属观察来源：核查与下一批计划

日期：2026-09-17。状态：用户确认后整批实现与验证通过；一次宿主LLDB额度已消费。沿用ADR-023/044/046/047，不扩展v4 no_target_resources，也不降低capture身份门禁。

## 核查结论

原文约束：US-12.3 AC6“取消贯穿录制、等待、导出及所属进程清理。”AC7“真机与 Simulator 能力分别实测，不能以独立后端 probe 或 fixture 单测替代生产链路验收。”

| 资源/证据 | 已有来源 | 尚缺来源或限制 |
| --- | --- | --- |
| helper/launcher | v4原NSRunningApplication退出及Bun child.exited；真实App已通过 | 仅无目标正常路径可释放临时lease，不覆盖取消或已创建目标 |
| Xcode | MemoryOwnedAppSession保留自有启动回调对象，公开isTerminated | 尚未接入完整资源provider，不能把safeToTerminate注入闭包当真实下游证据 |
| document | MemoryLocalDocumentBinding保留目录inode；AX上下文核对document URL | 文件目录身份不是文档会话关闭；当前绑定只覆盖一次解析，不能证明完整会话连续性 |
| debugger/AUT | 固定LLDB查询返回debuggerId/processInstance/PID/moduleUUID；已有宿主CLI和历史Xcode候选证据 | query_exit每次重新读取GetSelectedTarget().GetProcess()；切换target或进程后会丢失对原进程的观察入口。不能以未找到、Stop禁用或Xcode退出代替AUT退出 |
| physical identity | 目标描述符、构建元数据及候选LLDB身份分开存在 | 尚无真实设备归属的交叉核验。processInstance或随机UUID均不能直接写成已验证设备generation |

按证据排序的待验证问题：①生产helper没有资源provider，是当前无法进入真实查询的直接代码原因；②原进程退出查询依赖当前选中target，缺少原对象保留，切换后会保守失败；③原生Return会话在真实Xcode中的完整提交/响应仍需验证，不能由测试发送器或历史CUA结果推断已通。第二项是可独立解决的证据来源问题；本批不靠扩大回执scope掩盖其他缺口。

本机Xcode公开Python绑定`LLDB.framework/Versions/A/Resources/Python/lldb/__init__.py:10808`记录GetUniqueID用于区分process instance，明确不是PID。GetHostname只提供接口签名，没有将hostname等同设备UDID的保证。本次只读本地公开绑定，没有启动LLDB、Xcode或设备。

## 拟实施整批单元

1. 新增独立`native/itestagent_memory_owned_observation.py`，在所属debugger内保留原SBTarget/SBProcess对象，仅以公开只读API观察。登记时严格校验session/request、原debugger及现有候选身份；最多一个活动登记，期限有界，禁止覆盖或按PID重新发现/接管。只读退出观察使用保留对象，不能重新选择target或执行目标表达式。无对象、身份变化、失效、期限届满均返回unverifiable；释放登记只释放观察引用，不Detach/Kill/DeleteTarget。
2. 新增内部TS严格解析模块与一次性会话包装，区分“原LLDB进程已退出”的观察和“设备身份已验证”。新的观察结果不能直接写入MemoryProcessIdentity.generation、释放lease或授权退出Xcode。旧查询协议、固定脚本与已签名v4源码清单保持原样，避免静默改变已有候选。
3. fake LLDB单测覆盖同PID不同实例、错debugger/session/request、target切换、原对象失效、活进程、已退出、重复登记/释放、过期与未知状态。输出仅固定白名单，不存原始console、目标内容或内存数据。
4. 单测通过后进行一次无设备CLI LLDB验证：一个自有LLDB会话，最多启动两个新编译的临时宿主fixture进程。每个进程仅正常Resume至自动退出；保留第一个对象后切换到另一个target，验证原实例退出观察不会错误指向新实例。无需Xcode App、签名、Keychain或设备。各阶段有界等待，无自动重试、无附加/接管已有进程、无force终止；未能正常退出时记录unknown并停止。此项是宿主API来源验证，不是G5。
5. 运行相关单测、性能包默认回归及typecheck/lint/diff；新真实LLDB用例保持opt-in，不把后续默认回归变成重复真实运行。更新证据矩阵和交接记录。

## 明确边界与后续顺序

本次确认将覆盖上述代码、测试、临时宿主fixture编译，以及一次CLI LLDB/最多两个自有fixture进程的来源验证；不包含真实Xcode、iPhone、Simulator、helper安装/重签、系统授权修改、AX/Return或commit/push。既有App运行额度均已消费，不复用。

本批通过后，仍依次需要：document完整会话归属/关闭观察、Xcode resource provider与有状态控制协议接线、真实原生Xcode查询验证、所选真机与构建/进程实例交叉绑定、capture/export及生产TUI G5。真实设备generation的来源尚未确证，必须留为unverified；必要的协议或语义扩展须单独ADR，不能提前决定由LLDB整数或hostname代替。

T6.12保持in_progress。本计划不是全部任务完成承诺，也不要求用户手动导出内存图。

## 本批实现与宿主证据

新增独立Python OwnedObservation，每个owner session仅可登记一次，保留原debugger/target/process对象；登记最长120秒、最多128个请求，UUID/候选完整字段与类型匹配，错绑定、失效、未知状态或过期后丢弃登记。只读观察不再重选target，已观测exited不能回退live；release只丢弃引用，不操作目标。该登记仍是调试器内部观察来源，不能证明物理设备归属。

TS createOwnedMemoryObservation严格限制registered/live/exited/released状态、每次新请求与一次消费、原候选debuggerId/processInstance/PID、登记实例及期限。解析错误后不可恢复，输出始终targetVerified=false、leaseRetained=true；没有生成物理generation或lease proof的接口。旧identity脚本和v4固定候选源码未改变，原候选清单/profile复核仍通过。

定向单测14 pass / 0 fail（31 assertions），其中Python fixture含14组原对象/切换/失效/重放/期限等情形。随后仅执行一次opt-in CLI LLDB检查：一个自有调试器会话、两个新编译宿主进程，均正常Resume至自动退出。实测原target被切换后仍能观察原进程live→exited；第二进程启动后观察仍指向原实例；release不影响仍暂停的第二进程，释放后观察unverifiable。两个process实例ID不同，不将其宣称为物理generation。

真实用例1 pass / 0 fail（3 assertions）；launchCount=2、allOwnedExited=true，LLDB自有child退出0；独立只读ps确认原LLDB/本轮fixture均无残留。未Detach/Kill/DeleteTarget、未重试或force终止。本次LLDB额度已消费，包级回归保持新用例及既有App/LLDB opt-in关闭。

证据：`/private/tmp/itestagent-owned-observation-attempt-20260917.json`、`/private/tmp/itestagent-owned-lldb-OeKF4t/result.json`、`/private/tmp/itestagent-owned-observation-exit-check.json`、`/private/tmp/itestagent-owned-observation-native.log`。真实Xcode/iPhone/Simulator未运行；未安装/重签helper、修改权限或commit/push。本批成功不补足document生命周期、真实设备绑定及生产TUI验收。

最终性能包默认回归：324 pass / 9 opt-in skip / 0 fail，2377 assertions、52文件。9个skip包含本批已单独执行一次的真实LLDB用例，因此没有重复消费运行额度。typecheck、lint（965文件）及git diff --check通过；未运行全仓库测试。日志为`/private/tmp/itestagent-owned-observation-package.log`、`/private/tmp/itestagent-owned-observation-typecheck.log`、`/private/tmp/itestagent-owned-observation-lint.log`。下一优先项为document完整会话归属/关闭观察，之后才能安全组合Xcode resource provider；不自动扩大当前v4证明范围。
