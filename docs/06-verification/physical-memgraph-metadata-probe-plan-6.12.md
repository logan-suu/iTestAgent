# T6.12 只读 Xcode 元数据真实候选

> 当前范围（2026-09-17，ADR-050）：用户已批准将 physical 有效零扫描及独立 memgraph 自动化延期至 T7.8/DEF-037；T6.12 优先补齐当前 XCUITest/解释/failed-only 出口。以下相关研究记录作为历史证据保留，不再要求继续 probe；未完成能力不标通过。当前清单见 `docs/06-verification/t6.12-exit-matrix.md`。

## 2026-09-17 0.1.14已授权实测：单workspace平台引用-1728，自动关闭通过（最新）

用户确认后完成备份安装和唯一一次observe。证据`/private/tmp/itestagent-metadata-0114-attempt-9n8_w4td/`；原probe47558/Xcode47566；0.1.13备份`/Users/logansu/.itestagent/helpers/xcode-metadata-probe-backup-905b4196-abc8-41a7-ba9e-7622b48bec1a`。唯一ready iPhone标识仅内存传递。CUA只读显示审阅MetadataFixture项目、Ready、Stop不可用、iPhone目的地，无需切换，没有Build/Run/调试/安装AUT或手机内容操作。

空基线/项目打开/完整文档观察通过；40次平台观察仍platformMissing。对照首条集合查询返回成功，紧接firstWorkspacePlatforms于26798ms以reply/-1728失败（15ms），依照无重试约束立即终止，因此没有集合后测及platform_comparison_observed，platformComparison保留空。不能宣称完成完整三点对照或单workspace返回missing value，更不能认定集合求值是根因。

Apple公开[错误码说明](https://developer.apple.com/library/archive/documentation/AppleScript/Conceptual/AppleScriptLangGuide/reference/ASLR_error_codes.html)将-1728定义为所引用对象不存在的运行时解析错误；它不同于-1719索引无效。当前复合说明符未提供失败层级，故不能判断是workspace、active run destination还是platform层，也不能推断设备断开。仍保留元数据不可用、集合与单对象求值不同、脚本与UI状态不同步三个假设，不放宽生产匹配。

27177ms自动终态observed_owner_documents_closed_target_unverified，cleanupVerified=true、documentClosureSource=owner_process_exited。final-cleanup.json独立核验原进程均无残留、旧17份helper与审阅项目文件未变；无人工Quit/强退。已消费本次额度，未重跑。文档自动关闭来源再次通过，目标仍未验证，不是生产G5。未改代码或重复离线测试，无commit/push。

下一定位应拆分说明符层级：先证明同一单workspace路径/loaded可读，再辨别active run destination引用是否存在及平台属性是否可读。需要在同一有界批次中取得层级证据，不能只重复最终platform查询或用UI显示替代身份；对返回对象只能做固定形状诊断，不回放任意引用。新候选尚未实施或授权。生产provider、debugger/AUT/build身份、capture/TUI/G5仍待完成，T6.12保持in_progress。

## 2026-09-17 0.1.14集合与单workspace对照候选（未安装）

公开Apple参考形式文档允许将every集合用作属性的container，结果逐项形成列表，不能仅凭链式集合语法判断现有查询非法。离线使用独立公开CreateObjSpecifier构造9个既有请求，逐层比较want/form/seld/from及最终core/getd，全部一致；Swift warnings-as-errors通过，未发送Apple Events或启动Xcode。证据`/private/tmp/itestagent-metadata-encoding-audit.swift`及`.json`。该结果只排查构造差异，不证明Xcode正确实现链式求值。公开依据：[Reference Forms](https://developer.apple.com/library/archive/documentation/AppleScript/Conceptual/AppleScriptLangGuide/reference/ASLR_reference_forms.html)、[CreateObjSpecifier](https://developer.apple.com/documentation/coreservices/1450244-createobjspecifier)。本机sdef的arud/plat/rdev/dvid/gnrc再次吻合。

按当前证据排序保留三个假设：Xcode脚本目标元数据不可用；集合链式求值与单对象不同；脚本workspace状态与界面不同步。没有确认根因，不改生产匹配或引入替代transport。0.1.14仅新增固定firstWorkspacePlatforms查询变体：仍core/getd和相同arud/plat，workspace固定index=1，不接受任意索引/属性/对象。原完整文档单workspace/loaded/全部未修改/目录binding检查不变。

第40次平台仍missing时，执行一次集合→单workspace→集合有界对照，前有本轮完整文档双快照，后独立复查仍与原快照一致及owner有效才记录platform_comparison_observed；任何失败停止，没有失败重试。比较仅输出missing/iphoneos/macosx/iphonesimulator/other分类；classificationStable仅代表前后分类一致，不代表other原始文本相等或原子快照。设备ID和任意字符串不落盘。单条2秒、对照最多6秒、后检查最多4秒且均受原60秒及清理预留约束。结果不置destinationSelectionObserved/targetVerified成功，生产snapshot读取路径不改。仍正常执行ADR-049一次Quit授权检查。

129场景通过，覆盖scalar/list编码、missing/平台分类、畸形/超长/控制字符、前后变化、取消和过期；typecheck、lint968、完整Swift warnings-as-errors构建与ad-hoc签名strict、diff检查通过。日志`/private/tmp/itestagent-platform-comparison-{tests,typecheck,lint,build}.log`。未重复已通过的宿主关闭实测和不相关全仓测试。

候选`/private/tmp/itestagent-metadata-0114-3ozf2j4g`；Mach-O SHA-256 `f63155d1811961581c58937ca0946048094c6256c8d3be0b3d2aa8b84d1a0f52`；新iOS项目`/private/tmp/itestagent-metadata-project-66vvnuc0/MetadataFixture.xcodeproj`。candidate/source/project-review.json清单已准备。当前安装仍0.1.13，未安装或运行0.1.14。

待本次整批授权：备份0.1.13并安装已核验0.1.14，重新发现唯一ready iPhone并只在内存传ID，独占Xcode空基线/打开上述新临时项目/必要时公开UI选择该iPhone，执行一次只读对照，必要的同探针Automation授权，按ADR-049正常退出本次Xcode全部未修改文档（含未知磁盘归属条目）及探针。失败恢复只允许原Xcode/probe各一次尚未发出的普通Quit；修改、owner变化、保存/停止提示暂停，不保存丢弃、不强退，不Build/Run/调试/安装AUT或操作手机内容。旧批次额度均已消费，不重跑。T6.12仍in_progress，无新G5、commit或push。

## 2026-09-17 0.1.13实测：platformMissing，自动关闭再次通过（最新）

用户确认整批后备份安装0.1.13并执行唯一observe；证据`/private/tmp/itestagent-metadata-0113-attempt-jziybkeq/`，原probe25282/Xcode25483。唯一ready iPhone在内存绑定，CUA只读显示审阅MetadataFixture及iPhone目的地，无需点击切换；未Build/Run/调试/安装AUT或操作手机内容。

40次destination_selection_sample全部selectionReason=platformMissing，platforms为list(1)，条目typeType/cMissingValue。不是iOS显示名、qualified平台名或其他文本；没有继续genericDevices/deviceIDs，不能推断设备ID缺失。公开Xcode.sdef复核active run destination=arud、platform=plat，当前编码与字典吻合，因此未发现可直接纠正的属性码错误。仍需区分集合链式查询/所属workspace语义和Xcode目标元数据缺失，不能放宽iphoneos或把UI显示当身份。

26927ms自动终态cleanupVerified=true、documentClosureSource=owner_process_exited，随后probe自动退出。final-cleanup.json独立确认无Xcode/probe残留，旧17份helper与审阅项目三文件未变。没有人工Quit/强退。本轮再次验证ADR-049诊断自动关闭，但目的地未通过，不计完整生产G5。

额度已消费，不重跑；本轮无源码改动或重复离线测试。下一步优先对照公开对象说明符/集合属性语义，避免继续增加同一读取的重试次数。文档关闭来源保留为已实测；真实运行进程身份、production provider/capture/TUI/G5仍待完成。T6.12仍in_progress，无commit/push。


## 2026-09-17 0.1.13选择阶段固定诊断候选（最新，未安装）

在已确认固定字段范围内补齐选择阶段解析证据：MemoryMetadataDiagnostics增加固定selectionReason枚举，分别为checking/platformMissing/platformMac/platformSimulator/platformQualifiedIOS/platformDisplayIOS/platformOther/genericDestination/deviceMissing/deviceMismatch/selected；记录原有有界list/item描述符shape，传输/上下文/shape/validation失败固定分类并首错冻结。每次采样解析后输出destination_selection_sample，解决原先query_returned仅证明传输返回、没有分支解释的问题。platformQualifiedIOS仅表示精确文本com.apple.platform.iphoneos，platformDisplayIOS仅表示精确iOS；两者均仍waiting，未认定实际返回这些值，也未把它们当可接受别名。任意文本/设备ID不进入receipt。

108场景、typecheck、lint968、完整Swift warnings-as-errors与ad-hoc签名strict通过；日志`/private/tmp/itestagent-selection-diagnostics-{tests,typecheck,lint,build}.log`。新测试覆盖全部固定分支、shape、首错冻结及任意文本不泄漏。未改owner/退出授权/总期限/采样次数/物理ID匹配，也未重复上轮已通过的关闭实测或IPC门禁。

候选`/private/tmp/itestagent-metadata-0113-lsysporu`，Mach-O SHA-256 `2f036070a66e7f46fd9bceffa6321f9b9066053ae156355d586ca07b82b6a9cc`；iOS项目`/private/tmp/itestagent-metadata-project-ew_bxkpm/MetadataFixture.xcodeproj`，candidate/source/project清单齐全。未安装运行，当前安装0.1.12不变。

待一次具体整批授权：备份0.1.12→安装0.1.13→重新发现唯一ready iPhone，ID仅内存传入→原Xcode空基线/新iOS项目/必要时公开UI选择该iPhone/一次只读观察→ADR-049正常退出。包含明确退出本次独占Xcode全部未修改文档（含未知磁盘归属条目）、必要的同探针Automation授权及失败时原Xcode/probe各一次尚未发出的普通Quit；修改/owner冲突/保存或停止提示暂停，不保存丢弃、不强退、不Build/Run/调试/安装AUT/操作手机内容。总60秒、最多40次状态观察、查询错误不重试；旧运行额度不复用。T6.12仍in_progress，目的地/实际进程身份待验证，无新G5或commit/push。


## 2026-09-17 0.1.12 iPhone只读批次：文档自动关闭通过，目的地仍未验证（最新）

用户授权整批后，重新发现唯一ready iPhone（仅内存标识），备份安装核验0.1.12；备份`/Users/logansu/.itestagent/helpers/xcode-metadata-probe-backup-1db33509-9894-40df-9791-0d97c331ffbb`。证据`/private/tmp/itestagent-metadata-0112-attempt-7hwb2vac`，原probe82220/Xcode82245。使用observe、physical-destination、allow-unmodified-documents-quit，未重新申请Automation。空基线/项目打开/文档观察通过。CUA只读界面显示审阅iOS MetadataFixture、Ready、Stop不可用，目的地已是连接的iPhone，因此未点击改变选择、未Run/Build/调试/安装AUT或操作手机内容。

关键通过项：自动Quit前独立完整文档/目录复核通过；27627ms记录cleanupVerified=true、documentClosureSource=owner_process_exited，随后探针自动退出。最终独立ps无Xcode/probe残留，旧17份helper和审阅项目三文件未变。没有人工Quit或强退。该实测验证ADR-049所属Xcode进程内文档关闭来源及诊断授权组合；不证明磁盘归属，也不是完整生产G5。两个文档仍均未修改，其中一个路径ENOENT。

目的地未通过：destinationSelectionSamples=40、destinationSelectionObserved=false。40轮均只读platforms就返回waiting，未进入genericDevices/deviceIDs，说明平台值不是被接受的iphoneos（也可能是已知missing value）。当前receipt没有该分支分类，不能确定具体值或原因；不得推断错误设备ID。Xcode.sdef公开platform明确描述其标识示例为macosx/iphoneos/iphonesimulator，故不能凭界面改为匹配显示名iOS或放宽。可能是缺失元数据、其他平台标识或UI与脚本选择不同步，尚需区分。

本次额度已消费，无重跑。final-cleanup.json分别记录自动关闭通过和目的地未验证。下一步在已有固定只读字段范围内为选择阶段补齐有限分支/shape诊断，避免继续仅输出waiting；保持iphoneos与预期设备ID精确匹配。生产PermissionEngine/provider、debugger/AUT/build身份和capture/TUI/G5仍未完成。T6.12保持in_progress，本轮未改源码、不重复离线测试、无commit/push。


## 2026-09-17 显式iPhone目的地0.1.12候选完成（最新，未安装）

新增--physical-destination模式，必须同时提供仅内存环境ITESTAGENT_METADATA_EXPECTED_DEVICE_ID；配置缺失/空值/控制字符/过长/非标识字符拒绝，不回退Mac。选择等待只读取现有固定platform/generic/device字段；每次先重查完整文档双快照与原基线一致，owner/期限/目录binding仍有效。Mac、通用目的地、已知missing value或另一设备仅waiting；响应畸形/传输失败立即停止，无失败重试。最多40次状态观察、0.5秒间隔，截止总期限前10秒，单次查询仍2秒，首次空基线8秒/总期限60秒不变。命中后严格完整双快照再比较iphoneos、nongeneric、预期ID和非空scheme。

receipt只新增physicalDestinationRequested、destinationSelectionObserved、采样次数和固定诊断，targetVerified仍false：目的地匹配不是正在运行的App/构建/进程代际身份。设备ID不入CLI参数、文件、回执或模型输出。原ADR-049退出授权需显式--allow-unmodified-documents-quit并覆盖此次动作，不复用旧额度。

98场景通过（含错误设备、Mac/generic、missing、畸形、取消、过期及最终匹配），typecheck/lint968/Swift warnings-as-errors/签名strict通过；日志`/private/tmp/itestagent-physical-selection-{tests,typecheck,lint,build}.log`。未重复上轮已完成的性能包与宿主IPC全回归，未改owner源码profile。本候选`/private/tmp/itestagent-metadata-0112-69bj4paj`，Mach-O SHA-256 `d7521cb0c3de031a252c1e0028538bcd950ffc7f85816fd7255002269f229c09`；iOS临时项目`/private/tmp/itestagent-metadata-project-8zhxgaa5/MetadataFixture.xcodeproj`，包含main.swift/pbxproj/shared scheme，无脚本或外部依赖、签名禁用。完整candidate/source/project清单已保存，未安装、打开或构建。

通过公开devicectl list devices --quiet --timeout 10 --json-output /dev/stdout只读发现并在内存解析，返回成功但readyIPhoneCount=0；未持久化原始JSON/标识，未操作设备。后续需用户连接iPhone。执行时重新发现，只有唯一ready iPhone才可在用户确认的该目标范围内继续，零/多台则暂停，不擅自选设备。设备ID仅传给新probe进程环境；UI仅在本次所属Xcode选择该iPhone目的地，不Run/Build/调试/安装AUT。

待具体整批授权：备份当前0.1.10并安装0.1.12；唯一一次原Xcode空基线→打开此iOS临时项目→公开UI选择该iPhone→只读目的地匹配/文档来源→普通Quit。明确授权退出本次独占Xcode及全部未修改文档，包括未证明磁盘归属的条目；修改/owner冲突/保存或停止提示暂停，不保存丢弃、不强退。包含必要的同探针→Xcode Automation授权；失败恢复原Xcode/probe各一次普通Quit，未发过的才发，不重试已发Quit或已消费运行。未Build/Run/调试/操作iPhone内容。T6.12保持in_progress，无新G5或commit/push。


## 2026-09-17 ADR-049已确认，原生文档关闭来源首个实现通过（最新）

用户确认ADR-049后实现原owner终止来源和诊断一次Quit授权。MemoryOwnedAppHandle.originalProcessExitObserved由状态机在原实例实际终止、无身份冲突、期限内设置；观察过的冲突锁定，late exit不能修复unknown。MemoryDocumentProcessLifetime在current owner阶段关联session，只给进程内文档返回owner_process_exited。退出请求成功、清单中PID缺失、窗口消失均不够。原owner tick增加冲突检查，遇冲突不继续Quit。

诊断App显式新增--allow-unmodified-documents-quit；默认不启用，需实际运行的明确一次授权。MemoryMetadataQuitGrant绑定原owner/完整文档快照/期限，退出前独立双快照及目录binding、单workspace loaded、全部未修改复查；错误owner/文档变化/过期/再次消费拒绝，失败也不可重试。退出后receipt独立记录documentClosureSource；这不证明磁盘归属或目标身份。生产helper-main仍nil provider，PermissionEngine→实际Quit接线尚未完成，不能用诊断CLI替代生产权限。TS完整资源账本未放宽，新增debugger/AUT仍pending/unknown时拒绝释放证明测试。no-target源码profile仅更新经审阅的owner摘要；旧安装不变。

验证：85个metadata/owner/grant场景及document-session、query-native、resource-closure定向检查通过。性能包沙箱325 pass/9 skip/4 fail，2259 assertions/55文件/97.83秒；4失败为本机通知和私有socket路径。宿主复验对应4文件16 pass/0 fail、232 assertions/53.88秒。保留分开结果，不写单次全绿。typecheck、lint968、Swift warnings-as-errors完整probe构建/ad-hoc strict、diff通过。日志`/private/tmp/itestagent-adr049-{tests,package,host-recheck,typecheck,lint,build}.log`。首次lint格式问题已修复；没有新增G5或启动Xcode/iPhone。

离线构建产物0.1.11：`/private/tmp/itestagent-metadata-0111-diai3fzk`，Mach-O SHA-256 `fed5c36cced84bf1895834302e19b1cbe4048fd95b290fcf84bf8b2b528f3df8`，未安装/运行。构建脚本附带Mac fixture仅用于已有构建清单，不建议再次运行Mac分类实验。另已准备真正iOS临时项目`/private/tmp/itestagent-metadata-project-ios-iogyzmhj/MetadataFixture.xcodeproj`，plutil通过，无脚本/依赖，签名禁用；未打开/构建，清单`/private/tmp/itestagent-adr049-ios-project-review.json`。

下一单元是iPhone目的地选择/等待与显式标识匹配：当前probe仍把macosx作为严格匹配参数，不能把现有产物直接宣称iPhone候选。需完成目标配置、等待用户/公开UI选定实际iPhone后的只读校验及对应测试，再提交完整候选/项目/一次操作清单审阅。其后真实验证ADR-049，再进入production provider、debugger/AUT身份、capture/export/TUI/G5；T6.12仍in_progress，无commit/push。


## 2026-09-17 文档关闭来源决策提案（最新）

0.1.10恢复已完成，不再反复追加Mac分类探针。本轮只读核对owner/document/closure代码后，形成待确认ADR-049：把document.closed限定为原Xcode实例内文档生命周期结束，以原保留owner的实际终止作为新来源；退出前仍需完整未修改文档、原项目binding和明确涵盖额外未修改文档的一次授权。不得忽略未知文档或把Xcode退出当debugger/AUT退出。该语义改变尚未生效，未编码/安装/运行。

提案文件`docs/decisions/ADR-049-xcode-document-process-closure.md`列出替代方案、授权/证据分离、异常门禁及实现测试范围。批准后准备iOS临时项目+实际用户选定iPhone的只读目的地批次，实际运行另行审阅，不继续用My Mac missing value承担真机身份验收。T6.12仍in_progress，T6.11 done/T6.13 pending，无新G5/commit/push。


## 2026-09-17 0.1.10已授权普通退出恢复完成（最新）

用户继续后CUA恢复可用。先独立ps确认原Xcode41776/probe41757仍在，界面为审阅MetadataFixture、Ready、Stop不可用，无保存/停止提示；按此前整批授权对两者各执行一次普通Quit，未强退。最终独立ps无Xcode/probe残留，旧17份helper和审阅项目三文件摘要未变。证据`/private/tmp/itestagent-metadata-0110-attempt-7t9kydlz/final-cleanup.json`；paused-recovery.json保留历史暂停记录，当前无需再次恢复。

本轮未重跑实验、未安装或改源码，无新增G5。自动cleanup仍未通过，授权恢复成功单独记录。0.1.10实测的Mac deviceIDs missingValue与文档ENOENT仍有效；未知文档归属和真实iPhone目标身份未解决，T6.12仍in_progress。下一步应准备面向实际目标的完整证据方案，不继续把Mac缺失设备ID当解析错误修复，也不以文件不存在自动认领文档。无commit/push。


## 2026-09-17 0.1.10真实分类完成，已授权恢复待UI工具恢复（最新）

用户授权整批后已备份0.1.9、安装核验0.1.10，使用observe复用已开启Automation，不发授权申请。唯一尝试`/private/tmp/itestagent-metadata-0110-attempt-7t9kydlz/`额度已消费；原probe PID41757、Xcode PID41776。6704ms记录metadata_unavailable_or_project_mismatch/cleanup_unverified。空基线、同实例项目打开及文档观察通过。

真实新增事实：deviceIDs返回typeType/cMissingValue，itemTypeClass=missingValue，不是字符串设备标识；当前为Mac临时项目，不可外推iPhone。2个文档均未修改、fileRepresentationCount=2；一个原项目，另一个realpath失败的固定原因是missing（ENOENT），并非权限/循环/过长/非目录。ENOENT可表示路径中某部分不存在，不证明条目是内部虚拟文档或属于原项目。严格校验拒绝正确，未建立目标身份或完整资源关闭。

恢复已获本轮授权，但第一次CUA getApp即返回“Computer Use is unavailable because the current turn ended. It will work again after the next user message.”，未发任何Quit。独立ps确认原两PID仍存活；paused-recovery.json确认旧17份helper及审阅项目文件未变。下一用户消息后优先核对原PID与UI，继续原授权两者各一次普通Quit；保存/停止提示、修改或owner变化暂停，不强退。不要重新授权已批准的恢复，不重新运行探针，不用getApp启动不存在的Xcode。

本轮无源码变更，不重复离线测试。T6.12仍in_progress，无新增G5/commit/push。须先完成恢复，再处理真实iPhone目标及文档归属证据；不要把Mac missingValue转换为伪造ID。


## 2026-09-17 0.1.10双阻塞固定分类候选（最新，未安装）

在已确认诊断范围内补齐两项区分，不新增Apple Events字段：typeType条目仅输出missingValue/otherType/malformed固定分类（公开ASRegistry.h的cMissingValue='msng'），不输出任意typeCode或payload；首错冻结，换query/普通条目时清除旧分类。realpath失败立即保存errno并映射missing/notDirectory/permission/symlinkLoop/tooLong/other聚合计数，unknown仍不归属任何目录，不改变退出/目标验证。此前真实typeType究竟是哪一类仍未知，之前unresolved的原因也未补猜。

74个离线场景通过，包含类型分类/首错冻结/清除、公开errno分类与真实不存在路径；初次因旧完整字典断言未包含新增resolutionErrors失败，更新预期后通过，未改生产逻辑绕过失败。typecheck、lint968、完整Swift warnings-as-errors构建、ad-hoc签名strict、diff通过。日志`/private/tmp/itestagent-metadata-classification-{tests,typecheck,lint}.log`和`/private/tmp/itestagent-metadata-0110-build.log`。未发Apple Events，未改已安装0.1.9。

候选`/private/tmp/itestagent-metadata-0110-i6sca0ae`，Mach-O SHA-256 `d671134784e849c014a3e6d4fd1b3fdf064933e012f0359441512b04ccaf725e`；新审阅临时项目`/private/tmp/itestagent-metadata-project-7edtqk3s/MetadataFixture.xcodeproj`。完整candidate/source/project清单已保存。待一次整批安装实测授权：备份0.1.9、安装0.1.10，同实例空基线/新临时项目/file与目标诊断，总期限60秒、首次8秒后续2秒、不重试。包含必要的同探针→Xcode Automation授权；若新签名授权需用户介入，暂停并报告，不绕过系统限制。自动退出条件不变，失败恢复仅原Xcode/probe各一次普通Quit（含额外未修改文档），保存/停止提示、修改文档或owner变化时暂停，不强退、不Build/Run/调试/操作iPhone。此候选只区分既有两个事实，不承担物理目标身份/G5验收。T6.12仍in_progress，无commit/push。


## 2026-09-17 0.1.9 observe单次实测结果（最新）

用户确认Automation已开启，并另授权本次唯一只读实测与恢复。复用安装的0.1.9与审阅项目，不再安装或请求权限。证据`/private/tmp/itestagent-metadata-019-observe-a6gz74br/`；probe63387/Xcode63394，permissionAttempted=false。空基线及同实例项目打开通过，2793ms进入workspace加载，5266ms报告metadata_unavailable_or_project_mismatch/cleanup_unverified。

新增真实事实：
- 文档双快照解析通过，2 documents/1 workspace/0 modified；原项目1、realpath未解析1。file只读list有2项，fileRepresentationCount=2、missingCount=0、unknownCount=0；该字段目前合计fileURL/alias形状，不证明两项磁盘存在、逐项对应或第二项归属。不能再把“可能missing value”写成实测结论。
- documentReadEligible=true、documentMetadataObserved=false，说明已确认的只读观察/严格退出分离实际生效。两次集合条件没有被当作完整ownership或自动退出证明。
- deviceIDs在18ms返回list(1)，itemDescriptorType=1954115685，即公开typeType（fourCC type），严格字符串解析报告itemType。记录没有该typed descriptor的typeCode值，不能认定为missing value；也不能以My Mac目的地结果外推物理iPhone设备标识。platform/generic后续字段尚未读取，完整目标验证仍未完成。

按同次预先授权正常Quit原Xcode和probe，无保存/停止提示、未强退。final-cleanup.json独立确认无残留，旧17份helper与审阅项目三文件未变。无Build/Run/debugger/AUT/iPhone动作。一次额度已消费，不重跑。原69场景离线结果仍有效，本轮无源码变更，无新增G5/commit/push，T6.12保持in_progress。

后续不因typeType盲目接受/转换设备ID，不因file表示放宽未知文档收口。需要在公开表示与实际目标边界上继续定位：可离线完善typed missing value与其他typeCode的固定分类；物理目标身份必须另用真实iPhone目的地证据，Mac fixture不承担该验收。未知文档仍需公开file/path对应及磁盘解析失败原因的证据，不能凭“未修改”认定所有权。下一次运行前应合并这两项可区分诊断，避免单字段版本迭代；实际动作仍需具体审阅。


## 2026-09-17 0.1.9授权等待超时与恢复（最新）

已按用户整批授权备份0.1.8、安装并核验0.1.9，备份`/Users/logansu/.itestagent/helpers/xcode-metadata-probe-backup-a0961b2e-00e5-4003-8e73-6c8b8707385f`。唯一运行`/private/tmp/itestagent-metadata-019-attempt-j5z5gcj3`已消费，原probe90579/Xcode90582。1906ms记录permission_pending；60004ms记录cleanup_unverified。未进入空基线查询、未打开临时项目、没有file/deviceIDs结果，不能据此判断新增诊断实现成功或失败。总期限正确触发；早先观察未见终态只是读取时点尚早，不确认为超时逻辑缺陷。

CUA读取probe超时，系统UserNotificationCenter接口被工具以安全原因为由禁止访问；没有绕过该限制，也没有证据可确定用户当时看到的授权弹窗内容。按本轮预先授权对原Xcode、probe各一次普通Quit恢复，无保存/停止提示、不强退。final-cleanup.json独立确认无残留，旧17份helper与审阅项目三文件均未变。无Build/Run/调试/设备动作。

下一步先由用户在系统设置的隐私与安全性→自动化中确认iTestAgentMemoryMetadataProbe对Xcode的授权；若无条目，不假定已拒绝或允许。已安装0.1.9可保留，不需重新构建/换签名。待权限状态明确后再审阅新一次同候选运行额度；不自动重试本轮。离线69场景通过仍有效，但不替代实测。T6.12保持in_progress，无新增G5或commit/push。本轮无源码变更，不重复测试。


## 2026-09-17 0.1.9有限诊断补充已确认并完成候选（最新）

用户确认公开file字段诊断与只读目标查询/严格退出条件分离。新增固定documentFiles get-data，只接受有界list并聚合missing value、fileURL/alias表示、未知类型；不解引用、不强制转换、不解析alias、不输出payload。计数一致不证明逐文档对应，associationVerified始终false。file查询失败使用独立诊断，不毒化目标reader；目标诊断每轮必须重新读取与先前一致的完整文档双快照，并满足原owner/目录binding、单workspace loaded、全部未修改。额外未修改文档仅允许继续只读，不通过isSingleUnmodifiedDocument/isSingleUnmodifiedWorkspace；自动退出、targetVerified和生产nil provider保持原条件。修复独立documentReader的transport诊断仍指向主diagnostics的问题，使传输首错也进入正确的独立分类。

69场景真实AEDesc离线回归通过，包括额外未修改文档读取、修改拒绝、第二轮条件变化拒绝、deviceIDs类型失败保持、缺失/fileURL/alias/unknown聚合、超长/错误数量/标量拒绝及不输出内容；无Apple Events发送。typecheck、lint968、完整Swift warnings-as-errors、ad-hoc签名/strict通过。日志`/private/tmp/itestagent-metadata-019-{tests,typecheck,lint,build}.log`。未重复全仓测试或真实验证。

候选`/private/tmp/itestagent-metadata-019-kewonhk0`，Mach-O SHA-256 `8d5ee0153e8e870642c8cbfcab3137315870ee2bac33db488e4bedb8dbb146d6`；新临时项目`/private/tmp/itestagent-metadata-project-ax2evr_o/MetadataFixture.xcodeproj`。candidate/source/project清单已保存，安装的0.1.8可执行文件摘要仍一致，尚未安装运行0.1.9。

待具体整批授权：备份0.1.8，安装上述0.1.9，消费唯一一次空基线→原实例打开指定临时项目→文档file及目标诊断；仅必要的探针→Xcode Automation授权。首次8秒、后续2秒、总期限60秒且不重试。原严格退出条件不变；若额外文档或其他失败导致自动退出未确认，授权对本次原Xcode和probe各一次普通Quit恢复（额外未修改文档本身不阻止该明确授权恢复），出现保存/停止提示立即暂停、不确认丢弃、不强退。修改状态或owner变化立即停止诊断并暂停恢复。无Build/Run/debugger/AUT/iPhone动作；不复用0.1.8额度。T6.12保持in_progress，尚无新增G5、commit/push。


## 2026-09-17 公开语义复核与待确认补充方案

只读复核未启动Xcode/probe，未安装新版本，未消费新运行额度。结论：Xcode.sdef的document集合包含不同文档子类，workspace document继承document；path仅描述为文档路径，未承诺必须对应现存磁盘对象。document.file公开原文为“Its location on disk, if it has one.”。因此不能把realpath失败直接归类为外部文档，也不能把它当作已证实的内部虚拟文档。Apple的[NSDocument.fileURL](https://developer.apple.com/documentation/appkit/nsdocument/fileurl)为可空位置；[初始化文档](https://developer.apple.com/documentation/appkit/nsdocument/init(for:withcontentsof:oftype:))说明未显式保存的自动保存文档可没有目标URL。这只是可能性依据，不是本次第二项的性质证明。

按现有证据排序的三个待区分假设：
1. 第二项没有可解析的磁盘表示：与unresolvedCount=1一致，但未读取公开file属性，不能细分未保存、虚拟或其他情况。
2. 第二项存在逻辑路径，但对象缺失或解析受阻：realpath统一返回失败，尚无errno或file表示对照，不能排除。
3. 文档集合或关联关系的查询语义与预期不同：双快照一致降低瞬时漂移可能，但不证明原子性、永久身份或归属。

[NSApplication.terminate](https://developer.apple.com/documentation/appkit/nsapplication/terminate(_:))允许文档控制器取消退出、delegate延迟或拒绝；普通Quit的请求与实际退出必须分开记录。此公开语义不自动授权关闭未知文档，也不放宽ADR-044/046/047完整lease条件。现有生产nil provider保持。

建议一次性补充，尚待技术范围确认：
- 固定只读查询增加document.file，仅用公开get-data；严格限制列表/描述符/期限，区分missing value、文件表示、未知类型/失败。不读取文档内容、不解析任意对象引用、不隐式挂载卷、不输出路径或原始reply。与现有path/modified双快照结合，只输出聚合诊断；无法建立对应关系时明确unknown。
- 在专用无Build/Run/debugger/AUT的临时项目诊断中，把“元数据可只读观察”与“可自动退出”分开：原owner、目录binding、单一workspace loaded、文档解析成功且全部未修改时，即使存在额外未修改文档也允许继续固定scheme/device只读诊断；查询不得绕过owner/取消/期限。完整target验证与自动退出仍按原严格条件，不把读取成功当身份或cleanup成功。修改文档、owner变化、额外workspace、响应不完整均停止。
- 单次诊断同时报告文档file形状和已有deviceIDs首错类型，避免一个无关严格匹配条件提前遮蔽另一阻塞。单字段失败不重试，也不伪造完整snapshot；后续独立诊断必须有独立失败分类并受总期限约束。
- 先完成编码、真实AEDesc离线回归、候选构建与审阅清单；之后再请求具体候选安装/一次实测及普通Quit恢复授权，不复用0.1.8额度。未知项保留为未证实；若公开字段仍不足，不再以每次增加一个字段的方式反复安装。

ADR-048当前明确“查询字段限文档路径/修改状态、workspace 加载状态、scheme ID、目的地 platform、设备标识和 generic 状态。”新增file和调整诊断继续条件属于待确认边界，故此轮只记录方案、不改代码。T6.12仍in_progress；AC7原文：“真机与 Simulator 能力分别实测，不能以独立后端 probe 或 fixture 单测替代生产链路验收。”本轮无新增G5、commit/push。


## 2026-09-17 0.1.8聚合分类结果与恢复（最新）

已确认的0.1.8备份升级和唯一运行完成；0.1.7备份`~/.itestagent/helpers/xcode-metadata-probe-backup-9548b84d-d381-437d-999c-8502c8bd561b/`。运行证据`/private/tmp/itestagent-metadata-018-attempt-t4k2d9_7/`。文档解析成功，分类结果documentCount=2、workspaceCount=1、modifiedCount=0、expectedProjectCount=1、projectDescendantCount=0、temporaryRootDescendantCount=0、outsideCount=0、unresolvedCount=1。即原临时项目以外还有一个不能realpath解析的条目，性质仍未知；不能把unresolved当outside或inside，也不能称为Xcode内部虚拟文档。该分类准确说明上一轮unmodified=false并非存在修改，而是单元素数组匹配失败。

原单文档门禁保持，document_metadata_unavailable/cleanup_unverified，未到deviceIDs。按此次明确包含额外文档的恢复授权，对原Xcode55570和probe55569各一次普通Quit；无保存/停止提示、不强退。final-cleanup.json独立确认无残留，旧17份helper与审阅的临时项目三文件未变。原始路径未输出，未Build/Run/调试/操作设备。

现阶段证据足以否定“文档清单必定等于一个磁盘项目目录”的简化假设，但尚不足以建立未知条目的归属或忽略规则。后续需先确定公开元数据如何表示这类文档、以及独占Xcode生命周期的正确关闭前置；不得继续仅增加安装版本或把unknown改成成功。deviceIDs条目解析仍为独立未解决项。T6.12保持in_progress，无新增G5/commit/push。本轮未修改源码或重复离线门禁。

## 2026-09-17 0.1.8文档集合聚合分类候选（最新，未安装）

补充documentLocationSummary，仅输出documentCount/workspaceCount/modifiedCount、expectedProjectCount/projectDescendantCount/temporaryRootDescendantCount/outsideCount/unresolvedCount和valid布尔。使用公开realpath解析实际位置后按完整路径组件分类；不能解析的条目进入unresolved，不猜测不存在路径归属。该分类不提供owner证明，不改变原单文档关闭门禁或target校验，所有原始路径留内存。

53场景回归通过，新增实际临时目录/文件、相似前缀目录、符号链接越界、不存在条目的分类及无路径输出检查。首次测试发现Foundation对存在路径和不存在路径规范化/private/tmp行为不一致；改用realpath，未知单列后通过。Swift warnings-as-errors、重新ad-hoc签名/strict、typecheck/lint/diff通过；日志`/private/tmp/itestagent-metadata-018-{tests,build,typecheck,lint}.log`。未运行Xcode或新探针，不复用0.1.7已消费额度。

最终候选`/private/tmp/itestagent-metadata-018-fg73li7j`，Mach-O SHA-256 `3cc74101039771f10780bfdce83a8432f2c79b9869f1b4cc3b3f023daa244d32`；新项目`/private/tmp/itestagent-metadata-project-oqds0cie/MetadataFixture.xcodeproj`。candidate/source/project清单已按最终源码刷新；初次未通过分类回归时的二进制已在临时候选中重新构建，不作为可执行授权对象。已安装0.1.7保持不变。

待具体整批授权：备份0.1.7、安装0.1.8，一次同实例空基线/打开指定临时项目/固定只读文档及聚合诊断。首条8秒、后续2秒、总60秒不变，无失败重试。不Build/Run/调试/操作iPhone，必要时仅该App→Xcode Automation授权。此次拟明确允许在发现额外文档时仍对本次原Xcode与probe各请求一次普通Quit作为恢复；如出现保存/停止调试提示则暂停，不确认丢弃、不强退。自动关闭门禁不放宽，人工授权恢复独立留档。T6.12仍in_progress，无新增G5、commit/push。

## 2026-09-17 0.1.7定位到文档集合匹配、额外授权恢复完成（最新）

0.1.7安装及唯一验证已消费；0.1.6备份`~/.itestagent/helpers/xcode-metadata-probe-backup-a2ee5f55-fb9b-41e3-b782-1a67bb0b8650/`。运行证据`/private/tmp/itestagent-metadata-017-attempt-orb2nyxy/`。空基线、同实例open/loaded与独立文档双快照解析通过；documentDiagnostic.failure=none。匹配结果singleDocument=false、workspaceMatchesDocuments=false、unmodified=false、directoryMatches=false、loaded=true。reader保证workspace非空且属于完整documents清单、paths唯一，因此可以确定documents多于一个；不是本次AE发送/解析错误，也未到deviceIDs。unmodified=false是数组不等于[false]，不能推出存在已修改文档；directoryMatches=false也因为singleDocument门禁，不能单独推出原目录替换。

触发原授权“额外文档暂停”，未自动退出。CUA只读显示临时MetadataFixture窗口、Ready、My Mac、Stop disabled，不能说明额外文档性质。用户随后明确授权原Xcode48371及probe48369各一次普通Quit；已完成，无保存/停止提示，不强退。final-cleanup.json独立确认无残留，旧17份helper与临时项目三份审阅文件未变；paused-verification.json保留此前暂停状态，自动cleanup仍false。

当前明确问题是单workspace与完整document集合不能在本次场景直接按一对一匹配。额外条目可能是项目关联文档，也可能是其他文档，尚无分类证据，不能猜测或直接放宽规则。下一步只读诊断应输出文档计数、是否含原项目、全部未修改、条目位于原项目/专用临时根内或外的聚合分类，不输出路径；分类不是ownership proof，需结合原owner、文件binding及无用户文档的证据决定归属规则。原deviceIDs条目问题仍独立未解。T6.12保持in_progress，不记G5；本轮无新源码改动、无commit/push。

## 2026-09-17 0.1.7完整文档诊断候选（最新）

本候选仅打包上一轮已测试的独立documentDiagnostic和五项documentMatchChecks，不新增事件/权限，不调整0.1.6首次8秒、后续2秒、总体60秒预算，不放宽文档退出或目标验证。文档解析失败时输出该独立reader固定失败分类；解析成功但不匹配时输出singleDocument/workspaceMatchesDocuments/unmodified/loaded/directoryMatches布尔结果。完整target字段仍必须另行通过，缺失不算身份验证。

候选`/private/tmp/itestagent-metadata-017-d7xltufi`，Mach-O SHA-256 `c0cfedcdcb38e54fc11b2a428228c0568e26ce5b71382c2ce79b16144ed12806`；新临时项目`/private/tmp/itestagent-metadata-project-0b03csnz/MetadataFixture.xcodeproj`。candidate/source/project完整清单保存；Swift warnings-as-errors、ad-hoc签名/strict通过，日志`/private/tmp/itestagent-metadata-017-build.log`。同一实现的52场景诊断回归、typecheck/lint通过，未重复跑无变更的全仓测试。已安装0.1.6逐文件及签名核验未变；0.1.7尚未安装运行。

待整批授权范围与0.1.6相同、额度为新一次：备份0.1.6并安装0.1.7；独占Xcode空基线→同实例打开上述临时项目→独立文档与目标读取→符合文档门禁后普通退出，目标失败明确target_unverified。必要时仅该App→Xcode Automation授权；失败恢复对本次原Xcode/probe各一次普通Quit，保存/停止提示或额外文档暂停，不强退、不重试。不Build/Run/调试/操作iPhone。T6.12保持in_progress，无新增G5或commit/push。

## 2026-09-17 0.1.6文档观察未通过、诊断缺口已补（最新）

用户明确授权整批后，0.1.5备份与0.1.6安装核验完成；备份`~/.itestagent/helpers/xcode-metadata-probe-backup-717aac52-e1df-4bb4-861e-8c4288e5ac3a/`。唯一尝试`/private/tmp/itestagent-metadata-016-attempt-qdvwd028/`额度已消费。空基线3934ms通过，原owner项目open回调3954ms匹配，workspace加载后进入文档双快照；5847ms报告document_metadata_unavailable，cleanup_unverified。未进入deviceIDs，不能宣称新解析诊断已拿到实际条目类型；首次8秒预算只在本次成功，不代表稳定性长期通过。

查实一个诊断实现缺口：独立documentReader使用默认diagnostics，而receipt仅输出主diagnostics；snapshotMatchesDocument还把解析失败和五项匹配拒绝都压成false。因此当前记录无法确定实际文档失败原因。补充独立documentDiagnostic与documentMatchChecks五个布尔值：singleDocument/workspaceMatchesDocuments/unmodified/loaded/directoryMatches。原匹配函数与诊断共用同一条件，避免解释与判断漂移。不输出路径、scheme或设备ID，不放宽校验。52场景新增逐项布尔断言通过，typecheck/lint通过；完整探针另做warnings-as-errors编译，不执行。已安装0.1.6不变，没有新候选安装或运行。

按本次授权，对原Xcode97672及probe97671各一次普通Quit恢复。Xcode快捷键后UI工具报procNotFound，独立ps确认原Xcode已退出，未再调用getApp重启；probe经活动监视器精确PID普通Quit，未强退。final-cleanup.json确认两者无残留，旧17份helper及临时项目三份审阅文件未变。无保存/停止提示、无额外文档、无Build/Run/设备动作。自动cleanup仍未确认，人工授权恢复单独记成功。

本轮未宣称解决文档匹配根因，也未重试或伪造G5。后续先用完整诊断区分解析与匹配，再进入生产provider；目标字段问题独立保留。日志`/private/tmp/itestagent-metadata-document-diagnostics-{tests,typecheck,lint,build}.log`。T6.12仍in_progress，无commit/push。

## 2026-09-17 持续收口0.1.6：首次读取预算与独立文档关闭候选（最新）

用户要求继续直到T6.12完成，普通实现按整体已确认计划连续推进。基于0.1.4首读1972ms成功、0.1.5首读2003ms超时，增加显式诊断启动预算MemoryMetadataSendBudget：仅首条documentPaths可消费一次8秒上限；消费后（包括失败/无效输入）后续2秒。普通transport默认仍2秒，绝对deadline夹紧，无失败重试。探针空基线预算12秒，原总期限60秒不变。预算调整是待实测的启动延迟假设，不是已证实修复。

文档观察与target观察分开：独立reader只读取documentPaths/documentModified/workspacePaths/workspaceLoaded，两次一致且loaded；从不读取或填造scheme/device。完整snapshot依然严格校验所有目标字段，documentsOnly结果不能通过isSingleUnmodifiedWorkspace。探针先确认单一未修改临时文档和持续目录binding，再进行完整目标读取。目标条目解析失败不会毒化独立文档reader，但退出前必须重新双快照确认同一目录、未修改、无额外文档，且原owner仍可观察。文档失败依然保留，不允许借早先空基线退出。新增终态observed_document_closed_target_unverified与observed_project_closed区分；不把文档关闭当targetVerified或G5。该规则仅用于无debugger/AUT的明确诊断项目，生产完整lease门禁未改。

52种元数据/预算/隔离场景通过，包含预算一次消费/无效deadline/错误首query、目标缺失或嵌套时文档独立观察、文档modified/unloaded/foreign/extra拒绝、无目标字段查询等；目录绑定定向测试也通过（共2 tests/7 assertions）。Swift warnings-as-errors、签名/strict、typecheck/lint/diff通过。日志`/private/tmp/itestagent-metadata-016-{build,tests,typecheck,lint}.log`。初次fixture编译发现throwing调用不能放入precondition autoclosure，改为先求值helper后最终通过，不属于live结果。

候选`/private/tmp/itestagent-metadata-016-sndefvs9`，Mach-O SHA-256 `275da0c9d712d111be09db29396db932dffb064a36199a0b0db30a1a880d23b6`；新项目`/private/tmp/itestagent-metadata-project-faju770a/MetadataFixture.xcodeproj`。完整candidate/source/project清单已保存；未安装/运行。已安装0.1.5保持不变，无新G5、commit/push。

待一次整批授权：备份0.1.5→安装0.1.6→同实例空基线/打开指定新临时项目/独立文档与完整目标观察/原owner普通退出。必要时仅该App→Xcode Automation授权。不Build/Run/调试/操作设备。允许目标验证失败但上述独立文档门禁通过时正常退出，并保留target_unverified；无法自动确认时对本次原Xcode与probe各一次普通Quit恢复，遇保存/停止提示或额外文档暂停，不强退、不重试。

## 2026-09-17 0.1.5空基线超时、恢复完成（最新）

已授权备份升级和唯一运行完成；0.1.4备份`~/.itestagent/helpers/xcode-metadata-probe-backup-42d34c28-1252-4c83-9a68-b3ee8afff35b/`。证据`/private/tmp/itestagent-metadata-015-attempt-9vvcpniz/`。在2202ms开始empty baseline，首条documentPaths发送2003ms后返回-1712，4207ms记录empty_baseline_unavailable，随后cleanup_unverified。projectOpenRequested=false、projectOpened=false，没有打开本次临时项目，更未到deviceIDs；不能宣称新的解析诊断已获得真实结果。额度已消费，不重跑。

本轮新增信息：空文档初始查询也可超时，问题不能全部归因于非空workspace。0.1.4首条同类查询1972ms通过而第二次11ms，本轮2003ms超时，说明首条查询接近预算边界；这支持将初始事件处理延迟单独研究，但尚不能确认是Xcode脚本初始化、调度/负载或其他事件处理因素。设备标识条目解析问题仍是另一独立未解项。不能因0.1.4部分成功而宣称通道已稳定。

按整批授权对原Xcode93271及probe93265各一次普通Quit，无保存/停止提示，未强退。final-cleanup.json独立确认无残留，旧17份helper及本次临时项目审阅文件均未变。CUA仅见Welcome窗口，不能代替完整文档清单。本轮未改源码或重跑已通过离线测试，无新增G5，无commit/push。

下一步先重审首次查询的就绪/预算设计与实验可判定性：区分有界启动预热与稳定态元数据查询，不把isFinishedLaunching视作Apple Events就绪证明，不自动重试失败事件。新设计及可审阅候选准备好前不再发起安装/运行；若调整预算，明确作为待证假设而非既定修复。保持两项独立阻塞：首条通道稳定性、deviceIDs条目解析。

## 2026-09-17 0.1.5精确解析诊断候选（最新，未安装运行）

0.1.4已将问题定位为deviceIDs返回后的严格条目解析，非发送超时。0.1.5仅携带上一轮已完成的itemDescriptorType数值及固定拒绝原因诊断；分阶段顺序、query集合、超时和身份校验不变，不接受空ID，不自动flatten或做字符串coercion。预期用一次固定流程区分itemType/textUnavailable/textEmpty/textLimit/textControl；若其他阶段先失败则保留实际首错，不声称已经查明deviceIDs。

候选`/private/tmp/itestagent-metadata-015-2pavhsvv`，Mach-O SHA-256 `a8e3d7181ee22b174ea01123f5f68d309a4219ab699a682cd376ae2b18825b5f`。新临时项目`/private/tmp/itestagent-metadata-project-derd90_a/MetadataFixture.xcodeproj`仅复制上轮核验未变的三文件，不含xcuserdata。candidate-review/source-review/project-review完整清单保存。Swift warnings-as-errors、ad-hoc签名和strict验证通过，日志`/private/tmp/itestagent-metadata-015-build.log`；相同源码的47场景回归、typecheck/lint/diff已通过。已安装0.1.4逐文件/签名复核未变，0.1.5未安装或运行。不新增G5。

待整批具体授权：备份0.1.4、安装0.1.5，执行一次空基线→同实例打开指定临时项目→固定只读元数据实验；必要时仅该App→Xcode Automation授权。不Build/Run/调试/iPhone操作。成功普通退出；失败对本次原Xcode和probe各一次普通Quit，遇保存/停止提示或额外文档暂停，不强退、不重试。额度不能复用0.1.4；不能在诊断前凭猜测放宽解析。

## 2026-09-17 0.1.4分阶段结果：阻塞定位到deviceIDs解析（最新）

已获整批授权并完成0.1.3备份/0.1.4升级，运行额度消费。记录`/private/tmp/itestagent-metadata-014-attempt-mhviukjr/`；备份`~/.itestagent/helpers/xcode-metadata-probe-backup-6de7899b-6a74-4010-a031-4672c6c8d0c0/`。同一Xcode PID66819空基线通过（3993ms），随后open回调匹配原实例（4005ms），workspaceLoaded等待后通过（5847ms），非空documentPaths/documentModified/workspacePaths/workspaceLoaded/schemeIDs通过；deviceIDs发送17ms内返回list(1)，但条目严格解析失败（6046ms）。最终metadata_unavailable_or_project_mismatch、cleanup_unverified，workspaceMetadataObserved=false。

本次不是send timeout，问题已缩小到deviceIDs的条目类型/文本约束；不能因查询返回而称设备身份通过。原诊断只有容器list(1)和validation，无法确定是非文本、空文本、超限还是控制字符。先前冷启动超时的唯一根因仍未证实；空基线首条documentPaths耗时1972ms，后续同类11ms，也不能把时序差异当作因果证明。本次未到platform/generic或第二轮完整非空snapshot。

已按本次授权普通Quit原Xcode66819和probe66818，无保存/停止提示或额外文档，未强退。独立ps确认无残留，旧17份helper与审阅的临时项目三文件均未变；final-cleanup.json保留automaticCleanupVerified=false与userAuthorizedRecoveryVerified=true。未Build/Run/调试/操作设备。

离线补齐解析诊断：itemDescriptorType数值及固定itemType/textUnavailable/textEmpty/textLimit/textControl/pathFormat/booleanEncoding分类，首错冻结；不输出元数据值、不放宽校验、不自动flatten嵌套列表。新增空device、非文本device、嵌套list的拒绝及诊断回归，47场景通过。日志`/private/tmp/itestagent-metadata-item-diagnostics-tests.log`、`itestagent-metadata-item-typecheck.log`、`itestagent-metadata-item-lint.log`。仅源码更新，已安装0.1.4不变，未运行新版本。具体真实条目类型仍待新审阅实验，不猜测My Mac可用标识或用其代替iPhone身份。T6.12仍in_progress，无新增G5或commit/push。

## 2026-09-17 集中收口：同实例分阶段候选0.1.4（最新）

用户已同意停止零散调参重试，采用分阶段诊断→生产接线→集中补验收。0.1.4不增大超时，不自动重试失败查询。变化仅在独立探针：先启动空Xcode，完成launch/permission及两次一致空文档快照；仅基线成功后通过公开NSWorkspace打开审阅的临时项目，回调必须匹配原handle的NSRunningApplication。随后等待固定workspaceLoaded，再完整非空双快照/退出前复查/原owner正常退出。空基线失败时不打开项目；项目打开已请求后不允许借先前空基线退出，仍必须重新证明原项目未修改且无外来文档。原60秒总体期限、每条2秒、snapshot8秒和清理复查4秒保持不变。

receipt升级为version2，新增单调sequence、会话有界elapsedMs、原xcodePID、projectOpenRequested/projectOpened分离，以及固定query_started/returned/failed记录。没有元数据值或原始error/reply；returned仅代表transport返回，不能当严格解析成功。通过时间线明确空基线、open请求/回调、loading及具体query，首错诊断冻结保持。超时后不再发下一条查询，不重跑实验。NSWorkspace不采用已有Xcode实例；实际打开前及回调核验原owner。

| 实验结果 | 可以得出的结论 | 后续行动 |
| --- | --- | --- |
| 空基线失败 | 问题先于项目打开，不能归因于非空workspace | 保留首错，停止本次项目动作，检查通道/生命周期 |
| 空基线通过，open回调失败或owner不同 | 项目打开或原实例连续性失败 | 不查询/不接管新实例，按恢复范围处理 |
| 回调匹配，loading查询失败 | 问题出现于项目打开后；仍不能仅凭超时区分忙碌与查询实现 | 用明确时点证据决定最小后续诊断，不直接增大超时 |
| loading通过，特定元数据query失败 | 缩小到该固定查询/格式 | 离线对照公开字典及回复类型后修复 |
| 双快照及退出通过 | 单项目元数据/原owner关闭可用 | 停止扩展该探针，进入生产provider和目标绑定；不算生产G5 |

候选`/private/tmp/itestagent-metadata-014-yoyqtb84`，Mach-O SHA-256 `e3ba62177f9bfb67cbbeb8aa0e5fe937bc2c2914937b92ab8489b209f4c936de`。新临时项目`/private/tmp/itestagent-metadata-project-c3i5yqc6/MetadataFixture.xcodeproj`复制前次已核对的三份非敏感文件，沿用Xcode规范化scheme，不复制xcuserdata/workspace状态；无脚本action/包依赖。candidate-review.json/source-review.json/project-review.json完整清单已保存。Swift warnings-as-errors、ad-hoc签名/strict、元数据44场景与真实临时目录binding两项测试通过（2 tests/7 assertions）、typecheck/lint/diff通过；源码编译及离线测试不是分阶段流程live证明。日志`/private/tmp/itestagent-metadata-014-{build,tests,typecheck,lint}.log`。未安装运行。

待具体授权：备份0.1.3、安装0.1.4，执行一次上述同实例分阶段验证（包含一次空基线及一次打开指定临时项目）；必要时仅该App→Xcode Automation授权。不Build/Run/调试/操作iPhone。成功正常退出；失败按授权对原Xcode/探针各一次普通Quit，保存/停止提示或额外文档则暂停，不强退、不重试。核验只先读receipt/ps，防止CUA误启动已经退出的应用。

## 2026-09-17 0.1.3非空项目实测超时、恢复完成（最新）

用户确认后0.1.2已完整备份，0.1.3安装、候选/项目哈希与strict签名核验通过；旧helper保持不变。备份`~/.itestagent/helpers/xcode-metadata-probe-backup-7873543c-65b6-4a6e-8c70-e887eb94422d/`。本次唯一运行位于`/private/tmp/itestagent-metadata-013-attempt-01n2013l/`，额度已消费。

receipt进入waiting_for_xcode_launch、permission_pending、waiting_for_workspace_load后，workspaceLoaded的send返回-1712，elapsedMs=1986、finishedLaunching=true，最终workspace_readiness_unavailable/cleanup_unverified；workspaceMetadataObserved=false。未获得非空双快照，不算通过。CUA只读显示唯一MetadataFixture项目窗口、scheme MetadataFixture、My Mac、Ready及Stop disabled；这不是Apple Events成功或进程身份的替代证据。没有执行Build/Run/调试/iPhone动作。

按本次一并授权的失败恢复，对原Xcode PID50125执行普通Quit；无保存/停止提示。对原probe PID49982经Activity Monitor选择Quit，未Force Quit。最终独立ps确认两者无残留；final-cleanup.json明确区分automaticCleanupVerified=false与userAuthorizedRecoveryVerified=true。旧17份helper文件未变。临时项目的源文件和project.pbxproj未变，共享xcscheme被Xcode自动重写：version1.3→1.7、补默认Test/Profile/Analyze/Archive action及debugServiceExtension；因此reviewedProjectFilesUnchanged=false，不复用旧项目清单进行下一次实测。没有回滚这些临时文件或修改业务项目。

后续诊断假设按现有证据排序：①启动完成后项目加载/初始化仍占用事件处理；②首次非空查询2秒预算不足；③非空workspace查询处理或编码仍存在问题。当前只能确定发送超时，无法分离根因；晚些时候UI Ready不证明发送时Ready。先离线准备能分离启动、项目加载和固定读取阶段的诊断证据，不简单扩大超时或自动重放。空文档0.1.2成功证据仍有效；本次不新增G5。T6.12仍in_progress，无commit/push。

## 2026-09-17 非空项目候选0.1.3（待真实授权）

继续已确认的完整计划，准备非空元数据及原owner退出验证。公开Xcode.sdef说明workspace未loaded时对其发消息会报错；新增回归先RED后GREEN，reader在loaded=false时停止，不再查询scheme/device。新增单workspace匹配规则和loading响应解析：完整文档恰好一个、workspace同路径、unmodified、loaded、非空scheme/device、macosx且非generic，并用持续保留目录描述符核验路径/inode。该规则只核验观察到的选择，不代表正在运行的目标身份。

探针可选--project模式使用公开NSWorkspace open URLs启动自己的Xcode并打开一个明确临时项目；生产owner及v4源码清单不变，Apple Events仍只有固定只读get-data。启动完成及授权后，在原60秒期限内每250ms检查workspaceLoaded，空清单/false仅表示继续等待；错误/多个workspace/无效格式立即失败，不重试失败查询。loaded后只执行一组双快照；成功时退出前再次复查原项目未修改、无额外文档和原目录身份，再普通退出所属Xcode。没有独立文档关闭证明，也没有build/run/debugger/AUT动作。

候选`/private/tmp/itestagent-metadata-013-ihx0bxf6`，Mach-O SHA-256 `bcc1e133a9b5b7f6d912a645daa49f2acfea86b435d498ca27aebb216768969f`；candidate-review.json、source-review.json、project-review.json保存完整清单。项目`/private/tmp/itestagent-metadata-project-btfw98cn/MetadataFixture.xcodeproj`为新建macOS命令行示例，有一个Swift源文件和共享scheme，无脚本构建阶段、包依赖或签名需求。plutil项目语法通过，尚未在Xcode打开/构建/运行。签名候选使用临时ad-hoc，不访问Keychain身份。

Swift warnings-as-errors、strict签名、44场景无GUI回归、typecheck、lint968、diff检查通过；日志`/private/tmp/itestagent-metadata-project-test.log`、`itestagent-metadata-013-build.log`、`itestagent-metadata-013-typecheck.log`、`itestagent-metadata-013-lint.log`。未重跑全仓或性能包；0.1.3未安装运行。已安装0.1.2及其成功记录保持原样。

待授权具体动作：备份0.1.2并安装0.1.3；仅一次authorize模式启动无既有实例的Xcode并打开上述临时项目，不执行Build/Run或操作iPhone。仅允许该探针→Xcode的Automation授权。期望observed_project_closed；它表示元数据观察与原Xcode退出，不是生产G5。失败保留结果，按授权对本次原Xcode与探针各一次普通Quit恢复；保存/停止调试提示立即暂停，不强退、不重试，不改已有业务项目或其他helper。若出现额外文档，停止自动退出，交由用户处理。

## 2026-09-17 0.1.2空文档实测通过（最新）

用户明确确认后完成0.1.1备份与0.1.2升级，逐文件哈希与strict签名核验通过。备份`~/.itestagent/helpers/xcode-metadata-probe-backup-b1a615dc-19f2-4f3f-bda2-2a7e7c123593/`；本次独占记录`/private/tmp/itestagent-metadata-012-attempt-lz5gd5v3/`。单次额度已消费，不重跑。

receipt依次为waiting_for_xcode_launch、permission_pending、observed_empty、observed_empty_closed；emptyDocumentsObserved=true、cleanupVerified=true。实际执行两次一致的空documents/workspace元数据快照，退出前再次查询为空，并观察原Xcode退出；探针自行退出。最后workspaceLoaded响应为公开list类型、itemCount=0、finishedLaunching=true、elapsedMs=16。该16ms只属于最后一条查询，不是全部查询耗时。无工程、debugger、AUT或设备动作。修正启动检查及预算后本次通过，但不能仅凭一次成功分离两项改动的因果贡献。

核验插曲：在读取终态receipt前调用CUA getApp查看Xcode，工具可能在原实例已退出后重新启动了Welcome实例；独立ps见Xcode PID96458、探针已无残留。对该检查产生的Welcome实例普通Quit，无保存/停止提示。最终独立ps确认Xcode与探针均无残留，旧17份helper文件不变，证据final-verification.json。此人工退出与probe自身reported cleanup分开记录，不把核验残留忽略；后续短生命周期验证只先读取receipt/ps，避免getApp自动启动已退出应用。

本次证明无工程真实Xcode的公开空元数据查询与原owner自动关闭；没有非空workspace/scheme/device实测，也不证明物理目标绑定、debugger/AUT闭合、capture/export或生产TUI G5。T6.12仍in_progress。下一步沿已确认整体计划准备有文档的只读观察与生命周期组合，再进入实际provider；真实打开项目/安装/运行范围需候选审阅后的单次授权。没有commit/push。以下为历史记录。

## 2026-09-17 0.1.1普通退出恢复完成

用户回复“继续”后，对原Xcode PID92001执行一次普通Quit；对原探针PID91992经Activity Monitor选择Quit（非Force Quit）。未出现保存/停止提示。独立ps确认两者均无残留；恢复证据`/private/tmp/itestagent-metadata-011-attempt-6ukcgrgr/final-cleanup.json`。自动cleanup仍为unverified，用户授权恢复单独记为verified。0.1.2完整候选文件哈希复核一致。已提出0.1.1备份→0.1.2升级、一次无工程authorize验证及失败时两者各一次普通Quit的合并具体授权；遇保存/停止提示暂停，不强退，不重试，不操作设备。等待该新授权。

## 2026-09-17 元数据0.1.1查询超时与0.1.2候选（最新）

用户已确认0.1.1备份升级及一次验证，安装与签名核验通过；旧0.1.0备份在`~/.itestagent/helpers/xcode-metadata-probe-backup-90dbc9f2-6c1a-4701-ba2c-fac8480c0741/`。唯一尝试位于`/private/tmp/itestagent-metadata-011-attempt-6ukcgrgr/`，额度已消费。首条documentPaths查询在send阶段返回OSStatus -1712（公开errAETimeout），没有进入解析；emptyDocumentsObserved=false，cleanup_unverified。未打开工程、创建debugger/AUT或操作设备。不能将ordinal编码修复当成本机通道已通过。

最新独立ps仍发现本次探针PID91992、Xcode PID92001。CUA只读此前显示Welcome窗口，但这不证明完整文档清单为空。已提出两者各一次普通Quit恢复请求，等待回复；遇保存/停止提示暂停，不强退。未执行该恢复，不复用0.1.0已消费的恢复授权。

排查假设按证据排序：启动完成前发送、首条0.5秒预算不足、事件处理仍不可用。现有证据仅确定超时，尚不能确认唯一根因。0.1.2增加同一owner的isFinishedLaunching门禁（不作为AE就绪或目标证明），在60秒总体期限内等待；普通adapter也拒绝未完成启动的owner。单条查询上限2秒、首次两次快照总预算8秒、退出前复查4秒，均受原owner期限约束；没有查询重试。白名单诊断新增finishedLaunching和0–10000ms有界elapsedMs，保持首错冻结。

0.1.2候选`/private/tmp/itestagent-metadata-012-xmx_t2bg`，完整candidate-review.json与source-review.json已保存，Mach-O SHA-256 `90e68ce8b29536e9434cbebb9ed43f717854b23e312e9fd26b7eefa8fbd4ff41`。Swift warnings-as-errors、临时ad-hoc签名、strict核验通过；未安装、未运行，不改变已安装0.1.1。本轮元数据离线测试29场景通过，无Apple Events发送；typecheck/lint通过。日志`/private/tmp/itestagent-metadata-readiness-test.log`、`itestagent-metadata-012-build.log`、`itestagent-metadata-012-typecheck.log`、`itestagent-metadata-012-lint.log`。此前性能包327 pass/9 skip不冒充本轮全包复跑。

下一步先完成已提出的旧实例正常退出恢复，再审阅0.1.2备份升级和一次实测范围；新实测需要新具体授权，宜同时明确失败时普通Quit恢复边界。T6.12保持in_progress，尚无新增生产G5，无commit/push。以下为历史记录。

## 0.1.0 实测与 0.1.1 修复候选（最新）

用户确认后，0.1.0 新目录安装与完整哈希/strict签名验证通过；旧17份helper文件未变。唯一运行的receipt位于`/private/tmp/itestagent-metadata-attempt-5tp37qu7/receipt.jsonl`，依次为permission_pending、metadata_unavailable_or_documents_open、cleanup_unverified。按authorize入口代码，进入metadata分支说明授权API返回noErr；没有据此推断查询成功。没有打开工程、debugger/AUT或设备动作。本次额度已消费，不能重跑。

CUA只读看到Xcode Welcome窗口；不能用它替代完整文档清单。用户随后明确授权两者各一次普通Quit：Xcode经菜单快捷键退出，无保存/停止提示；无窗口探针经活动监视器对精确PID79765选择Quit（非Force Quit）。独立ps确认Xcode与探针均无残留，`final-cleanup.json`记录恢复动作，不把人工授权恢复改写成自动cleanup通过。

离线根因核对确认一处编码缺陷：原all-elements的typeAbsoluteOrdinal直接使用ASCII大端字节`[97,108,108,32]`；本机公开AECreateDesc使用native OSType(kAEAll)生成`[32,108,108,97]`。新回归以公开AECreateDesc为独立基准先RED；改为公开API生成typed ordinal后GREEN。该缺陷已证实，但0.1.0未记录具体query错误，尚不能宣称它是本次真实失败的唯一根因。

新增诊断仅输出固定query/failure枚举、descriptor类型数值、有界itemCount及OSStatus；首错冻结，不输出路径、scheme、设备ID、NSError文本或reply内容。23种编码/解析及诊断冻结/边界检查通过。零结果门禁、两次快照、no-prompt、owner和退出前复查保持不变。

0.1.1候选：`/private/tmp/itestagent-metadata-011-6a_ruv7r`，完整`candidate-review.json`及`source-review.json`已保存；Swift warnings-as-errors、临时ad-hoc签名和strict验证通过。Mach-O SHA-256为`9c6f4367207b4b2356334b3fc7f3af165d3663d0dc0901a00f417225c6f1a7ae`。已安装0.1.0全清单未变；0.1.1未安装运行。

下一具体授权范围：保留完整0.1.0备份后在同一固定目录发布0.1.1；仅一次原无工程Xcode的authorize验证，必要时仅该App→Xcode的Automation授权；空文档清单和原实例确认后正常退出两者。失败仍保留并报告，不重试/强退，不打开工程或操作设备，不改变其他helper。等待此具体授权，不能沿用0.1.0的已消费额度。

本轮最终门禁：性能包327 pass/9 existing opt-in skip/0 fail，2406 assertions/55文件/119.65秒；typecheck、lint968、diff通过。日志`/private/tmp/itestagent-metadata-011-package.log`、`itestagent-metadata-011-typecheck.log`、`itestagent-metadata-011-lint.log`；公开ordinal对照为`itestagent-ordinal-check.json`，RED/GREEN为`itestagent-metadata-ordinal-{red,green}.log`。本轮未重跑全仓，不新增生产G5。

2026-09-17。ADR-048 的只读通道已获确认。普通实现继续按完整出口计划推进；以下是真实安装、授权和运行的具体审阅范围，尚未执行。

## 候选

- App：iTestAgentMemoryMetadataProbe 0.1.0，bundle `com.itestagent.memory-metadata-probe`。
- 临时目录：`/private/tmp/itestagent-metadata-candidate-kmlo8cew`，完整清单 `candidate-review.json`，源码清单 `source-review.json`。
- Mach-O SHA-256：`c4d4a011a2eae8294422994ce39b0dc8af11c9e79dbf42fa77b93063f48f7dd2`。
- Swift warnings-as-errors 构建、临时 ad-hoc 签名及 codesign strict 验证通过。没有使用 Keychain 签名身份。
- 拟新装位置：`~/.itestagent/helpers/xcode-metadata-probe/iTestAgentMemoryMetadataProbe.app`；目标存在即阻断，不替换现有 helper/probe。

## 单次动作

1. 新目录安装候选，逐文件哈希、签名及原 helper 未变化检查。
2. 在没有任何 Xcode 实例的前提下启动候选一次，模式 `--authorize`，输出仅到新的私有临时 receipt。候选经 NSWorkspace 启动自己的 Xcode，不打开工程，不创建 debugger/AUT，不构建或操作 iPhone。
3. 仅为该 App 请求“控制 Xcode”的 macOS Automation 权限；系统提示可能需要用户点击允许。代码只发送固定公开 get-data 元数据事件，不执行脚本、Run/Stop/关闭/设置命令。Accessibility 与键盘事件均不使用。
4. 查询两次文档/workspace清单；预期均为空。不输出任何路径、scheme 或设备标识。只有实际空清单、原实例仍可观察，且退出前再次查询仍为空，才发一次原 Xcode 正常退出请求并等待 isTerminated；之后探针正常退出。无 forceTerminate。
5. 独立检查原实例和探针退出、receipt白名单及清单未变。单次额度消耗后不自动重跑。

## 失败边界

如果 Xcode 恢复了文档、权限拒绝、查询格式未知、原实例发生变化或退出不成功，探针记录 cleanup_unverified 并保留，不强退、不关闭可能属于用户的文档；可能需要用户处理遗留 Xcode/探针。首次权限等待上限60秒，资源清理最多5秒。正常查询不自动弹窗；只有本次明确的 authorize 模式可在后台请求授权。

本次只验证真实公开元数据来源、无目标 Xcode 生命周期和独立探针退出，不能算生产 capture、物理身份绑定或 G5通过。确认不会授权后续设备安装、调试或工作负载。
