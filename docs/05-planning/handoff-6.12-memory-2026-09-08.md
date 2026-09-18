# T6.12 内存性能能力交接 — 2026-09-08

> 最新完成状态：PR #82已合并，用户明确单次豁免失败CI（ADR-052）。T6.12已按ADR-050/051范围标done，T6.13为ready；远端CI仍失败，DEF-042保持open，须在Phase6出口前修复。历史“等待合并/确认、in_progress”等记录由本条覆盖，产品级未完成义务不变。本次追踪修改尚未提交推送。

## 最终门禁检查点（2026-09-17）

2026-09-17 final approved-scope gates: full host suite 4244 pass / 16 skip / 0 fail, 14058 assertions, 414 files, 214.05s. Fixed repeated old permission redraw matching in the rounds PTY test by waiting for each unique round resource; production permissions unchanged. Typecheck/lint968/schema6/architecture19/G7-7/literals80/gitleaks140/diff checks passed. Original sandbox 4216 pass/38 skip/6 fail preserved. See t6.12-final-gates-2026-09-17.md. Code delivery and final human completion confirmation remain; no commit/push/merge.

> 2026-09-17 已接受 ADR-051：T6.12 按已验证双路径/failed-only/内存能力收口；冷启动及其余性能生产证据、Simulator baseline/多轮、XCUITest 新增性能和有效归因补强归 T7.9–T7.12（DEF-038–041）。原产品 AC 不删除，产品级性能与归因发布门禁保持未通过；T6.13/M6-PHY 完成不能宣称全量 MVP 发布。见 `docs/decisions/ADR-051-t612-verified-exit-and-product-gates.md`。

## 最新检查点：2026-09-17 新批次已完成

签名名额释放后，用户明确授权的新批次已完成。正常 TUI 父运行 `run_01a0b272-454d-7000-ac38-8155c35656e2` 一条指定失败、一条控制通过；CLI failed-only 子运行 `run_01a0b274-6a95-7000-900e-ec7f8f8e9224` 仅执行指定失败用例。两份 canonical/真实 xcresult、血缘、父 result 哈希及进程清理均通过。CLI explain 成功消费真实证据但归因为 inconclusive/low，不能宣称有效根因归类。详见 `g5-xcuitest-lineage-6.12.md`（docs/06-verification）。以下“等待授权/尚无当前 XCUITest”等段落为历史检查点，已由本节覆盖。性能剩余范围及最终交付门禁仍待完成；T6.12 保持 in_progress。

## 2026-09-17 signing slot recovered; next batch not started

The user explicitly requested removal of `com.logansu.echo.wp2bench`. One uninstall succeeded on the same physical iPhone as the prior parent. The post-action inventory confirms that only this bundle was removed; WDA and T612ExitFixtureUITests.xctrunner remain present, with no other inventory changes. Aggregate evidence: `/private/tmp/itestagent-t612-xcuitest-batch/signing-slot-recovery.json`.

After the user requested continuation, a new one-shot PTY driver was prepared with the reviewed fixture manifest, same-device guard and bounded deadline. Automatic approval review rejected its launch because it required explicit authorization for the new build/install/test batch after the previous allowance was consumed. The driver did not start; no new build, installation or test occurred. A concrete new-batch authorization question is pending. T6.12 remains in_progress.

## 2026-09-17 authorized parent attempt: signing capacity blocked

The authorized batch entered the normal OpenTUI CLI, reviewed the source-backed Fixture candidate, selected the sole ready physical iPhone, explicitly resolved XCUITest/T612ExitFixture/T612ExitFixtureUITests, set metrics=[] and baseline=skip, and allowed execute_project_build and replace_device_app once. The initial planning-only launch found no feature candidate; it exited normally before any build/install/test. Naming the existing UIViewController exposed its existing source-backed feature without changing UI, bundle IDs or tests; the reviewed manifest was refreshed before execution.

Actual parent: `run_01a0b265-37b1-7000-9310-bb9d956d948e`, physical/xcuitest, failed, 28.523s, two failed cases and a real xcresult. Apple's public test-results summary reports both cases failed while launching AUT because the free-development installed-app limit was reached. The new test Runner installed; AUT launch did not reach either planned assertion. No failed-only child was started, and no automatic test retry or app removal occurred. This is blocked acceptance, not the intentional-failure scenario passing.

Normal CLI explain completed with an inconclusive/low-confidence result from the canonical evidence; it did not independently diagnose the app-limit cause, which was obtained through read-only public xcresulttool metadata. The existing canonical loader verified the bundle. Original result.json was not rewritten. CLI exited normally; independent host and devicectl checks found zero owned CLI/xcodebuild/fixture/Runner processes. Installation is retained as authorized. Evidence: `/private/tmp/itestagent-t612-xcuitest-batch/{cleanup.json,read-only-verification.json,explain.json}`.

A separate deterministic parser defect was confirmed: JUnit uses bare `ExitTests`, while Apple nodeIdentifierURL provides `T612ExitFixtureUITests/ExitTests/method`. The normalizer previously matched only target or target.class, dropping the authoritative prefix. It now accepts an exact bare-class/method match only when exactly one authoritative ID owns it; ambiguous targets and unrelated classes still fail closed. Regression first RED (19 pass/1 fail), then GREEN plus production closed-loop integration (23 pass/104 assertions). Typecheck/lint968/diff pass. Read-only reparse of this same real xcresult yields both complete IDs; the historical failed report remains unchanged and is not a valid parent for the next acceptance run. No new G5 success is claimed.

Next: user must choose an app to remove (or manually free one signing slot); do not uninstall unrelated apps without explicit authorization. A fresh normal-TUI parent and one failed-only child require a new concrete batch grant. The consumed parent attempt is not retried under its old grant. Keep T6.12 in_progress, T7.8 deferred; do not resume metadata probes.

## Current checkpoint: 2026-09-17

ADR-050 is accepted: physical completed-zero/memgraph work now belongs to pending T7.8 and open DEF-037 (Phase 7), with T7.7 depending on T7.8. T6.12 remains in_progress and T6.13 pending. Do not resume metadata probes.

The next production XCUITest batch is prepared at /private/tmp/itestagent-t612-xcuitest-un6ad8qq; its file manifest is /private/tmp/itestagent-t612-xcuitest-review.json. A unique valid local Apple Development certificate supplied the Team configuration to this temporary project only. No private key/password or user account identifier was read or saved. A read-only discovery found one ready iPhone. These findings supersede the earlier missing-Team checkpoint. No build, installation or test run occurred.

Pending authorization: one normal-TUI parent suite, CLI explain, and one CLI failed-only child; necessary builds/signing with the existing local Team and installation/replacement of only this fixture and its test Runner. One expected failing test and one passing control provide real parent evidence; only the failed test may run in the child, which is expected to fail again. Total budget 25 minutes, 10 minutes per test run; no automatic retries. Stop on signing quota, target changes, unexpected permissions or infrastructure failures; do not remove other apps, create certificates or change security settings. Clean up only owned processes; retain installation and local reports. Old metadata permissions do not authorize this batch.

Validation: task IDs, document paths, acyclic dependencies and preserved states passed; lint 968 files and diff checks passed. Production closed-loop integration: 3 pass, 0 fail, 39 assertions (external transports replaced; not G5). Current default store contains 23 DeviceBackend results and no XCUITest result. No commit/push.

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


## 2026-09-17 公开语义复核（最新）

已核实公开document.file允许无磁盘位置，普通Quit可取消/延迟；这些均不能证明0.1.8未知文档归属或cleanup。未启动App、未安装/重跑。已在metadata-probe-plan顶部写入三项假设及整批诊断补充方案：新增固定只读file形状、将只读目标诊断与严格退出门禁分离；待确认ADR-048字段范围及额外未修改文档下继续只读的边界后实施。原退出/lease门禁保持，0.1.8额度已消费，T6.12仍in_progress。

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

## 2026-09-17 元数据0.1.0实测失败、公开AE编码修复（最新）

用户确认后0.1.0已安装，唯一无工程Xcode尝试进入metadata_unavailable_or_documents_open，cleanup_unverified，额度已消费。未打开工程/创建debugger或AUT/操作设备。用户另明确授权两者普通Quit：Xcode退出；探针经Activity Monitor对精确PID选择Quit，未Force Quit。独立ps确认两者无残留，旧17份helper文件未变。结果与恢复分别留在`/private/tmp/itestagent-metadata-attempt-5tp37qu7/`，不能将恢复算自动关闭通过。

离线公开AECreateDesc对照发现确定的typeAbsoluteOrdinal字节序错误；原手写ASCII `[97,108,108,32]` 与本机公开API `[32,108,108,97]` 不同。回归改用公开API基准先RED后GREEN，生产编码改为AECreateDesc。首轮实际错误未分阶段，因此还不能确认唯一live根因。补充首错冻结的固定stage/failure/descriptorType/itemCount/OSStatus诊断，无原始元数据输出。

0.1.1候选在`/private/tmp/itestagent-metadata-011-6a_ruv7r`编译/临时签名/strict核验通过，未安装运行；已安装0.1.0完整清单未变。具体备份升级+一次同范围验证请求已发出，尚待回复，见metadata-probe-plan最新段。普通实现总计划与ADR-048已确认，不重复申请；本次真实额度不能复用。T6.12仍in_progress，生产provider/capture/TUI/G5及原双路径出口未完成，无commit/push。

## 2026-09-17 整体计划获批、只读元数据候选完成（最新）

用户已确认完整出口计划，并明确同意ADR-048只读Apple Events元数据补充；不要再次申请普通实现计划确认。新真实安装/系统授权/运行尚待当前具体请求答复，不能把技术决策当成已授权真实动作。

已修复helper在IPC失败后只检查一次关闭的缺陷（延迟关闭RED→GREEN），清理最多5秒、取消与回调各一次、晚结果不恢复传输。owner新增有界只读canObserve，命令仍要求isCurrent。固定元数据get-data/no-prompt适配器与严格快照解析23种情形通过，真实适配器仅编译。新版no-target源码profile已审阅更新owner/session两个摘要，旧候选不用于新版实证。

验证：性能包327 pass/9 existing opt-in skip/0 fail、2406 assertions/55文件/122.97秒；Swift warnings-as-errors、无GUI owner政策、typecheck/lint968/diff通过。没有启动Xcode/设备或执行Apple Events。宿主只读进程枚举确认Xcode0；沙箱内枚举exit3未当作无实例。

独立0.1.0元数据App在`/private/tmp/itestagent-metadata-candidate-kmlo8cew`完成临时签名及完整清单核验，未安装/运行。候选具体范围见`../06-verification/physical-memgraph-metadata-probe-plan-6.12.md`：新目录安装、一次独占无工程Xcode、仅本探针Automation授权、空文档清单与正常退出；未知保留并报告。当前等待该具体授权，其后继续完整B/provider/capture/C/D/G5及原双路径出口，不重复已通过fixture或已消费动作。T6.12仍in_progress，无commit/push。

## 2026-09-17 完整出口整理（最新）

用户要求继续直到T6.12完成。剩余provider/物理身份/capture-export/生产接线/G5及原双路径责任汇总至`../06-verification/t6.12-completion-plan.md`；当前会话已请求一次整体实现计划确认，尚未收到答复，不把该请求记为授权。后续按这份完整清单推进，避免再次只汇报独立fixture完成。

只读确认PR82仍OPEN、base dev-1.0；默认runs下23份result均为DeviceBackend（2 Simulator/21 physical），未找到XCUITest结果，此为元数据盘点而非canonical完整性复验。依赖级联无需变更，deferred无open。此次未改生产代码、安装或执行设备工作负载；具体门禁结果见完整出口计划。T6.12仍in_progress、T6.13 pending。

## 2026-09-17 文档会话连续性离线实现通过（最新）

用户确认后完成独立MemoryDocumentSession、公开AX/AppKit只读适配器和主run-loop销毁观察器。整轮保留目录inode/原窗口/原owner；区分observed_open、window_unavailable、owner_exited、unknown。目录/owner/窗口替换及错误/超时/取消失败关闭，窗口消失后不自动重绑；销毁后不再读取无效AX元素。没有cleanup proof或关窗/退出权限，原owner退出不代表debugger/AUT退出。

无GUI fixture 21种情形通过，性能包默认325 pass/9 opt-in skip/0 fail（2381 assertions、53文件）；Swift warnings-as-errors、typecheck/lint966/diff通过。旧v4清单与源码profile只读复核一致。详情/限制/日志见`../06-verification/physical-memgraph-document-session-plan-6.12.md`。实际AX适配器仅编译，真实Xcode窗口销毁和NSDocument独立关闭仍未验证。

没有运行App/LLDB/Xcode/设备，没有安装/签名/权限变更或commit/push。下一步明确完整Xcode provider的实际文档关闭来源及安全退出前置，再接通有状态控制链；physical identity、capture/export及生产G5仍缺。T6.12 in_progress、T6.13 pending。

## 2026-09-17 文档会话来源核查完成（最新，计划待确认）

只读检查现有目录binding、AX上下文、本机公开AX SDK和Xcode.sdef：当前目录绑定仅存在于一次定位内；AX元素销毁/窗口消失不等于NSDocument关闭，Xcode公开open还存在不返回文档对象的已记载限制。未执行Apple Events或读取真实Xcode状态。

新计划`../06-verification/physical-memgraph-document-session-plan-6.12.md`拟保留整轮目录inode/原窗口/原Xcode owner，区分observed_open、window_unavailable、owner_exited、unknown；绝不将窗口消失升级为cleanup proof，不主动关窗/退出，不放宽debugger/AUT要求。待确认整批离线实现与测试；当前无代码改动或真实运行，旧签名v4与已消费App/LLDB额度不变。T6.12 in_progress、T6.13 pending。

## 2026-09-17 原调试进程保留观察实现与宿主实测通过（最新）

用户确认整批计划后新增独立Python OwnedObservation与TS严格会话解析。每个owner session一次登记，保留原debugger/target/process对象，不按PID重新发现，不重新选择target；最长120秒、最多128请求，失效/过期/错绑定失败关闭，release只释放引用。输出仍targetVerified=false、leaseRetained=true；旧脚本及已签名v4固定清单未变且复核通过。

定向14 pass/31 assertions。一次CLI LLDB实测1 pass：两个自有宿主进程均正常Resume至自动退出，切换selected target后可继续观察原进程退出，第二实例启动不会改绑；释放登记不影响第二进程，独立ps无残留。真实额度已消费，无重试/force/Detach/Kill/DeleteTarget。性能包默认324 pass/9 opt-in skip/0 fail（2377 assertions、52文件）；typecheck/lint965/diff通过。完整证据见`../06-verification/physical-memgraph-owned-observation-plan-6.12.md`。

未运行Xcode App/iPhone/Simulator、未改安装或系统权限、未commit/push。下一优先项为document完整会话归属及关闭观察，再组合Xcode resource provider；真实设备归属/generation和生产TUI G5仍缺。此宿主观察不能作为physical identity或lease proof，T6.12 in_progress、T6.13 pending。

## 2026-09-17 原调试进程观察来源核查完成（最新，计划待确认）

继续只读核查真实资源来源：v4只证明无目标正常关闭；Xcode owner已有公开原实例句柄，document仅单次目录/AX绑定，LLDB query_exit依赖当前selected target，尚无保留原SBProcess的退出观察；physical设备归属与generation仍未确证。本机公开LLDB Python绑定确认GetUniqueID用于process instance比较，未提供hostname等同设备UDID的保证。

下一整批计划见`../06-verification/physical-memgraph-owned-observation-plan-6.12.md`：独立保留原debugger/target/process的只读观察模块、严格解析与负例，以及一次无设备CLI LLDB/最多两个自有临时宿主进程的正常退出验证。保持旧脚本/v4清单不变，不将观察值升级为physical identity或lease proof。本次没有编码、执行App/LLDB/设备或重用已消费额度；T6.12 in_progress、T6.13 pending，无open延期项，无commit/push。

## 2026-09-17 v4真实App回执与临时lease自动释放通过（最新）

用户确认后执行固定候选normal-once一次，manifest仍为`0a1e6162af3e87f666d14ad741732e53128929a26d4afbc38bb816073fc55ee6`。真实NSWorkspace helper/launcher退出、回执完整核验及本轮临时lease自动释放通过：unsupported、leaseRetained=false、targetVerified=false、grantAttempted=false；launcher/helper closed，下游四项not_created。脚本及独立只读ps均无query残留，三份既有安装哈希未变。结果证据与范围见`../06-verification/physical-memgraph-query-v4-app-plan-6.12.md`末尾。

本次单次运行额度已消费，无重试/force/安装/权限变更/Xcode/设备/AX/Return/commit/push。未手动清锁，没有代码修改或重跑离线回归。本结果只证明无目标正常关闭，不能替代取消释放、真实Xcode/document/debugger/AUT关闭来源、physical generation或生产TUI真机验收。后续继续这些资源观察来源与接线；T6.12仍in_progress、T6.13 pending。

## 2026-09-17 v4签名候选就绪，单次真实App验证待确认（最新）

用户继续后，已在新临时目录构建v4无provider候选并做ad-hoc签名，27项清单/固定源摘要/真实codesign resolver核验通过，未启动App。候选根`/private/tmp/itestagent-v4-app-candidate-GH66df/candidate`，manifest SHA256 `0a1e6162af3e87f666d14ad741732e53128929a26d4afbc38bb816073fc55ee6`。三份既有安装二进制哈希不变，无生产源码修改。运行脚本已准备并仅转译检查，结果文件wx防重试。

新方案`../06-verification/physical-memgraph-query-v4-app-plan-6.12.md`请求一次normal：真实NSWorkspace helper握手/原实例退出/launcher回执，核验后释放本轮临时目录中的隔离lease，独立检查无残留。协议5秒、原生期限150秒，失败保留锁，不force/重试；零Xcode/设备/AX/Return/安装/系统授权变更/commit/push。新额度尚未消费，旧v3额度不复用。T6.12 in_progress、T6.13 pending，无open延期项。

## 2026-09-17 v4退出回执与无目标lease释放离线通过（最新）

用户确认ADR-047整批计划后完成独立v4入口、固定无provider源码profile/签名清单门禁、resolver一次性能力、launcher专属原实例退出回执，以及TS完整channel/EOF/真实退出核验与ledger proof消费。正常无目标关闭可释放本轮lease；取消/错误/未知、已有物理identity或下游创建历史仍保留。v3独立保留，旧签名候选与安装未修改；新版App适配器仅编译，实际通信由自有无GUI child/socket与fake launch owner验证。

性能包+engine桥317 pass/8 existing opt-in skip/0 fail（2377 assertions、51文件）；TUI相关75 pass/0 fail（299 assertions、2文件）；Swift warnings-as-errors、typecheck/lint962/diff通过。完整覆盖与日志见`../06-verification/physical-memgraph-query-closure-receipt-plan-6.12.md`。没有真实App/设备/Xcode/AX/Return/权限修改/commit/push。下一步准备可审阅的新v4签名候选与限定真实App验证，不能复用已消费v3额度。真实Xcode/document/debugger/AUT关闭来源、physical generation及生产TUI真机验收仍缺；T6.12 in_progress、T6.13 pending。

## 2026-09-17 launcher所属退出回执方案待确认（最新）

继续只读核查确认：v3 closed来自helper，现协议不能向TS提供launcher对原helper退出的证明；coordinator仍正确保留unknown/lease。新增ADR-047与query-closure-receipt-plan：提议显式v4 launcher专属回执，首先只允许受固定候选入口验证的no_target_resources正常关闭，经本轮channel/manifest/实例/EOF及实际launcher退出核验后产生内部一次性证明；取消、未知与所有已尝试创建目标的会话仍保留锁。此为新协议/证明决策，待计划确认后实施。

本轮仅Explore/Plan，没有新实现、测试或App运行；上次normal/EOF额度已消费，未重用。T6.12 in_progress、T6.13 pending，无open延期项，无commit/push。真实Xcode及physical generation缺口不因此解决。

## 2026-09-17 独立query App限定生命周期实证通过（最新）

用户“授权”后执行同一签名候选的normal一次及prelaunch-eof一次。normal真实NSWorkspace启动/握手/无provider关闭通过：query_closed、launcherExited=true、permissionRequests=0、grantAttempted=false、无query结果；独立ps确认无query进程残留后才执行EOF项。EOF未发送hello，launcher正常报告exit2且stderr为空，最终无残留、三份既有安装哈希不变。两项额度均已消费，无重试/外部终止/force/安装/系统授权变更/Xcode/设备/AX/Return/capture lease操作或commit/push。

详细证据见`../06-verification/physical-memgraph-query-app-lifecycle-plan-6.12.md`末尾。此次仅独立App生命周期实证，不是Xcode查询或G5；EOF阶段未观测瞬时helper创建次数，不宣称真实App运行中取消已验证。下一缺口是launcher到TS的资源证明、真实Xcode/document/debugger/AUT关闭观察与physical generation。T6.12仍in_progress、T6.13 pending。

## 2026-09-17 独立query App签名候选准备完成（最新）

继续准备生命周期验证时，修复launcher在helper已退出但bridge完成回调未到达时提前exit2的时序缺陷；32组合/顺序回归、2项原生定向81 assertions、warnings-as-errors/typecheck/lint959/diff通过。临时新候选已构建ad-hoc签名，26项固定清单及真实签名resolver核验通过，未安装或运行App；既有安装不变。候选根`/private/tmp/itestagent-query-app-candidate-VFrzHd/candidate`，manifest SHA256 `ce4d25b1cd854e4f0eaf304d73e44fa70cd371bbe7ddef24356426bd0d82be84`。

具体运行方案见`../06-verification/physical-memgraph-query-app-lifecycle-plan-6.12.md`：一次normal握手/无provider unsupported/原实例退出，通过后一次prelaunch EOF。零Xcode/设备/AX/Return/权限变更，结果脚本仅转译未执行，两项额度均未消费，待确认。无commit/push，T6.12仍in_progress。

## 2026-09-17 查询完整离线组合与候选构建通过（最新）

用户确认composition计划后已完成：IPC prepared阶段唯一权限请求、共享严格解析、engine/TUI同callId结束及pending清理、独立候选清单/签名就绪门禁、launch前唯一父控制reader、helper会话及原生入口。无真实resource provider时明确unsupported；真实helper/Xcode/document/debugger/AUT退出证明未贯通，不凭closed帧释放lease。详细实现/逐资源证据缺口/下一真实验证范围见`../06-verification/physical-memgraph-query-composition-plan-6.12.md`。

候选`/private/tmp/itestagent-query-composition-QY43Gb/candidate`仅编译未签名安装/执行，25文件manifest SHA256 `26d1d7908151fd1bdbbfec8a8cbdeb7de6e242a5f090e123d6119a8b302f1553`，源快照与仓库一致。性能包+engine桥315 pass/8 existing opt-in skip/0 fail（2291 assertions/50文件）；TUI相关97 pass/0 fail（356 assertions/3文件）；Swift warnings-as-errors、typecheck/lint959/diff通过。未跑全仓库或G5，未改已安装二进制/权限、未commit/push。T6.12仍in_progress。

下一步先准备独立候选App的签名清单及明确运行范围：只验证launch/握手/无provider unsupported/父EOF/原实例退出，零Xcode/设备/Return；不得直接进行真实查询或沿用旧已消费动作额度。真实资源观察器与physical generation仍需后续证据。

## 2026-09-17 查询完整组合Explore完成（最新，待实现计划确认）

用户要求继续后已读代码定位：旧installer不覆盖新query多源清单，query-session与IPC直接组合会重复ask，权限桥缺TUI resolved收口，App启动到bridge之间需提前建立唯一父控制reader。下一整批离线实现计划见`../06-verification/physical-memgraph-query-composition-plan-6.12.md`，覆盖协调器/共享严格解析、权限UI生命周期、独立候选清单及入口、owner账本组合与真实无GUI测试。当前仅Explore/Plan，没有新实现或测试结果；沿用上一已验证证据。未运行App/设备、安装签名、改权限或commit/push；T6.12仍in_progress。须确认本次具体计划后进入Code，真实资源来源缺失仍unsupported/unknown。

## 2026-09-17 ADR-046离线IPC、权限桥和关闭账本通过（最新）

用户已确认ADR-046离线批次。独立stdio/Unix socket、UID/PID与目录/endpoint身份、严格有界帧和一次grant、原生query接线、真实PermissionEngine ask/abort及v3逐资源关闭证明完成。新App适配器仅编译，真实通信由无GUI自有Process/fake owner验证；旧launcher、已安装App及权限未改。性能包+engine桥307 pass/8 existing opt-in skip/0 fail（2200 assertions/48文件）；最后Swift改动2 pass/57 assertions复检通过，typecheck/lint953/diff通过。完整结果和日志见physical-memgraph-query-ipc-plan-6.12.md末尾。

T6.12仍in_progress、T6.13 pending；无commit/push。下一步为真实helper完整入口/TUI接线、manifest及Xcode/document/debugger/AUT闭合观测来源准备方案；physical generation与G5仍缺，不能把fake查询/闭合当实证。本批仅离线授权，不启动或升级真实App、设备；此前Return动作额度已消费。

## 2026-09-17 查询IPC与逐资源关闭证明提案待确认

2026-09-17：核对生产IPC/关闭接口后新增ADR-046提案及query-ipc-plan，尚未编码。旧只读launcher的force路径不复用于有状态查询；提议独立stdio/私有Unix socket+peer UID/PID/自有launch绑定和内存单次授权。提议内部v3逐资源关闭账本，严格区分not_created与pending/unknown；有identity维持原强校验，无identity但AUT/debugger已尝试创建则保留lease。下一批仅离线协议/真实无GUI通信/真实PermissionEngine桥及账本负例待确认，不升级App/权限/设备或提交推送。

## 2026-09-17 固定查询内部接线与无GUI取消传播通过

2026-09-17：按用户确认完成query-session离线接线。新增owner不透明句柄/期限、固定命令摘要与请求绑定的一次grant、真实Return exchange协调及TS严格候选解析；始终targetVerified=false且不释放capture lease。无GUI复现主队列取消延迟后改为后台锁保护latch，EOF/异常字节/SIGTERM/SIGINT/组合/预关闭/非pipe验证通过，onLoss仍main且一次；owner政策无GUI回归及Swift->TS实际结果解析通过。最终性能包280 pass/8 opt-in skip/0 fail、1680 assertions/44文件，typecheck/lint944/diff通过。已安装Return0.1.1完整清单未变，无App/设备/真实事件/权限变更/提交推送。生产PermissionEngine/TUI与helper IPC授权、完整资源收口和Xcode/真机仍待完成，T6.12保持in_progress。

下一步先明确生产helper跨进程授权握手及完整资源收口方案，再准备真实候选；当前只有内部注入边界，不能直接运行已安装0.1.1来声称新代码已实证。实施与范围见query-session-plan末尾。

## 2026-09-17 完整固定查询会话离线接线方案待确认

2026-09-17：完整查询接线Explore/Plan完成，新增physical-memgraph-query-session-plan-6.12.md待确认。明确三个离线单元：owner/session/命令摘要绑定的一次grant、复用真实exchange和TS严格候选解析、无GUI自有子进程EOF/SIGTERM/SIGINT的取消可见性验证。App-only不能释放完整capture lease、候选不等于physical ready；本轮仅文档，无代码/运行/升级/事件/设备/提交推送。

## 2026-09-17 两个固定取消检查点通过

2026-09-17：用户继续授权同一0.1.1两项固定取消检查。cancel-before请求2243db3f-30d3-4fe4-95bc-f93868ed6d34，接收0/0，controller18329/target18330自动退出；通过后执行cancel-after-down请求0ea5e48e-64d4-4372-982b-d418db9642c3，接收1/1，controller22168/target22169自动退出。均请求匹配、无repeat/unexpected，独立ps/进程清单证实无残留，无外部terminate/force/重试，两个额度已消费。此为测试发送器指定检查点取消，不代表生产exchange或真实SIGTERM/EOF/原实例消失已验证。无升级/权限变更/Xcode/设备/提交推送，T6.12仍in_progress。

下一步准备完整exchange/owner/一次性权限和父进程中断接线的离线实现方案；暂不继续真实事件或Xcode。证据与限制见return-fixture-plan末尾。

## 2026-09-17 Return控制端0.1.1传输及自动退出实证通过

2026-09-17：用户完成0.1.1单项授权重加；正常App preflight两权限true，新版完整清单/签名及无旧实例验证通过。唯一normal请求18e0a2c2-e082-414c-a3fe-451a9422afa2，接收down/up各1，无repeat/unexpected；controller阶段initialized/owner_closed/termination_requested/will_terminate，open等待正常结束。独立ps及进程清单确认controller61733/target61738均消失，无外部terminate或force。自动退出修复本次实证通过，本轮额度消费；targetVerified仍false，未进入Xcode/设备/完整query exchange，T6.12仍in_progress。无提交推送。

下一步在同一已安装版本验证cancel-before及cancel-after-down两个有界模式，具体范围见return-fixture-plan末尾，未执行。其后仍需生产exchange/owner权限接线和Xcode/真机验收。

## 2026-09-17 0.1.1旧授权已移除，当前Open提交待即时确认

2026-09-17：用户已移除旧controller授权，UI核实条目消失；重新定位安装App，面板确认0.1.1。点击Open被自动审批拒绝，要求该权限提交即时确认，未绕过；等待用户完成当前Open添加。未启动target或发送按键，已授权normal额度未消费。

## 2026-09-17 Return控制端0.1.1已安装，等待移除旧单项授权

2026-09-17：用户授权0.1.1备份升级及一次normal复验。新旧完整哈希/签名及无实例检查通过，0.1.0备份return-transport-fixture-backup-c03460c2-5bb7-4aa3-8238-1d721f5e7b9f，0.1.1安装后清单验证通过。正常App preflight两权限false、eventsAttempted=false；辅助功能旧controller条目仍on。AX与坐标点击均无法选中，Remove disabled，等待用户仅手动移除此controller旧条目再正常添加新版。未启动target或发送事件，本次normal额度未消费；原helper/probe未改，无提交推送。

## 2026-09-17 controller退出修复0.1.1候选已准备

2026-09-17：用户继续批准controller最小退出修复。Apple stop文档明确timer/observer调用不结束NSEvent循环，与owner timer内app.stop和真实驻留证据吻合；改为结果写入后app.terminate(nil)，添加固定退出阶段诊断。0.1.1仅临时构建签名，warnings-as-errors/签名、1项Return合成回归、typecheck/lint/diff通过；初次Swift主actor隔离编译错误已修正并重新成功编译。安装0.1.0完整清单未变，未运行候选/发事件，真实自动退出仍待授权复验。具体完整哈希/备份升级/一次normal复验范围见return-fixture-plan末尾，待确认。

## 2026-09-17 Return传输实证通过，controller自动退出缺陷待修复

2026-09-17：用户完成新controller辅助功能授权后，CLI preflight仍false，正常App启动preflight两权限true。唯一normal请求d1b1f25b-826a-4495-b2e1-ad67e4a759ae实际发送down/up各1，target收到1/1、无repeat/意外键，request匹配。target82579正常退出，但controller82573在app.stop之后仍驻留，自动整体收口失败。一次公开NSRunningApplication.terminate正常退出请求后两PID均消失，无force/重发。传输层实证通过但完整生命周期未通过；单次额度已消费，尚无Xcode/设备验证或提交推送。

下一步按return-fixture-plan末尾做最小收口修复及离线候选准备；真实升级复验另需具体授权。原0.1.3只读probe/0.2.0helper未改。

## 2026-09-17 Return候选已安装，辅助功能提交待即时确认

2026-09-17：用户确认安装/权限/首次normal范围。Return控制端0.1.0安装和完整清单/签名核验通过，preflight两权限均false、无事件。系统辅助功能Open面板已选中正确App；点击Open被自动审批拒绝，要求提交时再次确认安全敏感授权。未绕过，未启动target，首次事件额度未消费；旧helper/probe未改，无提交推送。

## 2026-09-17 Return自有App传输候选已准备，首次执行待确认

2026-09-17：按用户确认准备Return受控App候选0.1.0，独立controller/嵌套target编译及临时签名验证通过；未安装或执行任何候选。测试专用发送器不放宽生产Xcode门禁，仅验证传输层，不执行命令。具体哈希和首次normal最多一对Return/正常收口授权范围见physical-memgraph-return-fixture-plan-6.12.md。定向1 pass/1真实App opt-in skip，typecheck/lint通过；无新G5、无提交推送。

候选 `/private/tmp/itestagent-return-candidate/iTestAgentReturnController.app`，完整清单及源码快照同目录。首轮仅normal，取消模式已编译但不在首次范围；真实系统中断、生产exchange/owner授权接线及Xcode/真机均未完成。旧helper/probe和系统授权未动。


## 2026-09-17 显式固定Return离线实现完成

用户“确认”批准ADR-045第一阶段。已新增显式Return exchange/公开适配器与合成测试，复用原单次插入和输入/源码检查；原AXConfirm语义保持，无自动fallback。响应边界在写入前捕获，原目录身份贯穿exchange；取消/down/up/重复调用/输出及源码漂移测试通过。配对up最多一次且只针对可核验原实例，void投递不证明delivery或cleanup完成。

性能包255 pass/8 opt-in skip/0 fail、1574 assertions/41文件；Swift warnings-as-errors、typecheck、lint940文件及diff检查通过。未运行全仓库测试或新增G5/G5-SIM。

本轮没有实例化真实事件适配器、启动Xcode/App夹具/设备、安装重签或改权限、提交推送。0.1.3只读probe和0.2.0原helper保持原状。ADR-045仅推进为实验离线实现获准；生产owner/会话token/一次性授权接线、真实事件可靠性和焦点/PID竞态评估仍待完成。下一阶段先准备可审阅的自有App无设备验证候选和具体授权范围，再进行真实事件验证；不能直接在Xcode重试。T6.12保持in_progress，完整捕获/导出/生产接线/真机验收仍未完成。


## 2026-09-17 替代提交方案已准备，待批准离线实现

已核对US-12.3禁止每轮人工操作作为验收路径，以及公开CoreGraphics/SDK的postToPid、事件权限preflight、Return常量。新增ADR-045提案和physical-memgraph-native-return-plan-6.12.md，推荐显式实验性固定Return策略，仅向自有且反复核验的Xcode实例；不做全局键盘或AXConfirm失败后自动fallback。void投递不能判执行成功，仍需请求绑定响应；焦点/PID竞态残余风险明确保留。

本次仅申请代码/无副作用状态机测试/公开适配器编译，不安装App、不请求权限、不实际发送事件、不启动Xcode/任何App夹具或设备。代码尚未实施，0.1.3和系统权限不变。完整计划已可审阅，T6.12 in_progress，无提交推送。


## 2026-09-17 0.1.3 原生能力观察通过；AXConfirm 未公开

用户“继续”授权本次升级和单次只读复检。锁定0.1.3安装及旧0.1.2备份验证通过；用户仅移除旧probe AX条目后，正常按完整路径重加（面板版本0.1.3），preflight c6463684-f550-4de6-b920-146600de2fd5 返回 trusted，exit0/cleanupVerified=true。初次 unavailable 证据保留。

既有fixture哈希复核通过，初始Xcode未运行，只打开MemoryIdentityProbe/My Mac。一次Run Without Building/Pause、聚焦debug console后，原生观察6183a00a-bcb7-410b-a91c-2d611ca814b5返回status=observed/reason=read_only_capabilities，无axFailure。初始实例五项全部通过，工程目录绑定及最终文档/窗口/焦点复核通过。

实际布尔结果：selectedTextSettable=true、emptyPromptMatches=true、emptySelectionAtEnd=true、inputCountReadable=true、outputCountReadable=true、outputRangeReadable=true；confirmAdvertised=false。这验证了文档匹配修复在本次真实宿主可用，以及输入/输出只读能力；它没有执行AXSelectedText写入、任何命令/Return/AXConfirm，也不证明提交可靠性或物理目标身份。targetVerified仍false。

结论限定当前Xcode26.5/该宿主控制台：公开动作列表没有AXConfirm。现有MemoryConsoleSubmission要求显式AXConfirm，因此必须在插入前拒绝；不能因可写或此前CUA Return成功而放行。继续同一能力探针不会填补提交协议缺口。替代提交途径属于下一技术边界决策，不能静默改为AXPress、CGEvent、AppleScript或复用CUA作为独立生产实现。

一次Resume后Finished running、Stop disabled，关闭所属工程并Quit。独立ps确认Xcode69219/RPC69367/宿主69368均不存在，应用清单isRunning=false。launch=1/pause=1/resume=1/stop=0/queries=0/observations=1；本次额度消费。系统probe授权保持，不自动授予新版本或新输入方式。

下一步应先形成可审阅的替代提交方案与ADR边界：既有CUA短加载只可作为宿主参考证据；若评估独立原生受控键盘通道，须明确仅自有Xcode/既有fixture、固定请求、空输入/焦点/前后台及owner复查、一次性发送、不确定结果不重试、严格响应解析和清理，并单独确认实现/安装/真实动作范围。另一选择是保留unsupported或人工提交作为显式受限能力；这不能宣称独立自动化B完成。本轮未选择或实现任何新通道。

证据 `/private/tmp/itestagent-console-document-binding/` 下 installed-app-preflight.json、observation-result.json、owner.json、cleanup-result.json。本轮无生产代码变更或新构建/设备/提交推送，文档JSON/diff通过；上一254 pass/8 skip为历史代码门禁，没有新的G5/G5-SIM。T6.12保持in_progress，完整capture/export/生产接线/真机验收仍未完成。


## 2026-09-17 0.1.3 已授权安装，单项 AX 更新待用户操作

用户“继续”授权上一具体升级及单次只读复检方案。新旧完整清单/签名和无运行中probe检查通过；0.1.2备份至 `~/.itestagent/helpers/xcode-memory-console-probe-backup-d39c623f-76bb-4a2e-a256-dc3ae6f7d8f5/`，0.1.3安装至原固定路径，复制后验证通过。原0.2.0 helper及已有备份不变。

preflight请求98fc6931-10c1-45e9-ab2a-ba34e0e6c27c返回accessibility_unavailable，exit0/cleanupVerified=true。系统probe旧条目仍on，CUA点击无法选中、Remove disabled，已请求用户仅移除此条目，再正常添加新版；不重置TCC或更改其他权限。证据 `/private/tmp/itestagent-console-document-binding/installation-result.json`、installed-app-preflight.json。Xcode尚未启动，既有fixture哈希已复核；单次宿主额度未消费，同方案无需重新确认。T6.12 in_progress，无设备/提交推送，JSON/diff校验通过。


## 2026-09-17 文档 URL 等价修复通过离线回归

新增受限本地工程目录 binding，以完整 canonical path+保留目录描述符的设备/inode 匹配，接受尾斜线/本地别名，拒绝非法URL/缺失/文件/不同工程/目录替换。原生 context 单次解析与临时0.1.3探针已接入；不宣称跨解析身份连续或真实Xcode已通过。已安装0.1.2未动。

四项定向原生测试通过；性能包254 pass/8 opt-in skip/0 fail、1570 assertions/40文件，typecheck/lint939/diff通过。0.1.3候选编译签名完成，升级/单项AX授权/一次宿主只读复检方案及锁定哈希见console plan顶部，待确认。本轮无Xcode/设备/系统权限/提交推送，T6.12 in_progress。


## 2026-09-17 0.1.2 复检定位文档匹配失败，目录 URL 表示差异离线复现

用户确认安装及复检后，固定 0.1.2 哈希/签名及备份验证通过。用户手动移除旧单项 AX 条目，CUA 确认消失后按固定路径重新添加（面板版本0.1.2），原生 preflight 请求 29598018-a1fe-4f8c-806d-f4f70b5b3e2f 返回 trusted、exit0/cleanupVerified=true；初次 unavailable 证据保留。

现有 fixture 路径/产物哈希复核通过，应用清单初始 Xcode 未运行。仅打开既有 MemoryIdentityProbe/My Mac，一次 Run Without Building/Pause、聚焦输入后一次原生只读观察。请求 b47dc6d8-00ac-46ae-a988-0e29b9f28a8f：初始实例五项全部通过；axFailure={stage:document, operation:document, cause:mismatch, nodesVisited:0, depth:0, elapsedMilliseconds:61}，无 AX API 错误码。因此本次已成功读取可解析本地文档 URL，但它与期望 URL 的比较失败；尚未遍历控件/查询提交能力。没有命令、Return、AXConfirm 或重试。

一次 Resume 后 Finished running、Stop disabled；关闭所属工程并 Quit。独立 ps 确认 Xcode65971/RPC66107/宿主66108 均不存在，应用清单 isRunning=false。launch=1/pause=1/resume=1/stop=0/queries=0/observations=1；本次额度已消费。

最小离线复现使用同一已存在工程路径和 CUA 已展示的 file URL，不再次访问 Xcode：URL(fileURLWithPath:) 自动保留目录标记，而 URL(string:) 构造不带尾斜线的同一路径 URL；两者 resolvingSymlinksInPath().standardizedFileURL 比较 false，path 比较 true，hasDirectoryPath 分别 true/false。这确认候选中的直接 URL 相等算法可对同一工程发生误拒绝。未记录本次原生 AXDocument 原值，故不能将该复现直接定为此次 live 错误唯一根因。

按证据排序：①目录 URL 表示差异（已独立复现算法缺陷，CUA 已显示同一路径）；②AXDocument 指向不同工程/工作区或尚未稳定（本次没有保存其值，不能排除）；③读取前后文档漂移（实例门禁成功不证明文档始终不变）。只修表示等价问题，不容许任意不同工程通过。

下一具体离线实现计划：新增受限本地文档匹配单元，对合法本地 file URL 做目录/规范路径比较，消除仅目录尾标记差异；保留工程匹配与 owner/focus 门禁，拒绝远程 host、query/fragment、无效/不存在路径及不同文件。测试覆盖有无尾斜线、已知本地路径别名、百分号/空格编码、不同工程、同名前缀、缺失路径/非本地URL。接入候选，回归后生成新的可审阅包；不直接放宽为窗口标题或 basename 比较，不自动覆盖已授权0.1.2或重复宿主运行。生产 context 的匹配策略如需统一，须同样测试并同步说明，不宣称仅候选修复已经完成生产接线。

证据目录 `/private/tmp/itestagent-console-ax-diagnostic/`：installed-app-preflight.json、observation-result.json、owner.json、cleanup-result.json；离线复现源码 `/private/tmp/itestagent-document-url-check.swift`，布尔结果收录 cleanup-result.json 的 urlReproduction。没有本轮生产代码变更，全库/G5/G5-SIM未重跑；文档 JSON/diff 通过。T6.12 保持 in_progress，无设备/提交推送。


## 2026-09-17 0.1.2 已确认安装，等待单项 AX 授权更新

用户确认后完成新旧完整包清单/签名验证，并以独立 ps 确认 probe 未运行。旧 0.1.1 备份至 `~/.itestagent/helpers/xcode-memory-console-probe-backup-161848b9-e1e2-4a56-828e-fa00706dfa89/`，锁定的 0.1.2 安装到原固定 probe 路径，复制后新旧包哈希和严格签名均通过。原 0.2.0 helper 不变。证据 `/private/tmp/itestagent-console-ax-diagnostic/installation-result.json`。

新版第一次 preflight 请求 73d35888-10bc-49bc-b532-2e44ae707342 返回 accessibility_unavailable，exit0/cleanupVerified=true。系统设置仍显示旧 probe 开关 on；已有上一轮证据表明需要正常单项移除后重新添加，不能只凭开关判断新版 trust。CUA 对已聚焦列表使用 Home 和点击 probe 行后仍未选中，Remove disabled；已请求用户仅移除该 probe 条目，再继续添加固定新版。没有重置 TCC、操作其他 App 权限或启动 Xcode。一次宿主观察额度未消费，同一升级/复检范围无需重新确认。

本轮至此没有生产代码/设备/提交推送；T6.12 in_progress。旧 253 pass/8 skip 为上一实现单元证据，未重跑。文档 JSON/diff 校验通过。


## 2026-09-17 AX 全阶段固定诊断单元完成

新增阶段/操作/原因枚举诊断，保留首错，错误码及预算/耗时有界，无原始文本。289 组合合成测试通过；临时只读 0.1.2 候选已编译/签名，未安装或执行，已安装 0.1.1 哈希不变。原失败的具体 AX 阶段仍待实证。候选哈希与新备份安装、单项 AX 授权及一次宿主复检范围见 console plan 顶部，待确认。

性能包 253 pass/8 opt-in skip/0 fail（1566 assertions/39文件），typecheck/lint938/diff通过；未跑全库/G5。本轮无 Xcode/设备/权限/提交推送，T6.12 in_progress。


## 2026-09-17 0.1.1 宿主复检完成：实例通过，AX 读取阶段阻断

用户手动移除旧 probe 权限条目后，CUA 确认该行消失；正常 Add/Go To 选择固定路径，Open 面板显示版本 0.1.1，添加后原生 preflight 返回 read_only_probe_trusted（a3998c32-53df-4f1b-b660-76735110fa39），exit0、cleanupVerified=true。之前三次 unavailable 如实保留。单项移除再添加解除本次新版权限阻断；不据此宣称已确认 TCC 内部根因，没有重置 TCC 或改其他 App 权限。

再次核对 fixture 哈希并确认 Xcode 未运行，只打开既有 MemoryIdentityProbe/My Mac，一次 Run Without Building/Pause，聚焦 debug console 后执行一次新版只读观察。请求 f77e6ee3-726d-4ffc-894b-a22d89f488b5：initialObservation.reason=observation_eligible；instanceCount=1、pidMatches=true、bundleMatches=true、active=true、terminated=false。最终 blocked/bounded_observation_failed、capabilities={}、targetVerified=false，探针 exit0、cleanupVerified=true。

本次初始实例门禁通过，不代表已解释此前 observation_conflict。后续统一 catch 仍未区分具体 AX API/阶段失败，无法断言窗口属性、节点预算、公开动作或范围读取哪项导致失败，更不能说 AXConfirm 不支持。无命令写入、Return、AXConfirm 或重试。

一次 Resume 后 Finished running，关闭所属工程并 Quit。Quit 后 CUA 返回 procNotFound；独立 ps 确认 Xcode 62145、直属 LLDB RPC 62295、宿主 62296 均不存在，最终应用清单 isRunning=false；不依赖单独 CUA 错误作为清理证明。launch=1、pause=1、resume=1、stop=0、queries=0、observations=1；此次复检额度已消费。

本地证据 `/private/tmp/itestagent-console-observation-diagnostic/`：installed-app-preflight.json、observation-result.json、owner.json、cleanup-result.json。安装版现在为已授权 0.1.1，原 0.1.0 备份仍保留。下一离线单元应一次补齐有界观察各阶段的固定错误类型、AXError 数字白名单、预算/时限及终止阶段（不记录属性值、控制台/窗口文本），用合成异常覆盖并验证原失败关闭条件；避免逐次 live 试验才发现下一个未区分错误。尚不授权新版本升级、再次宿主复检或设备操作。

本轮未改生产代码或重新构建；文档 JSON/diff 检查通过，上一 252 pass/8 skip 仍为历史代码门禁，没有新的 G5/G5-SIM。T6.12 保持 in_progress，未提交推送。


## 2026-09-17 0.1.1 已确认升级，AX 重新授权仍受阻

用户确认后核对新候选全部源码/包清单及旧安装包完整清单，严格签名通过；独立 ps 确认无运行中探针。旧 0.1.0 移至 `~/.itestagent/helpers/xcode-memory-console-probe-backup-8d0cbd6a-2be6-4d86-b4d2-189e6f58ebf9/`，0.1.1 安装至原固定 probe 路径，复制后新旧包哈希/签名再次通过。原 0.2.0 helper 未改。安装记录 `/private/tmp/itestagent-console-observation-diagnostic/installation-result.json`。

升级后 AX preflight 返回 accessibility_unavailable。正常系统设置显示 probe 开关 on，但重新添加完整固定路径（Open 面板明确显示版本 0.1.1）后仍不可用；仅切换该 probe off/on 后再次检查也相同。三次 preflight 均 exit0、cleanupVerified=true；没有绕过权限、重置 TCC、读取 Xcode 或执行命令。原生 trust 优先于设置开关显示；旧记录/签名匹配问题只是候选解释，未读 TCC 数据库，根因不确诊。

计划内的正常单项授权更新尚未完成。CUA 用行索引、可见坐标及窗口 Raise 后均无法选中 probe 行，Remove 一直 disabled；已请求用户手动仅移除 iTestAgentMemoryConsoleProbe 条目，随后可继续添加固定新版路径并 preflight，不重复申请同一方案授权。没有删除 App 或备份，没有更改其他 App 权限。

证据目录 `/private/tmp/itestagent-console-observation-diagnostic/`：preflight-before-reauthorization.json（64bc3a00-f512-41c7-93ec-dd1fa56abcbc）、preflight-after-readd.json（09df721b-54f4-4e16-bb95-b86b7fa795df）、installed-app-preflight.json（fa532771-dabc-49f8-9172-60dcc6c726d5）。本次宿主启动/观察额度均未消费，Xcode 未启动；后续先重新核对 fixture 和初始 Xcode 状态。T6.12 保持 in_progress，无生产代码/设备/提交推送。文档 JSON 与 diff 检查通过；上一 252 pass/8 skip 为历史代码门禁，本轮未重跑。


## 2026-09-17 实例门禁诊断完成，升级/宿主复检待确认

新增固定 AppKit 观察诊断模块与 405 组合合成验证；原放行条件不变，未知值不伪装 false，完整白名单检查值保留。0.1.1 临时只读探针已编译/签名验证，未安装或执行；旧版哈希不变。具体文件/哈希及升级备份、AX preflight、一次无设备宿主复检范围见 console plan 顶部，等待确认，不能把旧系统授权当新版升级许可。

性能包沙箱内既有通知握手失败，沙箱外同命令 252 pass/8 opt-in skip/0 fail（1562 assertions/38 文件）；typecheck/lint937/diff 通过。没有本轮 Xcode/设备动作、全库或 G5。原 observation_conflict 根因仍 inconclusive，T6.12 in_progress，无提交推送。


## 2026-09-17 AX 授权生效，单次只读观察在实例门禁阻断

用户完成 Touch ID 后，CUA 在系统 Open 面板选择已批准的固定 `iTestAgentMemoryConsoleProbe.app`。随后安装版 App preflight 返回 eligible/read_only_probe_trusted，请求 a9b88b09-0259-483f-a35f-68e6fb6362cc，exit0、cleanupVerified=true；以原生结果证实 AX 权限生效，不依赖设置列表的异步显示。安装版全部哈希与既有 macOS fixture 产物再次核对通过。

初始应用清单 Xcode isRunning=false。只打开既有临时 MemoryIdentityProbe 工程，核对 scheme/My Mac，一次 Run Without Building 后 Pause，CUA 确认 debug console 获焦。原生只读观察绑定本次 Xcode PID 90505 和既有工程路径，请求 7eec37e2-9067-4db6-b85b-bca0917248dc，返回 blocked/observation_conflict、capabilities={}、targetVerified=false，exit0、cleanupVerified=true。未进入 AX 控件读取，不能判断 AXSelectedText/AXConfirm、空 prompt 或范围读取能力；没有命令写入、Return、AXConfirm、重试或设备动作。

源码定位：该固定错误来自一个组合 guard，包含 NSRunningApplication 唯一实例、PID 相等、bundleURL canonical 路径、isActive 和未退出。当前证据不足以区分失败项。按证据排序的假设：①前台状态在 CUA/工具调用间变化（CUA 输入焦点不等于 App 原生 isActive）；②AppKit 实例注册或 PID 观察不一致（独立 ps 中本次 Xcode PID 正确，但不证明 AppKit 同时刻枚举）；③bundleURL canonical 路径或实例状态差异（ps 可执行路径符合预期，但不替代 bundleURL 检查）。三者均未验证，不将推测写成根因，不放宽门禁。

一次 Resume 后显示 Finished running，Stop 禁用；正常关闭工程并 Quit。独立 ps 确认本次宿主 90702、直属 RPC 90701 和 Xcode 90505 均不存在，应用清单 isRunning=false。launch=1、pause=1、resume=1、stop=0、queries=0、observations=1；本次单次宿主观察授权已消费。系统 AX 授权仍保持，不能将其当未来任意程序升级或宿主重跑许可。

本地证据目录 `/private/tmp/itestagent-console-capability-probe/`：installed-app-preflight.json、observation-result.json、owner.json、cleanup-result.json。下一最小单元是无 Xcode 的诊断改进：把组合门禁拆成固定原因/白名单布尔值并用合成状态验证；不修改已安装候选，不自动再次启动 Xcode。新的候选升级/宿主复检需具体方案，不能用已有权限绕过单次范围。

本轮无生产代码或构建变更；任务 JSON 与 git diff --check 通过，259 项性能包仍为历史证据，没有新 G5/G5-SIM。T6.12 保持 in_progress，无提交推送。


## 2026-09-16 已确认安装，等待 macOS Touch ID

用户确认上述独立只读 App 安装、AX 授权及一次宿主观察范围。源文件清单/签名核对通过，目标不存在后新建安装到 `~/.itestagent/helpers/xcode-memory-console-probe/iTestAgentMemoryConsoleProbe.app`，复制后所有文件哈希及严格签名核验通过。未覆盖旧 helper。安装证据 `/private/tmp/itestagent-console-capability-probe/installation-result.json`。

已通过 CUA 打开系统设置→Privacy & Security→Accessibility，点击 Add 后系统要求 Touch ID 或用户密码解锁。现等待用户完成系统身份验证；尚未选择/添加新 App，因此不能宣称 AX 权限已授予。临时宿主工程及可执行哈希仍匹配，尚未启动 Xcode、进行安装后的 trusted preflight 或消费一次宿主观察额度。解锁后继续添加固定新路径，并运行已准备的 installed-preflight.ts；不需要重新确认相同范围。T6.12 仍 in_progress；无生产代码/设备/提交推送，diff 与任务 JSON 检查通过。


## 2026-09-16 B 原生探针被新 App 辅助功能权限阻断

只读临时 App 候选已编译/签名校验；CLI 沙箱内外和 App launcher preflight 均返回 accessibility_unavailable。App 请求绑定结果、exit0 和所属 cleanupVerified=true 已验证。未启动 Xcode、读取控件或执行提交；既有 259 项包回归仍为上一代码单元证据。

下一步具体待确认范围、候选哈希和固定新安装路径见 `docs/06-verification/physical-memgraph-xcode-console-plan-6.12.md` 顶部：安装独立只读 App、为该 App 授予 AX 权限、一次既有 macOS fixture 的只读能力观察及正常收口。已安装 helper 不变，不能复用旧授权启动新宿主检查。临时候选 `/private/tmp/itestagent-console-capability-probe/`，App preflight 请求 27aa9239-daae-4f65-80c9-9b8b5dfe2c35。无设备/生产接线/提交推送；T6.12 保持 in_progress。


## 2026-09-16 B 公开 AX 受控提交与一次性查询流程

验证：定向原生测试通过；启用全部 opt-in 的性能包 259 pass/0 fail、1611 assertions、37 文件（36.61 秒）；typecheck、lint（936 文件）与 git diff --check 通过。日志 `/private/tmp/itestagent-console-submit-package.log`、`/private/tmp/itestagent-console-submit-types.log`、`/private/tmp/itestagent-console-submit-lint.log`。未执行全库或 G5/G5-SIM。

新增 `native/itestagent-memory-console-submit.swift`。MemoryConsoleSubmission 只接收此前验证的 PreparedMemoryIdentityQuery；检查当前 owner/context、取消/期限和源码指纹，要求输入内容严格为 `(lldb) `、光标位于末尾且无选区、AXSelectedText 可写、公开动作列表明确包含 AXConfirm。缺少任何条件时在写入前失败；不根据 AXValue 可写、AXPress 或 CUA Return 成功推断提交能力，不提供 CGEvent/键盘 fallback。

使用 AXSelectedText 只在空末尾插入固定命令，不替换整段 AXValue 或移动焦点/选区。写入后再次核对完整输入、光标、能力、源码与上下文，再调用一次 AXConfirm。每次调用均设置最多 0.5 秒消息期限并复查取消/截止；动作尝试标记在调用前记录，错误/超时不代表没有副作用。任何失败都消费本对象的单次额度；不清空输入、不重试或补发按键。返回仅代表 AXConfirm 调用成功，不能发布提交已验证或 target ready。

MemoryConsoleQueryExchange 在写入前创建输出增量边界，串联提交与接收：未提交不能 poll，提交失败后不能恢复/接收成成功，响应候选返回后终止本次对象。工厂将此前唯一输入/输出定位与每次重新解析的 context 闭包接入流程，保留动作尝试标记供后续 owner 收口。候选仍须现有 TypeScript 严格语义解析和目标/构建绑定；没有以候选存在判 observed 或 readiness。

原生 fixture 验证空/非空输入、非空选区、不支持/仅 AXPress、不可写、错误写入内容、插入失败或确认失败的结果不确定性、单次消费、写后取消/期限/owner/能力/源码变化，以及完整合成查询/失败后禁止 poll。公开 AX 实现仅编译，没有对真实 Xcode 执行动作。本单元不声明实际 AXSelectedText/AXConfirm 可用，也不把严格空 prompt 假设视为已原生实测；支持不足必须显式返回 unsupported，不能放宽门禁。

后续仍需将流程纳入临时候选 helper，验证实际 Xcode 原生能力和 owner/session 生命周期，之后才具备真实设备绑定/capture/export 生产接线条件。已安装 helper 未升级；无 Xcode/设备/权限动作，无提交推送，T6.12 保持 in_progress。


## 2026-09-16 B 原生控制台配对定位与接收绑定

验证：性能包启用全部 opt-in 后 258 pass/0 fail、1607 assertions、36 文件（31.95 秒）；随后取消/期限分类修正的两项原生定向测试 2 pass/0 fail、11 assertions（6.93 秒）。typecheck、lint（935 文件）与 git diff --check 通过。日志 `/private/tmp/itestagent-console-location-package.log`、`/private/tmp/itestagent-console-location-targeted.log`、`/private/tmp/itestagent-console-location-types.log`、`/private/tmp/itestagent-console-location-lint.log`。未重跑全库或 G5/G5-SIM。

新增 `native/itestagent-memory-console-location.swift`，复用既有唯一工程窗口/Debug Area/焦点/owner 定位，对同一 Debug Area 中公开 AXDescription 的 `debug console` 与 `Console` 作显式配对。输入必须是当前焦点，输出必须是不同元素且唯一。只把此前 CUA 观察的英文元数据当待原生验证候选，不按兄弟顺序、坐标或数字节点 ID 推断；未知/本地化/缺失描述、重复配对、输出在区域外均失败关闭。

对候选输出实际请求字符数与最多一个 UTF-16 单元的 AXStringForRange（空输出也请求零长度范围），验证范围 API 可用与返回长度；不读取整段控制台。随后重新解析工程上下文、配对及 owner；读期间出现窗口/sheet、工程/focus/输出实例或标签变化、取消/超时均拒绝。复用 512 节点/16 层/64 子节点预算与 0.5 秒 AX 消息上限。这个探针只证明当前输出元素的一次范围调用可用，不证明输入语义或提交能力。

新增 prepareLocatedMemoryResponseReceiver，把固定脚本 query、配对输出和既有增量接收器连接；每次接收检查会重新解析同一配对，而非仅信任缓存 AX 元素。创建前仍由调用方证明自有 launch/lease；提交动作未实现，不请求权限或引入键盘注入。绑定时发现接收器会把上下文复查期间发生的取消/期限耗尽误分类为 context_changed，现优先复查取消/期限并补负例，保留正确失败原因。

原生 fixture 覆盖正确/重排/空输出、聚焦输出而非输入、缺失/未知/本地化/重复描述、区域外输出、范围不支持/长度不一致、工程/焦点/标签/输出替换/owner 漂移、取消/超时及后出现 sheet。仅模拟结构与本地公开 API 编译；没有真实 Xcode AX 访问，不把 fixture 成功当原生真实宿主门禁。现有工程 URL 严格匹配策略未改变，路径别名兼容仍需单独验证。

下一缺口是原生提交动作和完整 helper/session 接线，再进行原生真实宿主与物理绑定验证。固定 helper 未安装升级，无 Xcode/设备/权限动作，未提交推送，T6.12 保持 in_progress。


## 2026-09-16 B 原生增量响应接收单元

验证完成：启用全部 opt-in 宿主性能包 257 pass/0 fail、1603 assertions、35 文件（27.75 秒）；typecheck、lint（934 文件）、git diff --check 通过。日志 `/private/tmp/itestagent-console-response-package.log`、`/private/tmp/itestagent-console-response-types.log`、`/private/tmp/itestagent-console-response-lint.log`。没有重跑全库或 G5/G5-SIM。

新增 `native/itestagent-memory-console-response.swift`，从已归属且独立定位的输出元素读取字符数与 AXStringForRange，不读取完整 AXValue、不发现/接管窗口、不请求权限、不写入或发送键盘事件。创建接收器时记录输出边界并只读最后一个字符判定行边界；提交前已有输出和已有未完成行不成为本轮候选。真实 output 元素定位及提交仍由未来 transport 负责，不能把此前 focused text area 候选直接当输出控件。

每次读取前后检查 owner/context、取消、单调期限，AX 消息最多 0.5 秒；单次及累计最多 16384 UTF-16 单元、保留内容最多 32768 UTF-8 字节、单条响应最多 8192 字节。输出清空/缩短、范围不一致、超量、无效前缀 JSON、重复同请求候选、归属漂移和错误均关闭接收器，不重试。分段未完成行、仍在增长的快照继续等待原期限；CRLF 按 UTF-16 换行拆分。忽略普通回显和不同 requestId，仅返回一条本轮固定前缀候选，成功后关闭接收器。所有缓冲保持本地，退出时清空，不记录原始控制台文本。

候选不是可信身份。现有 TypeScript parseMemoryDebuggerIdentity 仍须严格校验完整字段和请求，随后另行完成 owner/设备/构建绑定；本模块不发布 prepared/readiness 或清理证明。接收前后复用 PreparedMemoryIdentityQuery.validateSource 检查源码没有变化。新增 fixture 验证分段/CRLF/Unicode 偏移、历史/旧请求/旧半行、重复、清空、超量、取消、超时、归属漂移及读取后资源变化；公开 AX 适配器对不存在的进程失败关闭。跨 Swift→TypeScript fixture 验证候选经既有解析器处理，错误请求/无效 PID 拒绝。没有读取真实 Xcode 输出或任何设备证据。

首次编译发现 Int32 与 CFIndex 算术类型不一致，修正显式转换。随后 CRLF 正例失败，确认 Swift Character 分隔不能正确按独立 LF 处理 CRLF，改用 NSString UTF-16 分隔与末尾 LF 字节判断后通过；这是新接收器的实现问题，不宣称它是之前 CUA 长命令故障根因。

现有确认仅覆盖 CUA Return 对照，没有扩大到原生 CGEvent/任意键盘注入；本单元遵守该边界。提交动作、原生输出元素解析/能力验证、完整 session/native helper 接线仍待完成，当前安装的只读 helper 不变。未操作 Xcode/iPhone/权限或提交推送，T6.12 保持 in_progress。


## 2026-09-16 B 原生固定脚本加载器单元

验证：全部 opt-in 宿主性能包 256 pass/0 fail、1596 assertions、34 文件（26.31 秒）；补充 FIFO/目录/空文件负例后的定向原生用例再次 1 pass/0 fail（9 Bun assertions）。typecheck、lint（933 文件）与 git diff --check 通过。日志 `/private/tmp/itestagent-native-script-package.log`、`/private/tmp/itestagent-native-script-types.log`、`/private/tmp/itestagent-native-script-lint-final.log`。未重跑全库或 G5/G5-SIM。

在已确认 B 范围新增 `native/itestagent-memory-identity-script.swift`。PreparedMemoryIdentityQuery 只从指定 App bundle 的固定 Contents/Resources/itestagent_memory_identity.py 解析资源，不接受任意文件名、模块、源码或命令。编译时固定 SHA256 与随包源码一致；有界读取拒绝符号链接路径、硬链接、非普通文件、空/超大文件，使用 O_NOFOLLOW/O_NONBLOCK 避免被替换的 FIFO 在 open 时阻塞。读前后 fstat 核对，保存 dev/inode/size/mtime/ctime，生成命令前复核；调用方应在接收响应前再次 validateSource，替换为相同内容的新 inode 也拒绝。

请求仅接受规范小写 UUID，路径以 JSON 字符串编码形成固定 runpy 加载命令。1024 字节是传输预算，不声称 Xcode 长度阈值已验证。取消、单调期限、会话归属在读取前后检查，归属检查耗时后再检查取消/期限。仅返回待提交命令，不设置 targetVerified/submissionVerified，不自动执行 UI、发布 ready 或释放 lease。这个检查不是抵御同用户恶意瞬时修改的隔离机制；最终调用者仍需可信安装校验、源文件复核及真实身份/owner 校验。

新增真实 Swift fixture 及 Bun 集成测试：固定资源与被改/被替换文件、缺失文件、软/硬链接、FIFO/目录、空/超大文件、取消/归属漂移/截止时间，及带引号的 bundle 路径。Swift 构造的真实命令在无目标 CLI LLDB 中输出同请求的 unverifiable，确保不伪造目标存在。未安装升级固定 helper，尚未把此模块接到现有只读 preflight 可执行入口；原生 AX 提交/响应采集、目标绑定和完整会话接线仍需后续单元。不得把 CUA 成功当原生提交能力。


## 2026-09-16 短加载在 Xcode 返回完整身份，宿主匹配与退出通过

用户继续后完成一次已限定 Xcode 短加载验证。预先核对只读、非符号链接固定源码 SHA256 与既有 fixture 可执行哈希，初始 Xcode 未运行。仅打开新临时 MemoryIdentityProbe/My Mac，以一次 Run Without Building 启动并 Pause。短 ACK 经一次 Return 返回并通过生产严格解析；重新核对空输入与焦点后，提交 144 字符固定 runpy 加载命令一次，返回恰好一条同请求号、status=observed 的完整身份响应。没有重试或第三条命令。

生产 parseMemoryDebuggerIdentity 校验通过，宿主路径经 realpath 匹配既有 fixture，主模块 UUID 与 xcrun dwarfdump --uuid 实际产物一致；独立 ps 核对返回 PID 属于本次 fixture，LLDB RPC 是本次 Xcode 的直属子进程。这是单次宿主关联证据，不证明跨时刻 PID 连续性、物理设备 ID/bundle/构建绑定或原生 helper 提交可靠性。本次未做第二次身份查询，不能宣称同会话两次身份稳定已在 Xcode 复验。

一次 Resume 后 Finished running，无需 Stop。关闭工程后 CUA getAXState 返回 noWindowsAvailable，未重新启动或恢复窗口；正常 Quit 后独立 ps 确认本次宿主/RPC/Xcode 均不存在，最终应用清单 isRunning=false。没有将 noWindowsAvailable 本身当完整清理证明。launch=1、pause=1、Return=2、resume=1、stop=0。

证据：`/private/tmp/itestagent-loader-identity-response.txt`（仅白名单元数据、本地）、`/private/tmp/itestagent-loader-identity-validation.json`、`/private/tmp/itestagent-xcode-loader-owner.json`、`/private/tmp/itestagent-xcode-loader-result.json`。固定源码哈希 79db65f1e0287380150d12bb5a931e826b210ced13de0c2623c61f8cf837a3c7，宿主产物哈希 d239145b49c89487139caa000c8cfd64df6a3fc244fe809c4b9a9b39c06d400b。

短加载是已取得一次 Xcode 实证的候选，解决本次完整身份响应获取；不能据此断言此前长命令失败的精确根因或长度阈值。下一实施单元应把固定脚本来源/完整性、短加载命令与严格响应/owner 身份复查接到独立 helper，保持失败关闭、取消与资源清理门禁；临时源文件和 CUA 不能直接充当生产实现，也不自动升级已安装 helper。后续仍须原生通道验证、物理目标绑定、capture/export、生产接线及 G5。

本轮无生产代码变更、无构建/设备/权限/helper/baseline 动作，未提交推送。JSON 与 diff 校验通过；既有 255 项性能包证据仍为历史检查，未宣称重跑。T6.12 保持 in_progress。


## 2026-09-16 独立回执未出现；144 字符固定脚本加载候选通过 CLI 身份对照

一次同会话短/长对照已完成。初始 Xcode 未运行，只打开哈希已复核的新临时 macOS 工程/My Mac；一次 Run Without Building/Pause。144 字符短 ACK 严格解析成功，确认独占目录的 xcode-receipt 不存在后，在空输入框写入 1803 字符命令并按第二次 Return。该命令仅独占写固定 UUID 回执并打印 ACK，不读目标数据。没有匹配输出，也没有回执文件，收口后仍不存在；不能用 CLI 的另一 cli-receipt 文件替代 Xcode 证据。

完整 AX 按控件区分后观察到：长命令位于 Console 输出区，debug console 输入控件为空，当前焦点仍为该输入控件；未观察到 SyntaxError/Traceback/NameError/PermissionError/FileExistsError/error:。因此“命令仍可见”不足以推断它留在输入区。没有文件不能区分提交后处理阻塞和执行失败；也不能仅解释为 ACK 显示遗漏。没有第三次提交或重试。一次 Resume 后 Finished running，正常关闭工程/Xcode；本次宿主、直属 LLDB RPC、Xcode PID 独立检查均不存在，应用清单 isRunning=false。摘要 `/private/tmp/itestagent-xcode-receipt-result.json`，准备 `/private/tmp/itestagent-xcode-receipt-review.json`。

随后仅在独立 CLI LLDB 评估短加载候选：将随包固定 Python 源码原样复制到独占 0700 临时目录，以 0400 新文件保存；固定 `runpy.run_path(...)["emit"]` 命令为 144 字符，调用仍只提供本轮 UUID，完整字段及拒绝逻辑不变。原源码 SHA256 79db65f1e0287380150d12bb5a931e826b210ced13de0c2623c61f8cf837a3c7。真实 LLDB 同一进程的原命令与短加载命令经生产解析器校验身份一致，重启后实例改变，原夹具退出/缺失目标保护及所属清理通过。exit 0、stderr 空。证据 `/private/tmp/itestagent-loader-cli-result.json`；下一 Xcode 候选准备 `/private/tmp/itestagent-xcode-loader-review.json`，xcodeExecuted=false。

CLI 前两次沙箱内尝试失败：首次缺少夹具结果文件，补充诊断后定位为 fixture.launch_failed，后续 fixture 未定义；LLDB 本身仍 exit 0，不能仅看退出码判成功。首次后独立检查未遗留宿主或 LLDB。经工具审核授权在沙箱外执行同一夹具后通过，支持启动环境差异的解释；未放宽成功条件。临时诊断保留失败记录，不将前两次计为通过。

下一步是单次 Xcode 验证这个短加载候选，再决定独立 helper 的固定源码路径、完整性与生命周期接线；CLI 成功不证明 Xcode 或生产能力。临时只读文件不是对同用户恶意修改的安全隔离，不能作为最终可信安装机制。本轮没有修改生产代码、安装 helper、操作设备/权限或提交推送；JSON 与 diff 校验通过，历史 255 项包测试未重跑。T6.12 保持 in_progress，完整捕获、目标绑定和生产 G5 尚未完成。


## 2026-09-16 等长固定 ACK 也未获 Xcode 响应

恢复检查发现历史临时根路径仅余目录，旧源码、工程文件和可执行文件已不存在。未启动旧工程；在新独占临时根恢复同样仅 alarm(60)+pause 的 C 程序，显式 macOS、独占 DerivedData、CODE_SIGNING_ALLOWED=NO 预构建一次成功。新产物 SHA256 为 d239145b49c89487139caa000c8cfd64df6a3fc244fe809c4b9a9b39c06d400b；位置记录于 `/private/tmp/itestagent-xcode-length-fixture.json`，不当作历史相同二进制。

先行无目标 CLI LLDB 对照：1803 字符固定 ACK（短 print 加无行为注释，与旧 compact 查询等长）及 2220 字符阶段查询全部固定 ACK 通过严格匹配，exit 0、stderr 空。阶段查询在原样 compact 源码加载前/后及 emit 返回后打印固定请求标记，未减少身份校验。准备与结果位于 `/private/tmp/itestagent-xcode-length-review.json`、`/private/tmp/itestagent-xcode-length-cli-result.json`。

随后一次 Xcode 对照：初始用正确 id 字段确认 Xcode 未运行；仅 Welcome，新临时工程/My Mac 核对后 Run Without Building 一次，Pause 后聚焦空 LLDB 输入。1803 字符原文写入、焦点核对后一次 Return；即时与完整 AX 状态均无匹配 ACK，生产解析器判定 false，只有一个可见提示符、命令仍可见。未提交第二条阶段查询，未重试，没有目标身份读取。完整查询内容不是出现“无响应”现象的必要条件；长度/布局相关的提交或输出观察问题优先，但没有证明精确长度阈值，也不能确定命令完全未执行。短命令成功证据来自上轮，夹具已重建，不宣称本轮进行了同会话短/长配对。

一次 Resume 后宿主自然 Finished running，无需 Stop；正常关闭文档/Xcode，独立 ps 核对本次 Xcode/直属 LLDB RPC/宿主均不存在，最终应用清单 isRunning=false。计数 launch=1、pause=1、Return=1、resume=1、stop=0；结论 long_fixed_ack_unverified。摘要 `/private/tmp/itestagent-xcode-length-result.json`，owner `/private/tmp/itestagent-xcode-length-owner.json`。

当前缺口优先为长命令提交/输出观察。后续应先对同会话输入/响应边界建立可靠观测，再评估固定源码短加载方案；不能因短 ACK 成功就切换生产门禁或放宽身份条件。本轮无生产代码变更；CLI 固定 ACK 检查、临时构建、JSON 和 diff 校验通过，255 项性能包测试仍是历史证据，未宣称重跑。未操作设备、权限、固定 helper 或提交推送。T6.12 in_progress，物理绑定、capture/export、全资源清理与生产 G5 仍未完成。


## 2026-09-09 固定 ACK 多语句与 exec 对照通过

独立无目标 CLI LLDB 与一次 Xcode/My Mac 宿主会话均验证：150 字符 `script pass; print(...)` 与 174 字符 `script exec(...)` 各返回一条固定 ACK，分别通过生产 parseMemoryConsoleAck 的严格请求匹配。第二条仅在第一条通过、输入恢复为空且焦点核对后提交。没有目标元数据读取，未进行第三次提交。不能再把“多语句或 exec 一概不被 Xcode 接受”作为根因；完整身份脚本的长度、内容或输出通道仍未区分，短 ACK 不证明完整查询执行或身份绑定。

本轮 launch=1、pause=1、ReturnAttempt=2、resume=1、stop=0。Resume 后 Finished running，正常关闭所属工程及 Xcode；独立进程检查确认本次 Xcode、直属 LLDB RPC、宿主均已退出，应用清单确认 Xcode isRunning=false。初始应用清单过滤误用了 bundleId 字段，空结果不能单独证明初始未运行；随后打开时仅 Welcome、无恢复工程或调试会话。后续 inventory 必须使用实际 id 字段。既有 fixture 哈希一致，无构建、设备、权限、helper 或提交推送动作。

证据：`/private/tmp/itestagent-xcode-syntax-lldb-result.json`、`/private/tmp/itestagent-xcode-syntax-result.json`、`/private/tmp/itestagent-syntax-first-response.txt`、`/private/tmp/itestagent-syntax-second-response.txt`。本轮仅诊断与文档，沿用最近 255 pass 的代码门禁，JSON 及 git diff --check 校验。T6.12 保持 in_progress；下一缺口是完整固定身份脚本的提交/输出，生产捕获、物理绑定和 G5 尚未完成。


## 最新：等价短封装在 LLDB 通过，Xcode 对照仍无身份响应（2026-09-09）

已增加实验性 memoryCompactIdentityConsoleCommand，使用内置 zlib/base64 编码原样源码，调用方仍只能传请求 UUID。原命令保持不变。单测解压后逐字节比较随包源码；真实独立 LLDB 在同一进程中先执行原命令、再执行短封装，除请求号外完整身份响应相等，随后原有换世代/退出验证继续通过。长度 4897→1803 字符，单行且小于 2048；不减少身份字段或校验，不接收任意代码/路径，不自动用于生产。

门禁：全部 opt-in 宿主性能包 255 pass/0 fail、1587 assertions、33 文件、93.05 秒；typecheck、lint（932 文件）、git diff --check 通过。首次类型检查发现测试对可空 first 展开后字段变为 optional，已将比较放到存在性检查之后并复检通过。日志 `/private/tmp/itestagent-compact-query-package.log`、`/private/tmp/itestagent-compact-query-types.log`、`/private/tmp/itestagent-compact-query-lint.log`。

随后按本轮已明确范围执行一次 Xcode 对照：初始无 Xcode，唯一临时工程/既有哈希/My Mac 核对，一次 Run Without Building+Pause。空 LLDB 输入中的新 ACK 经一次 Return 返回并通过严格解析；再次核对空提示符和焦点后，写入 1803 字符短身份查询并按第二次 Return。即时与后续完整状态均无固定前缀身份响应，原命令仍可见，没有观察到 SyntaxError/Traceback/invalid syntax。没有第三条请求或重试。

一次 Resume 后宿主 Finished running，正常关闭本工程和 Xcode，无需 Stop。独立 ps 记录的 Xcode/直属 LLDB RPC/宿主均不存在，最终应用清单 Xcode isRunning=false。固定摘要 `/private/tmp/itestagent-xcode-console-compact-result.json`、owner 快照 `/private/tmp/itestagent-xcode-compact-owner.json`、ACK 白名单响应 `/private/tmp/itestagent-compact-ack-response.txt`。结论 compact_identity_unverified；launch=1、pause=1、ReturnAttempt=2、ACK=true、identityResponses=0、resume=1、stop=0。

缩短封装尚未解决 Xcode 结果缺失，不能断言 4096 字符阈值或把此候选当修复。继续区分更短输入形态、多语句/exec 提交和脚本输出路径；后续实验必须保持固定语义与单次限额，不能以 ACK 或 CLI 成功设置生产 submissionVerified。此候选保留用于受控对照，当前未接固定 helper、PermissionEngine 或生产入口。T6.12 in_progress；物理绑定、capture/export、全资源清理与 G5 尚未完成，无设备/helper/权限/baseline 动作，未提交推送。

## 最新：Xcode 短 ACK 实证通过，完整身份查询仍未验证（2026-09-09）

用户明确要求执行下一步后，完成一次限定 ACK-first 宿主检查。初始 Xcode 未运行；只有 Welcome，无恢复用户工程。复核临时工程及原 Debug 可执行哈希一致，选择 MemoryIdentityProbe/My Mac，以一次 Run Without Building 启动并 Pause。没有构建、签名或设备动作。

暂停后 debug console 显示空 `(lldb)` 并可聚焦。写入 144 字符固定 ACK，核对完整内容和焦点后按一次 Return，得到一条同 UUID 的 protocolVersion=1/status=acknowledged 响应。响应写入 `/private/tmp/itestagent-xcode-ack-response.txt`，通过生产 parseMemoryConsoleAck 严格校验，随后再次观察到空提示符。因此本轮已证明这条短命令经 CUA 在 Xcode 提交并取得响应；不是仅从按键成功或文本可写推导。

ACK 成功后才写入第二条完整固定身份查询，核对原文与焦点后按第二次 Return。随后及最后完整 AX 状态检查没有匹配的身份响应，完整原命令仍可见，未观察到 SyntaxError/Traceback/invalid syntax。不能确认身份查询已执行，也不把未见错误当成功。此次没有重复请求、替换按键、改写脚本或追加第三条命令。

一次 Resume 后宿主 Finished running，关闭所属工程回到 Welcome 并正常退出 Xcode，无需 Stop。独立 ps 确认本次 Xcode、直属 LLDB RPC 和宿主 PID 均不存在，Xcode 可执行进程不存在，最终应用清单 isRunning=false。固定摘要 `/private/tmp/itestagent-xcode-console-ack-result.json`、owner 快照 `/private/tmp/itestagent-xcode-ack-owner-snapshot.json`。计数：launch=1、pause=1、write=2、ReturnAttempt=2、ACK validated=true、identityResponses=0、resume=1、stop=0；结论 ack_passed_identity_unverified。

这将缺口从一般键盘/控制台可达性缩小到完整查询的提交或输出路径。后续假设按证据排序：较长的内嵌源码/输入形态影响 Xcode 提交；Python 脚本输出通道与短 print 不同；未捕获的执行或显示错误。尚未确认根因，不能直接把压缩命令、模块加载或其他传输方案作为已验证修复。下一步可先在无设备 LLDB 比较保持相同元数据语义的短封装，再提出明确的一次 Xcode 对照，不自动重跑当前会话。

本轮仅宿主验证与文档更新，沿用 254 项性能包/typecheck/lint 证据，不宣称本次重跑或 G5。ACK 不证明身份、原生 helper 可靠性或 capture ready；物理绑定、capture/export、全资源清理和生产接线仍未完成。T6.12 in_progress，未操作 iPhone/Simulator、helper、权限、baseline 或提交推送。

## 最新恢复点：短 ACK 已实现，下一次 Xcode 通道探针已准备

原生 NSTextView 对照最终证实 paste + Return 可触发一次按键和一次换行，夹具已正常退出；前置夹具初始化/文本系统错误及四份崩溃记录已如实记录。不能用它证明 Xcode 提交。现增加仅打印固定请求 ACK 的 144 字符命令和严格解析，真实独立 LLDB 无目标执行通过，性能包 254 pass/0 fail（1580 assertions）、typecheck/lint/diff 检查通过。

详见 `../06-verification/physical-memgraph-xcode-console-plan-6.12.md` 最新节。下一探针 `/private/tmp/itestagent-xcode-console-ack-review.json` 尚未执行：一次 macOS 启动/Pause，短 ACK 成功后才允许完整身份查询，合计两次 Return 上限，并保留 Resume/Stop 正常清理与独立核验。ACK 不代表身份、目标就绪或完整资源清理，不升级固定 helper。本轮无 Xcode/设备动作或提交推送，T6.12 in_progress。

## 最新：暂停态输入已定位，Return 响应仍未验证（2026-09-09）

按用户“继续下一步”执行已明确的单次暂停态范围。初始 Xcode 未运行；唯一临时工程的 MemoryIdentityProbe/My Mac 与既有产物核对通过。一次 Run Without Building 后点击一次 Pause；公开 AX 显示 Paused、Continue，并在 debug console 中出现 `(lldb)` 空提示符。聚焦该区域后，第一条固定命令通过 paste 写入，AX 核对完整命令、新请求 UUID 和同一 debug console 焦点均匹配，再调用一次 Return。

Return 调用后及恢复前后的状态检查均未提取到匹配 requestId 的固定前缀 JSON 响应。最终可见文本仍含完整原命令，只有一个 `(lldb)` 和一次请求 UUID，没有显式截断标记；没有把命令回显或 Return 工具成功当作执行证明。第二条未写入、未提交。结论为 response_unverified：只验证暂停态输入区可辨识/可聚焦及固定命令可写，不确认查询执行、Return 提交生效、进程身份一致或独立 helper 能力。

随后在同一工程使用一次 Continue/Resume，观察 Finished running 与 Stop disabled，无需 Stop；关闭所属工程回到 Welcome，正常退出 Xcode。独立 ps 确认本轮记录的宿主、直属 LLDB RPC、Xcode 均不存在，最终应用清单 Xcode isRunning=false。未重启、未强退、未发生权限或保存提示。本机摘要 `/private/tmp/itestagent-xcode-console-paused-result.json`，owner 快照 `/private/tmp/itestagent-xcode-paused-owner-snapshot.json`，固定前缀提取结果为空。动作计数：launch=1、pause=1、queryWrite=1、ReturnAttempt=1、matchedResponse=0、resume=1、stop=0。ReturnAttempt 不是 confirmedQueryExecution。

下一调查按证据排序：Return 在该控件未形成可验证的提交（原命令仍可见、无新提示符）；Xcode 的脚本输出通道未由当前 AX 表示提供；请求执行或显示发生了未观察到的异常。尚无依据选择生产适配方案，不改写命令、不切换按键或自动重跑。后续先审计现有控制台元数据/提交通道，再提出具体有界验证；当前授权额度已消费。物理目标绑定、原生提交与响应 transport、capture/export、完整清理及 G5 仍待完成。

本次只有宿主探针和文档更新，无生产代码变更，沿用已有 253 项性能包/typecheck/lint 记录，不宣称本次重跑。T6.12 in_progress；未操作 iPhone/Simulator、helper、权限、baseline 或提交推送。

## 最新恢复点：Return 宿主探针已执行并收口

用户确认后运行一次 macOS MemoryIdentityProbe。运行态 debug console 不可见，Console 虽可聚焦但无已验证 LLDB 输入提示，故未写入查询、未按 Return。等待宿主自动结束后正常关闭工程/Xcode，独立进程与应用清单均确认退出。详见 `../06-verification/physical-memgraph-xcode-console-plan-6.12.md` 最新结果；本地摘要 `/private/tmp/itestagent-xcode-console-return-result.json`。单次额度已消费，禁止自动重跑。下一候选需要明确允许一次宿主 Pause、固定查询及 Resume/Stop 的关闭范围；尚未执行或证明暂停后控件可用。无生产代码变化，T6.12 仍 in_progress。

## 下一步恢复点：固定 Return 宿主探针待确认

App 实例枚举修复与 253 项性能包回归已通过。真实控制台提交仍缺证据，不能继续假定 AX 能提交。已准备一次限定 macOS fixture/两条固定只读身份查询的 Return 提交探针；临时工程、既有二进制哈希及请求文件已核对，详见 `../06-verification/physical-memgraph-xcode-console-plan-6.12.md` 最新提案。当前仅准备文档与本地请求，没有 Xcode/设备/权限动作；原方案禁止键盘绕过，须先确认这项明确例外。批准后按该方案执行一次，不重复旧额度、不直接扩展到生产 helper。T6.12 in_progress，未提交推送。

## 最新：App 实例枚举时序修复（2026-09-09）

验证完成：确定性回归 red → green；修复后原生宿主重复 12 pass/0 fail（240 Bun assertions、66.37 秒），整个性能包启用全部 opt-in 后 253 pass/0 fail（1564 assertions、33 文件、25.00 秒）。typecheck、lint（932 文件）和 git diff --check 通过。日志 `/private/tmp/itestagent-owned-app-fixed-repeat.log`、`/private/tmp/itestagent-owned-app-fixed-package.log`；本轮未重跑全库、未执行 G5/G5-SIM。已定位并修复空枚举误判的具体路径，不将缺乏完整诊断的历史失败逐一宣称同因。

继续已确认 B，在固定原因诊断基础上增加测试专用有界观察记录（最多 64 个去重状态，只含存在/数量/同实例布尔值和启动/退出状态）。原实现两组各 12 次真实无设备宿主运行分别为 10 pass/2 fail、8 pass/4 fail。后一组明确观察到有效启动回调返回后实例列表 count=0、matching=false、isTerminated=false，代码立即报 instance_conflict。前一组另观测到 terminate=true 后唯一实例判断失败；其日志尚未区分列表为空还是其他实例，不能将所有历史失败都归因为同一个已证明原因。

根因已确认的部分：原布尔唯一性接口把暂未列出与实际冲突合为 false，无法容纳启动回调和运行实例枚举之间的观察间隙。改为 owned/absent/conflict 三态：启动/关闭阶段 absent 只在原截止时间内等待，不发布 acquired、不请求退出、不证明已退出。已发出 terminate 后只观察该实例退出与冲突，不重复调用 terminate 或关闭证明；真正冲突、已 acquired 后无关闭请求却失去实例、期限届满仍未观测退出，继续 cleanupVerified=false。成功仍必须看到原 NSRunningApplication.isTerminated；不以列表为空释放锁，不增加超时或 forceTerminate。

确定性回归先在旧实现触发 `Absent inventory must wait for registration`，修复后通过。新增策略负例覆盖注册前取消、注册一直缺失、退出前/后列表一直为空、外来实例出现及已 acquired 实例丢失；保留未知窗口/错误归属/拒绝退出/晚回调/父生命周期断开的测试。公开语义依据：[Apple NSRunningApplication](https://developer.apple.com/documentation/appkit/nsrunningapplication?language=objc)、[terminate](https://developer.apple.com/documentation/appkit/nsrunningapplication/terminate()) 及本机 AppKit SDK；公开文档支持属性与 run loop 的更新约束，具体回调与列表时序由本机 fixture 实证。

本机记录：`/private/tmp/itestagent-owned-app-diagnostic.log`、`/private/tmp/itestagent-owned-app-presence.log`、`/private/tmp/itestagent-owned-app-policy-red.log`、`/private/tmp/itestagent-owned-app-policy-green.log`。本次无真实 Xcode/iPhone/权限动作，未升级固定 helper 或提交推送。此修复属于 App-only 生命周期，真实 Xcode 控制台提交、目标关联、capture/export、全资源清理与生产 G5 仍未完成；T6.12 保持 in_progress。

## 最新：同一 LLDB 进程实例的退出观测（2026-09-09）

验证记录：最终启用全部 opt-in 宿主用例的性能包 253 pass/0 fail，1564 assertions、33 文件（36.91 秒）；typecheck、lint（932 文件）、git diff --check 通过。首次 typecheck 的测试字面量推断问题已修正为 as const。首次包回归为 252 pass/1 fail：自有 App fixture 的启动取消断言失败；保留失败记录，不将重跑成功称为已修复。已补固定 reason/cleanupVerified 失败诊断，单独一次及两组 3/5 次有界重复共 9 次均通过，完整包重跑也通过，原始失败原因仍 inconclusive。按证据待排查系统实例枚举更新、取消清理归属与回调/期限；不靠增加延时、放宽断言或强退消除失败。此项属于当前 B 验证未收口，后续先取得失败原因，不能据此宣称生命周期稳定或完整 G4/G5 关闭。

本机日志：`/private/tmp/itestagent-exit-observation-package.log`（首次失败）、`/private/tmp/itestagent-exit-observation-package-recheck.log`（包重跑）、`/private/tmp/itestagent-owned-app-repro.log`、`/private/tmp/itestagent-owned-app-repeat.log`、`/private/tmp/itestagent-owned-app-final-repeat.log`（有界复现）。未重跑全库或真实 Xcode/设备验证。

已扩展固定 Python 元数据查询，新增 query_exit/emit_exit 与严格 TypeScript 命令构造、解析。仅接受请求 UUID 和此前观测的 debugger ID/进程实例 ID/PID；只在选中 SBProcess 有效、状态明确为 eStateExited、标识一致且查询末尾复查仍一致时输出 observed_exited。目标缺失、仍存活、换目标/换世代、错误或不可读均不可验证，不从 PID 消失或身份查询失败推断退出。无 Kill/Detach/目标表达式、内存或堆栈读取。

公开 LLDB 无设备 fixture 真实启动两个自有宿主进程：每个进程结束后发出退出观测，并与退出前的身份行在 TypeScript 中关联；跨世代误配被拒绝。存活状态、错误标识、重启后旧实例、删除目标均拒绝。固定控制台命令另在无选中目标时执行，验证命令格式和明确的 unverifiable 返回。该测试复用已有 fixture 的自有进程清理，不增加真实 Xcode 或设备动作。

来源：[LLDB SBProcess 官方 API](https://lldb.llvm.org/python_api/lldb.SBProcess.html)。该结果只证明当前已归属 debugger 中选中进程的退出状态；debugger ID/实例 ID 本身不能独立绑定跨 LLDB 宿主或物理设备。真实 Xcode owner/控制台提交链路仍未接入，不自动转为完整 capture 的 aut/debugger/xcode/helper 清理结果，也不释放完整会话锁。RPC 与 Xcode 退出及文档关闭仍需各自的真实观测。

此单元补充一个真实宿主观测来源，没有宣称完整清理或 G5 通过。固定 helper 未升级，未操作设备/权限，未提交推送，T6.12 仍 in_progress。


## 最新：完整捕获清理结果门禁（2026-09-09）

验证完成：全部 opt-in 宿主性能包 252 pass/0 fail，1542 assertions、33 文件（30.68 秒）；typecheck、lint（932 文件）、git diff --check 通过。

发现内部 MemorySessionProtocol 原先仍允许单独 cleanupVerified=true 令完整会话进入可释放锁的终态。现显式区分默认 capture 与 owned_app_only：后者禁止进入 prepared/capturing/exported；App-only transport 明确选择其作用域，不能用于完整捕获。

capture 的成功 closed 需要内部清理结果：同一 sessionId、scope=capture、此前已验证的完全相同目标/构建/PID/进程世代，以及 document=closed、debugger/aut/xcode/helper=exited。任何缺失、unknown、额外字段、旧会话/旧世代均拒绝，不消耗事件序号、不设置 cleanupVerified；可随后报告 closed/cleanupVerified=false 并保留锁。取消不阻止同会话已证实的收口，但禁止新业务动作。准备阶段尚未取得独立身份时不能虚构完整清理证明；仍保留未确认状态，未来部分启动的清理来源另行实现。

这是内部结果的完整性/绑定校验，不是独立清理观测来源。字段齐全、schema 通过不证明实际退出；未来可信 native/full-session transport 必须先观测文档、debugger、AUT、Xcode 和 helper 的真实状态再提供结果。不能以 App 退出、Stop 禁用、请求 UUID 或 PID 相等合成这些证明。当前无真实完整捕获结果提供方，没有执行真实 Xcode/设备动作。

定向 19 tests/120 assertions 通过，新增负例覆盖逐资源缺失/unknown、过期身份、错误作用域/会话、取消后收口及拒绝不消耗序号；保留 App-only lease 生命周期与导出回归。没有改变对外报告 schema、固定 helper 或系统权限。T6.12 保持 in_progress，未提交推送。


## 最新：父生命周期取消与 App-only 全局锁收口（2026-09-09）

验证完成：启用全部既有 opt-in 宿主用例的性能包 250 pass/0 fail，1496 assertions、33 文件（28.06 秒）；typecheck、lint（932 文件）、git diff --check 通过。固定 helper 与 launcher 哈希未变，未提交推送。

已在已确认 B 范围新增 MemoryParentLifetime：独占监听 helper stdin 生命周期流及 SIGTERM/SIGINT，无数据命令；EOF、意外字节、无效描述符和信号均取消原生 driver。启动前先检测已关闭父端，主队列 DispatchSource 避免阻塞主 run loop；通知幂等，终态 stop 关闭自有重复描述符并恢复原信号处理器。过早释放 monitor 也触发取消。未增加 forceTerminate 或设备操作。

新增内部 runOwnedMemorySession，将原生 App-only 结果与现有全局 Xcode lease/MemorySessionProtocol 连接。严格绑定 sessionId、scope=owned_app_only、固定原因和布尔结果，同时要求 helper 已退出且 exitCode=0、无 stderr；缺失/过期/错误作用域/被强制结束/清理未确认均保留锁并阻止下一次启动。父取消但已证实资源清理及 helper 正常退出时，可释放锁并返回 cancelled；只写入结果而未完成退出不能释放。

该接口严格限未创建工程、debugger 或 AUT 资源的 App 生命周期。结果里的 App 退出证明不能授权完整 capture lease 释放；后续全会话 transport 必须另补文档/debugger/AUT 清理证明。当前 runner 为内部依赖注入，真实测试使用已编译原生 driver 并 await helper.exited；固定 helper 入口、候选打包和 Xcode-specific close proof 仍未接线。

定向验证 9 tests/48 assertions 通过：8 项逻辑测试覆盖正常释放、异常保留锁及后续启动阻断；真实无设备临时 App 连通 EOF、SIGTERM、SIGINT、早期 EOF → 原生取消 → App 退出 → helper 绑定结果/退出 → 全局锁释放。早期 EOF 不发布 acquired；真实 fixture 使用已限定无 UI/无设备 App 的关闭证明，不用于 Xcode。首次 Swift 编译因 SIG_DFL 的可空处理器类型失败，改用 sig_t? 后通过。临时 App 自带 15 秒退出上限，结束后检查无残留。

本次不启动 Xcode、不更改辅助功能权限、不升级固定 helper、不操作设备、不提交推送。T6.12 保持 in_progress。剩余仍包括真实 Xcode 工程/调试资源清理、目标身份/控制台提交、capture/export、生产 transport 与 C/D/E 门禁。


## 最新：自有 App 生命周期与主 run-loop 驱动（2026-09-09）

验证完成：启用全部既有 opt-in 宿主用例的性能包 242 pass/0 fail，1456 assertions、32 文件（26.76 秒）；typecheck、lint（930 文件）、git diff --check 通过。固定 helper 与 launcher 哈希未变。

已在已确认 B 范围新增 MemoryOwnedAppSession 与主 run-loop timer 驱动，并实现公开 NSWorkspace 适配器。启动前检查已有实例，仅保留本次回调返回的 App，复查 bundle URL/identifier 及 isEqual 唯一实例；不打开工程或运行 scheme。重复 start 不重复启动。取消期间等待晚回调，禁止发布 acquired；正常退出仅请求一次 terminate 并等待 isTerminated，不含 forceTerminate。

退出前由调用方提供窗口/资源安全证明，并在证明之后复查期限和实例。未知窗口、归属变化、拒绝退出、超时或回调失联均 cleanupVerified=false；终态之后的迟到回调不重新发起动作或篡改结果。enclosing session 必须因此保留全局 lease；该 native driver 尚未接入既有 TypeScript lease/协议和固定 helper transport。它的 cleanupVerified 只覆盖所属 App 生命周期，不证明 debugger/AUT/文档已收口。

主 run-loop timer 在每次观察之间让出事件循环，持续持有 driver 直至终态，避免调用方释放引用而静默丢失待决启动。后续 helper 父进程 EOF/SIGTERM 必须接入 cancel，并完成 Xcode 窗口及调试资源的安全退出证明；当前尚未实现这些接线，不能复用只适用于预检的强退 launcher 宣称 B 清理完成。

无设备原生 fixture 用真实公开 NSWorkspace 启动两次独占、无 UI 的临时 App，验证正常退出、已有实例冲突不干扰首请求、启动回调前取消后的收口及主循环回调。策略 fixture 另覆盖预取消、重复 start、未知窗口/错误实例/退出拒绝、无回调、终态后晚回调和退出超时。实际 App 有 15 秒自退出上限，测试终止后另用进程检查确认无残留才删除临时包。未访问 Xcode、未请求 AX、未操作设备或升级固定 helper。定向测试通过；不将 fixture 的安全退出证明常量用于真实 Xcode。

剩余 B：Xcode 窗口/工程/调试资源生命周期、全局 lease 与父生命周期接线、真实目标绑定、公开控制台提交、capture/export 及候选打包。此单元没有降低任何原门禁，T6.12 仍 in_progress，未提交推送。


## 最新：AX 工程窗口与焦点候选绑定（2026-09-09）

验证完成：性能包启用全部既有 opt-in 宿主用例后 241 pass/0 fail，1448 assertions、31 文件（52.62 秒）；typecheck、lint（929 文件）、git diff --check 通过。固定 helper/launcher 哈希与原安装一致。未提交推送。

在已确认 B 范围新增原生上下文读取/定位模块，并连接上一单元能力查询。限定唯一窗口、Xcode.WorkspaceWindow 标识、匹配的本地工程 URL、唯一 debug area 与区域内当前焦点文本控件；额外窗口、sheet、重复区域、未知焦点、循环/超深/超量树、查询错误、取消或漂移均阻断。树预算 512 节点/16 层/单节点 64 子元素，公开数组 API 先查数量再有界读取；每次 API 消息最长 0.5 秒并共享调用方单调期限。只读角色/标识/文档 URL/元素结构，不读取文本值，不输出原始树。

原生 owner 复查使用调用方保留的 NSRunningApplication 对象、isEqual、唯一实例、bundle URL、活动/退出状态；不把 PID 当进程世代。Apple 文档明确应用动态属性依赖主 run loop 更新，因此未来 session driver 必须在观察之间让出主循环，本单元不宣称同步轮询即可捕获所有用户干预。初始无实例、全局 lease、自有启动回调以及异常退出清理仍须由后续 session driver 实现，当前没有发起启动或接管已有 Xcode。

候选控件仅表示焦点落在 Debug Area 内，不证明其是可提交的 LLDB 输入。能力查询每次前后重新解析同一完整有界上下文，焦点/窗口/区域变化丢弃结果，submissionVerified 仍为 false。AXDocument 与标识组合是基于公开字段的候选适配规则，尚未在独立 helper 的真实 Xcode 上验证；缺失不回退到标题或坐标。

无设备 Swift fixture 覆盖唯一候选、窗口/工程/焦点冲突、弹窗、树预算、查询异常、取消、期限、查询期间漂移和能力绑定；实际适配器用本测试自身的非 Xcode 应用对象验证 owner 拒绝，不访问真实 App。首轮测试编译的抛错断言表达式已修正，定向测试通过。固定 helper/安装清单/系统权限不变，无 Xcode 或设备动作。

依据：[Apple processIdentifier](https://developer.apple.com/documentation/appkit/nsrunningapplication/processidentifier?changes=_5)、[NSRunningApplication](https://developer.apple.com/documentation/appkit/nsrunningapplication?language=objc) 与本机公开 AX/AppKit SDK。仍待真实 owner driver、候选打包、公开提交语义、目标绑定及 capture/生产接线；T6.12 in_progress。


## 最新：原生 AX 能力查询单元（2026-09-09）

验证完成：性能包启用全部既有 opt-in 宿主用例后 240 pass/0 fail，1444 assertions、30 文件（46.15 秒）；typecheck、lint（928 文件）、git diff --check 通过。固定 helper/launcher SHA256 与既有版本一致。T6.12 保持 in_progress，未提交推送。

此前一次 Xcode 宿主复检已成功启动，CUA 显示可写 Console/debug console，但没有明确提交动作。停止时出现 RPC 退出警告，随后核验所属宿主/RPC 均不存在且 Xcode 退出；详见 physical-memgraph-xcode-console-plan-6.12.md。下述单元没有重跑 Xcode。

已在已确认 B 范围新增独立 Swift 只读能力查询模块：公开 AXUIElementCopyAttributeValue 仅取角色、AXUIElementIsAttributeSettable 仅询问 Value 可写性、AXUIElementCopyActionNames 枚举动作。输出固定角色布尔、可写布尔、Confirm/Press 是否声明及其他动作计数；不输出任意动作名或原始文本。submissionVerified 恒 false，声明动作不等于已验证提交语义或目标身份。

每次查询前后检查取消、单调期限和调用方上下文证明，AX 消息单次最长 0.5 秒；错误、过期、上下文变化、重复或超量动作均无能力结果，不把查询错误当作空动作列表。该上下文回调是内部注入边界，尚无真实 Xcode owner/窗口/元素身份实现，PID 不能代替它。

新原生 fixture 编译真实公开 API 适配器，覆盖正常/空动作、错误、元数据限制、取消、上下文变化、超时、输出脱敏；使用不存在的进程元素验证公开适配器失败路径，不访问任何真实 App。第一次 warnings-as-errors 检出只输出结果不应声明 Decodable，已改为 Encodable，随后定向测试通过。此模块尚未接入固定 helper 构建/安装清单或 App transport，不升级固定包、不申请权限、不执行动作，不能宣称原生 Xcode 或生产 G5 通过。

API 依据：[Apple AXUIElementCopyActionNames](https://developer.apple.com/documentation/applicationservices/1462053-axuielementcopyactionnames?language=objc) 及本机公开 SDK AXUIElement.h。后续仍须实现 owner 与实时元素定位，再对具体候选安排独立原生检查；没有新增自动重试或键盘提交路径。


## 最新：宿主复检完成，AX 提交仍待验证（2026-09-09）

再次授权后，修正路径的临时工程在 My Mac 上 Run Without Building 成功。公开 AX 提供 Console/debug console 可写文本控件，但未提供明确提交动作，因此未输入或提交固定查询，不使用键盘绕过。此结论仅针对当前 CUA 表示，原生 helper 动作枚举及提交协议尚缺。

Stop 后 Xcode 出现 LLDB RPC Server 退出警告；已关闭提示及所属工程并退出 Xcode。只读进程核验确认本次宿主/RPC 均不存在，应用清单确认 Xcode 未运行；不能推断 Stop 与 60 秒 alarm 哪个使宿主退出。未操作 iPhone、权限、固定 helper 或 baseline。结果见 physical-memgraph-xcode-console-plan-6.12.md，原生 capture 与 C/D/E 仍未完成；T6.12 in_progress，未提交推送。


## 最新：Xcode 宿主检查在运行前阻断，已收口（2026-09-09）

已执行用户允许的一次检查：Xcode 初始未运行，无恢复用户工程；临时工程 scheme/目的地确认为 MemoryIdentityProbe/My Mac。Run Without Building 提示无已构建产物，已取消、关闭工程并退出 Xcode（isRunning=false）。宿主启动和 LLDB 查询均为 0，控制台 AX 提交能力仍未验证；没有设备动作。

临时工程原未绑定命令行独占 DerivedData 产物目录，现已显式设置 CONFIGURATION_BUILD_DIR；只读设置核验指向现有 Debug 二进制，未重建。修正后的一次同范围宿主复检待新授权，详见 physical-memgraph-xcode-console-plan-6.12.md。生产代码未变，沿用上一单元 239 项宿主回归；本次仅更新检查结果与临时配置。T6.12 仍 in_progress，未提交推送。


## 最新：固定 LLDB 身份查询已验证（2026-09-09）

B 已增加固定元数据查询、仅 UUID 输入的命令构造和严格响应解析。真实宿主 LLDB 两次自有进程启动验证身份变化，同进程稳定、退出后拒绝；顶层固定控制台命令亦通过，清理完成。性能包含全部 opt-in 原生用例 239 pass/0 fail，1440 assertions、29 文件；typecheck/lint 通过。未改固定 helper 或系统权限，未操作 Xcode App/iPhone，未提交推送。

下一缺口为 Xcode 控制台公开 AX 提交能力及目标关联；已构建临时 macOS 调试工程，但未运行。具体一次宿主检查待确认，见 `docs/06-verification/physical-memgraph-xcode-console-plan-6.12.md`。现有设备列表与本地 LLDB 实证均不能替代 Xcode owner/所选设备/构建关联，不能发布 capture ready。T6.12 保持 in_progress。


## 最新：B 已确认，协议单元完成（2026-09-09）

已实现内部会话/身份门禁、全局 lease 与导出文件校验，尚未接原生 UI。9 项新测试及宿主性能包 235 项回归通过；真实 Xcode 调试会话身份提供方仍缺失。LLDB GetUniqueID 仅为公开接口候选，未执行设备查询或放宽 PID 复用门禁。详见 `docs/06-verification/physical-memgraph-capture-plan-6.12.md`。固定 helper 与权限不变，T6.12 保持 in_progress。

## 固定新版授权复检通过（2026-09-09）

用户已在 System Settings 移除旧 helper 条目，Agent 确认其不再存在后，经公开文件选择器重新添加固定新版 iTestAgentMemoryHelper.app；观察到对应开关 on。随后一次独立生产内部 App transport preflight 返回 eligible/xcode_not_running、targetVerified=false、Xcode 26.5、cleanupVerified=true。没有扩大父应用权限或修改其他条目；没有启动 Xcode 或操作设备。

此前升级后旧条目 on 但实际不受信的问题，在移除旧条目并添加固定新版后解除。当前只证明新版 host 只读前置和退出链路；Xcode 已运行分支、目标绑定、自动 Memory Graph 和正常 TUI G5 仍需后续 B 计划与实测。旧版备份保留，未继续升级/重签，T6.12 in_progress。代码未变，沿用 A4 typecheck/lint/226 项宿主包回归证据。

## 固定升级完成，旧 AX 条目仍待刷新（2026-09-09）

用户确认升级/备份及新版必要授权。旧版、新版摘要/签名和无运行实例核对通过；使用系统公开 renamex_np(RENAME_EXCL) 完成非覆盖备份及发布，完整旧版备份/新版清单再次核验通过。恢复状态由 /private/tmp/itestagent-helper-upgrade-state.json 定位，备份未删除，未自动回退。

固定新版 App transport 首次只读 preflight 返回 accessibility_unavailable、cleanupVerified=true。System Settings 旧同名条目仍为 on；尝试添加同一路径时 Open 禁用。AX 行选择无效、Remove 保持禁用，坐标点击返回 noWindowsAvailable，因此没有实际移除条目。只对 iTestAgentMemoryHelper 开关 off→on；随后一次授权后复检仍 accessibility_unavailable、cleanupVerified=true。未修改其他 App 权限、TCC 数据或设备。

当前需要在系统 UI 移除该 helper 旧条目后重新添加固定新版；自动化未能选中行，需用户仅完成这项首次环境恢复，后续添加/复检继续自动执行。没有新的捕获 G5，不将权限开关等同运行时访问。代码未变，沿用 A4 的 typecheck/lint/226 项宿主包回归证据。

## A4 已实现并完成宿主验证（2026-09-09）

用户确认后已实现公开 NSWorkspace launcher、私有请求目录/绑定结果文件、TypeScript App transport 和 schemaVersion=2 暂存 candidate 构建。父 stdin 生命周期管道、SIGTERM/超时清理仅针对本次返回的 App 实例；取消早于回调仍等待晚回调收口。无退出证明则保留 lease 并阻断，不把文件存在或启动成功当就绪。旧固定安装与原授权未改变。

实测发现 Foundation 会将 /private/tmp 标准化为 /tmp，改用实际 realpath 校验；短 App 在回调前退出时 PID 可能失效，改为显式 terminatedAtCallback，不复用失效 PID。App 生命周期登记补齐后，6 项真实无权限宿主测试通过：正常退出、结果写入后取消、超时、已有实例冲突、父管道 EOF/晚回调、结果不可覆盖/不跟随链接。测试退出检查无本次 fixture 残留。

最终 typecheck、lint（920 文件）通过；性能包启用宿主用例 226 tests/1365 assertions 全过。暂存新版 0.2.0 已构建、签名及清单校验；helper SHA256=d751dcce8c54883df364c9dac016fcf791738017a10f8be8c3743e1c2b7b7e1d，launcher SHA256=a858a79951da0e5751c1d603613ec0fddc642859f4ebe5fd4c24afd6b04c4d19。原固定 helper 哈希未变。

下一步待审阅 physical-memgraph-helper-upgrade-plan-6.12.md：一次固定升级、保留旧版备份、必要时对确切新版重新启用 AX、只读复检。未执行升级/新授权，没有 Xcode 或设备动作、生产捕获 G5、commit/push。新代码 resolver 不兼容旧源码清单时会明确阻断，不自动替换旧安装。

## A3 诊断推进：App 包启动已获得只读访问（2026-09-09）

同一已授权固定二进制经公开 App 启动方式运行，返回 eligible/xcode_not_running、targetVerified=false、Xcode 26.5；退出码 0、stderr 空、helperRemaining=0、哈希不变。未扩大父应用权限、重签或改设备。结果支持启动方式影响权限归属，但未观察 TCC 内部链，不能排除时间因素。

下一步按 physical-memgraph-launch-plan-6.12.md 的 A4 修复候选做 App 启动 transport 和 owner/取消，不能简单用 open -W 替代可控子进程。A4 待确认，现有固定包不覆盖，暂存新版与无 AX 的专用宿主 fixture 先验证生命周期，再审阅升级。无需重复要求开启同一开关。

## A3 辅助功能授权后的复检（2026-09-09）

用户明确允许为固定版本 helper 启用辅助功能，并自行完成系统 Touch ID 验证。Agent 经公开 System Settings 文件选择器选中固定 iTestAgentMemoryHelper.app，添加后观察到 iTestAgentMemoryHelper_Toggle=on。其他 App 开关未修改。

随即从固定安装目录执行一次独立只读 preflight：仍为 blocked/accessibility_unavailable、targetVerified=false、Xcode 26.5。只读检查确认同一非 root 有效用户、二进制哈希未变、系统签名校验通过。不能以设置开关开启代替 AXIsProcessTrusted 实际返回，也不能声称已获得运行时访问。

尚待区分启动归属/运行环境、系统权限传播或 bundle 识别问题；当前证据不足以确认根因。没有重新编译/重签/安装，没有重置 TCC 数据、扩大 Codex/Terminal 权限或操作设备。下一步应制定固定 bundle 启动与权限归属的最小诊断，不能重新要求同一系统开关授权或自动进入 capture B。本次只读复检已执行，未宣称生产 G5。

## A2 固定安装完成（2026-09-09）

用户确认 A2 后已实现内部 installer/resolver 与 7 项新测试。固定安装位于 ~/.itestagent/helpers/xcode-memory/iTestAgentMemoryHelper.app，bundle ID=com.itestagent.memory-helper；ad-hoc 签名校验通过，二进制 SHA256=4b7f416dd2c0d7ff4f2809ca6c6f073ad0d2abf87767f39d829eae4798f72520。独立调用第一次 installed、第二次 reused，install.json 未变；随后从校验后的固定 bundle 执行只读 preflight 返回 accessibility_unavailable、targetVerified=false、Xcode 26.5。未请求系统授权、未启动 Xcode、未操作设备。

首次调查发现 swiftc 输出带 driver 前缀，随后还发现直接调用编译器需要明确 SDK；均在发布前停止，目标目录未创建。已支持真实版本输出并显式使用选定 Xcode 的 macOS SDK，回归覆盖工具链/SDK绑定。没有覆盖或重装已完成的 bundle。

安装使用独占目录预留与最后写入清单；存在未知/不完整目录时阻断，不覆盖。发布失败可能保留不完整目标，不能自动删除。resolver 校验当前源码/plist摘要、完整文件清单及系统签名，拒绝链接与篡改；ad-hoc 是开发期身份/完整性机制，不宣称可信发行或防御同用户恶意进程。工具目录位于既有唯一本地持久化根，暂存清理仅限本次 owner。

最终 typecheck 通过；lint 917 文件通过；性能包正常宿主 214 tests/1311 assertions 全过（A2 新增 7 项）。未 commit/push。T6.12 in_progress，生产 capture/TUI G5 尚未完成。下一步仅可针对上述固定版本另行申请辅助功能授权并只读复检；不自动给父应用扩权、不重跑旧设备对照。

## 当前下一步：A2 固定 helper 安装计划待确认

只读签名调查确认临时 helper 为 ad-hoc，DR 包含 cdhash。已完成 physical-memgraph-helper-install-plan-6.12.md：固定只读 app bundle、完整性/签名校验、不覆盖首次安装、幂等复用；不申请 AX、不启动 Xcode 或手机。确认 A2 后实施并交付具体安装身份，再单独处理权限。当前未编码/安装，沿用第一单元验证结果。

## 独立 memgraph 预检第一单元实施（2026-09-09）

用户已确认第一单元。已新增 Swift 公开 AX 只读 helper、TypeScript 有界协议、编译说明和 8 项测试；不启动 Xcode、不请求授权、不读取窗口内容、不操作设备。宿主 eligible 仅表示前置候选，targetVerified 始终 false；任何现有 Xcode 实例一律阻断，不接管。

公开 SDK 核对与 swiftc 编译通过。独立宿主运行识别 Xcode 26.5，返回 blocked/accessibility_unavailable；错误 bundle 返回 xcode_invalid。没有借助 CUA。获授权后的 AX/实例查询分支尚未实测，不宣称捕获可用。临时二进制不作为要求用户授信的固定身份，后续先拟定稳定 helper 安装/签名与权限引导，再批准 B 的实际 UI 操作计划。

新增 8 tests/35 assertions 通过，含真实自有子进程取消/超时及退出等待；全库 typecheck、lint（915 文件）通过；全包正常宿主 207 tests/1281 assertions 通过。沙箱内 206 pass/1 fail 为已有 notifyutil 通知用例，同代码宿主重跑通过。没有生产默认来源变更、新设备 G5、commit/push。

## 下一步：ADR-044 与独立适配器预检计划待确认

真机 memgraph 两组工具证据已完成、资源收口。新增 ADR-044（提案）及 physical-memgraph-production-plan-6.12.md，明确 Codex CUA 不是产品可发布运行时；首个待批单元为 Swift 公开 AX helper 只读预检与 TypeScript 有界协议，不执行设备动作、不改默认来源。后续 capture/契约/正常 TUI/G5 分单元推进，不能重复使用旧阳性/释放动作授权。本轮只有文档变更；未新增生产代码、提交或推送。

## 最新结果（2026-09-09）：释放对照完成真实 0/0 扫描

用户手动退出阻塞的 Xcode 后，Agent 重新启动并只读打开原 MemoryProbe 临时工程，确认同一 iPhone 与 scheme。已授权 Run Without Building 执行一次，Running MemoryProbe 成立且 Memory Graph 可用；未执行新构建命令，是否内部重新部署未单独观测，本次授权已包含必要时重部署同一 fixture。绑定唯一新 PID，确认不同于阳性 PID。此前 UI 阻塞已解除。

独立生产 Appium Route B 会话执行一次 Run Released Workload、20 秒 wait、assertVisible 与 assertText，结果 passed，tapCount=1，identityStable=true。Xcode 一次 Memory Graph 捕获完成，通过公开 File > Export Memory Graph 与保存面板自动导出唯一 control.memgraph，无覆盖。文件 1515741 bytes，SHA256 955dd7f3b04cc3fc07583e3bcba609d81ab6e862c8caea155f502d2172f638dd；捕获起点 19:35:04.168355 UTC、文件 mtime 19:36:05.567888 UTC；本地 leaks --list --nostacks --noContent 唯一一次分析 19:36:32.179170–19:36:32.881193 UTC，exit 0，唯一摘要 PID 匹配，0 项 / 0 bytes，stderr 为空。原始内存图和命令输出仅留本次 run artifacts，模型仅接收白名单证明。

与此前阳性 20 项 / 5242880 bytes、exit 1 的真实扫描配对，公开 Xcode 自动捕获/导出及真机 memgraph 离线诊断工具通道通过阳性与释放对照。结论限于“本次检测未发现”，不承诺无所有泄漏；不等于 itestagent 生产 backend 或正常 TUI 的 G5 已完成。没有重跑阳性或重复释放以求零。

probe/Appium exit 0，backend closed/reusable；Xcode Stop 后 AUT 0，记录 owner PID 0，4723 空闲，临时工程关闭无保存提示，Xcode 退出。baseline 前后均 2 份且完整哈希映射相同。初次核验误把相对路径按 cwd 解析，随后按清单实际 ~/.itestagent/baselines 根重算并记录修正；不是 baseline 内容变化。

证据由 /private/tmp/itestagent-memgraph-state.json 定位：control/{status.json,steps.json,control.memgraph,leaks-proof.json,owner-cleanup.json,backend-cleanup.json,final-cleanup-proof.json}。两轮具体动作授权均已消费，后续不能自动重跑。下一步按既有方案进入公开 UI 依赖、暂停扰动、权限/取消/隐私、目标与产物绑定的 ADR 评估和生产接线计划；未批准新生产实现前不编码。缺失/损坏输入边界已验证；生产取消/中断门禁仍需随新来源接线验证。T6.12 保持 in_progress，T6.13 pending；未提交推送。

## 最新恢复点（2026-09-09）：释放启动补充已授权，Xcode AX 超时

用户已明确“允许”仅释放对照用 Run Without Building 建立新调试会话，并允许必要时重新部署同一 MemoryProbe；不重新编译、不改 Team/源码、不操作其他 App。授权已取得，不能再次把相同启动差异当待确认项；阳性不得重跑。

本次恢复停在打开已有临时工程的 UI 阶段：核对工程目录及 project.pbxproj 存在，实际 Go to 面板定位到 MemoryProbe.xcodeproj，但 Open 按钮为 disabled。此前窗口标题为 appium.raw，属于非目标文档，未读取其原始日志内容，未关闭来源未确认的文档。Cancel 曾返回超时；随后只读状态确认文件面板已关闭。File 菜单操作后多次 AX 读取均 timeoutReached，Escape 后仍未恢复。没有点击 Run Without Building，没有本轮启动/重新部署、工作负载、捕获或 leaks 分析；不能推断打开按钮禁用的根因或声称零扫描。

只读检查确认 Xcode 进程存在、control 目录不存在、4723 端口空闲。未强制退出 Xcode、未接管其他会话。恢复应先解决 Xcode/Computer Use 界面响应并确认临时工程与设备，再按已授权释放流程执行一次；保持新 PID 绑定、唯一 control.memgraph 和所有 owner 收口要求。原始 AX 仅本地内存白名单处理。当前阻塞是 UI 自动化可用性，不是用户授权缺失。

### 后续恢复尝试：连接重建仍未恢复 UI

用户再次要求继续后，重建 Computer Use JavaScript 连接；Xcode getApp/getAXState 仍 timeoutReached。Finder 可建立窗口，但 Go to 面板截图与 AX 树不一致，目录跳转后的状态未能确认目标工程。尝试一次画面定位与正常粘贴后仍无法确认，停止继续 UI 输入；未调用 shell/AppleScript 绕过 UI 自动化。释放 Run Without Building 及设备工作负载仍未执行，原具体授权保留。下一步须先恢复可可靠观察的 Xcode/Computer Use 会话；不能把用户手动采集/导出作为验证通过路径。

## 当前恢复点：真机memgraph自动阳性通道通过，释放启动方式待确认

用户同意调整顺序后，Xcode一次构建/签名/安装并调试MemoryProbe，公开Memory Graph按钮出现。绑定唯一PID，独立生产Route B WDA下阳性一次tap/20秒wait/断言通过，Xcode一次捕获后自动File > Export Memory Graph。positive.memgraph 1516321bytes，leaks一次分析exit1，唯一PID匹配摘要20项/5242880bytes、stderr空。原始文件仅run artifacts；尚不能称零扫描或生产backend/G5。

阳性已完全收口：probe/Appium exit0、backend closed/reusable、AUT0、记录owner PID0、4723空闲、Xcode关闭退出、baseline两份hash不变。缺失/损坏memgraph离线检查exit255且无摘要。私有state=/private/tmp/itestagent-memgraph-state.json；临时owner/workload脚本仅用于工具spike，不替代生产TUI验收。不要复用旧PID，不重跑阳性。

释放对照未开始。公开AX当前未能定位附加进程入口，已定位Run Without Building，但可能重新部署同App，超出原不再次安装范围。physical-memgraph-zero-plan-6.12.md顶部已具体申请仅放宽释放这一次启动方式/必要重部署；其余已授权一tap/一次快照/扫描/清理保留，不重复授权。待确认后以新PID在同一目标运行释放对照。T6.12仍in_progress，无生产修改、提交推送。

## 当前恢复点：memgraph方案已批准，预检暴露调试上下文前置问题

用户确认physical-memgraph-zero-plan-6.12.md后，仅执行公开Xcode界面预检：临时工程成功打开/Debug Area展开，无额外安装或迁移；无活动调试上下文时AX未暴露Memory Graph或专用导出控件。按方案第1步停止，不能把这判为真机memgraph不可用。未构建/安装/WDA/tap/附加/捕获，设备动作授权未消费。

本次工程已关闭无保存提示、Xcode已退出（listApps非激活延迟确认），两份baseline哈希不变；未改生产代码。原方案要求先定位可能依赖调试上下文的控件，前置顺序有缺口。该文件末节准备最小顺序调整：使用原已授权构建/替换/启动并附加精确fixture进程后，再核对控件，未通过前不执行按钮或捕获；次数/原隐私边界不变。下一步仅待顺序调整确认，不重复申请同一尚未消费的设备授权。T6.12保持in_progress，未提交推送。

## 下一单元：真机memgraph零扫描候选，等待新方案确认

用户继续下一步后，已只读核对旧零扫描调查、Xcode26.5公开帮助和Apple官方memgraph说明。旧空导出/AX不能证明完成，新的recording-ready同样不能证明扫描；未重复录制。run目录无既有memgraph。候选为Xcode公开Memory Graph界面自动捕获/导出后leaks离线分析，未证明本机自动化可行，也不是新增生产能力。

具体计划见docs/06-verification/physical-memgraph-zero-plan-6.12.md：先临时公开界面自动化探针，再一次构建/签名/仅替换MemoryProbe、阳性与释放两个独立进程各一tap/一次快照/一次分析；全程raw-local-only、目标时间绑定、失败停止、baseline不变。不要求用户手工导出；证据成功后另定ADR和生产接线。该新实现与设备范围待确认，当前未启动Xcode/设备操作或修改生产代码，T6.12仍in_progress。

## 当前恢复点：公开通知和业务wait内取消两项physical G5已通过

本节优先于所有历史恢复点。用户新授权后，精准取消run_01a08730-6748-7000-b10e-5510ab7eb39d完成：正常TUI/真实provider/原confirmed Flow、两轮70/10秒skip；唯一tap，wait17:22:58.682Z开始，约602ms后正常TUI Ctrl-C。canonical valid/cancelled、第一轮cancelled、第二轮not_started且步骤产物0，三指标cancelled，无虚构数值/baselineDelta。audit保留ready/取消结果；CLI/Appium/AUT/capture/notify/socket/4723均收口，baseline两份哈希不变。与单次run_01a08719-247d-7000-905a-ffb402712b7d共同完成此次两项G5。

此前watch只识别/click导致晚取消的run仍属采集等待取消历史证据，不升级结论；修正后的临时watch已实测识别W3C actions并准确取消。当前/private/tmp/itestagent-physical-readiness-state.json属于已退出的成功取消run；不要复用旧PID/socket。positive-proof保存已成功单次run。授权已消费，不再重跑单次或精准取消。

本轮未改生产代码，沿用4097pass/7skip/0fail，文档已同步。T6.12仍in_progress、T6.13 pending，无提交推送。下一步应针对剩余physical有效零扫描、Simulator多轮/baseline、XCUITest及其他性能出口另定具体范围；不能把此次两项G5当作整个T6.12完成。完整数值、时序及局限见性能报告顶部最新结论。

## 当前恢复点：取消已落盘，但需补业务wait内的精确取消证据

本节优先于下文。用户直接确认后，安装/WDA审批通过；run_01a08728-f2a9-7000-bb65-cb2c64da3673正常TUI取消，canonical valid/cancelled、第一轮cancelled、第二轮not_started、唯一tap、三指标cancelled，无虚构数值或baselineDelta。CLI/Appium/AUT/capture/notify/socket/4723均收口，baseline两份哈希不变。

精确场景未过：临时cancel-watch只匹配/click，Flow实际走成功POST/actions，45秒监测上限才发Ctrl-C，20秒业务wait已completed，实际取消在采集等待期间。不得称业务wait abort G5通过。已离线修正临时脚本兼容actions/click并收紧15秒上限，6项检查及语法通过，不涉及生产代码；最新生产门禁仍4097 pass/7skip/0fail。详见性能报告顶部最新事实。

当前私有state属于已退出run，禁止复用PID/socket；positive-proof仍保存已通过单次G5，不重跑。下一步待新的一次性具体设备确认后，只补同一Flow第一轮业务wait取消（构建/签名/只替换MemoryProbe/WDA/一tap/正常TUI取消，第二轮不授权），不擅自重跑已消费授权。T6.12 in_progress、T6.13 pending，无提交推送。

## 最新恢复点：单次 physical 通知 G5 已通过，取消 G5 被具体安装审批阻断

本节优先于下文历史。用户允许后已关闭此前外部MemoryProbe。真实CLI/OpenTUI单次 `run_01a08719-247d-7000-905a-ffb402712b7d` passed；registered→started严格通知成功、ready先于业务动作、xctrace exit0；一次tap/20001ms wait，45样本覆盖91.4538秒，peak48.3755MiB、growth+38.2656MiB、Leaks19项/4980736bytes，三指标collected。canonical重载/目标/skip/无baselineDelta通过，CLI/Appium/AUT/capture/notify收口，baseline两份哈希不变。详见性能报告顶部最新接续。

第二个取消run最终Flow/hash/两轮/70/10秒/skip审阅通过，build权限allow已发送，但replace_device_app被自动审批拒绝；补充此前两轮授权后仍要求本次具体替换直接确认。已正常退出CLI/Appium（均exit0）、AUT0、socket清理、baseline不变；未安装/WDA/tap/capture，不能算业务wait取消验收。下一步取得该具体安装确认后新开正常会话；不重跑已成功的单次G5，不复用旧PID/socket。私有state与driver/input/proof/cancel-watch在/private/tmp/itestagent-physical-*；当前state属于已退出的第二个会话。positive-proof单独保存且cleanupComplete=true。cancel-watch未执行，须先核对第一轮权限再运行，并以canonical证明wait内取消。

本轮未改生产代码，沿用4097-pass门禁；T6.12 in_progress、T6.13 pending。尚未完成取消G5及其他既定出口，无提交推送。用户后续确认应明确涵盖取消run构建/签名、只替换MemoryProbe和Route B WDA，以避免审批再次无法识别动作范围。

## 最新接续：DEF-036已关闭，Simulator两组生产G5-SIM通过（2026-09-09，优先于下文）

用户“继续下一步”批准入口修复及复验计划。已修正Simulator空高风险集合的虚假安装请求，真实WDA仍逐份计划prepare_wda；四个`--simulator-*`瞬时CLI参数经审阅传入真实Simulator composition，限制本地端点/互异端口/owner目录，不改physical路线或持久化配置。

正常生产CLI/TUI、真实provider、无替换依赖：阳性`run_01a086d5-92dc-7000-ae89-a57bda35ec22`与释放`run_01a086dd-4659-7000-bad9-de8ca341315f`均passed，分别36有效样本/102.791秒与36样本/101.926秒；唯一真实扫描分别20项/5MiB和完成0/0。各一次指定按钮、20秒业务等待、回执1轮；baseline=skip，canonical及原始数值/身份/summary一致性通过。DEF-036 resolved；当前无open延期项。详情性能报告§38。

全库4077 pass/7既有skip/0fail/12695 assertions/377文件，typecheck/lint（910文件）/G2/gitleaks通过。两组CLI/Appium/AUT/shutdown均exit0，Simulator已Shutdown，owner进程0、端口全部释放、其他设备及两份baseline哈希不变。保留已安装App/设备/证据；上述两组操作授权已消费，勿自动重跑。

下一步仍属T6.12：physical零扫描与Ctrl-C readiness、Simulator多轮/baseline、XCUITest新增性能及其他指标出口，需按具体方案继续；不要重复已完成的Simulator单次内存接线或阳性/零扫描实测。T6.12 in_progress，T6.13 pending。当前HEAD仍bc35876，工作区代码/文档未提交，本轮无commit/push/merge。


## 最新接续（2026-09-09，优先于以下全部历史状态）

Simulator native生产接线计划已获用户确认并实现（ADR-043、性能报告§37）；source/目标绑定/完成零扫描/abort/原始证据/报告/默认baseline=skip及自动化已接通。全库4071 pass、7既有skip、0fail；后续native跨源/轮次定向4项46断言通过，typecheck/lint/G2/gitleaks通过。当前分支未提交改动仍保留，HEAD锚点bc35876；本轮未获新commit/push授权，也未执行。

**下一步阻塞DEF-036**：正常生产CLI/TUI已实际走到专用Simulator计划确认，审阅70s/10s、native来源、baseline=skip正确，但无安装需求仍请求replace_device_app（executeTestPlan空actions的默认映射）。已按批准计划deny并停止；工作负载/采样/两组诊断均未执行，不能称正常TUI G5-SIM通过。另需为正常入口接通专用Appium/WDA端口和owner DerivedData配置；不能改用注入式probe通过验收。具体修复与复验方案已写入`docs/06-verification/simulator-production-entry-fix-plan-6.12.md`，待确认后接续，不再次发送旧allow或自动重试。

证据`~/.itestagent/runs/sim-native-tui-1788967379/artifacts/`仅本地raw；CLI正常退出、专用Simulator已Shutdown、owner进程0、其他设备状态和两份baseline哈希不变。保留已安装App和Simulator；不得删除/覆盖。T6.12 in_progress，T6.13 pending；DEF-034/035已resolved，DEF-036 open。本增量之外的physical零扫描、Ctrl-C readiness、Simulator多轮/baseline、XCUITest与其他指标继续保留，不把T6.12整项标完成。


## 接续增量（2026-09-08，优先于下方历史快照）

- 后续baseline接受计划已获确认并实现（ADR-041、性能报告§26），本次提交前锚点3a01a7e，用户已要求提交推送到现有PR #82；最终SHA由git log -1及交接回复确认。`/baseline accept <run-id>`展示兼容的physical内存新旧值，PermissionEngine逐次确认、报告重读及baseline CAS保护后替换实际指标；startTui退出dispose待处理会话。完整门禁4029 pass / 7 existing skip / 0 fail，12452 assertions（含生产长key临时文件名回归）；真实PTY允许/拒绝/退出使用临时fixture通过；本次提交前重新typecheck/lint通过，全库4029 pass / 7 existing skip / 0 fail，12452 assertions、371文件、98.60s（§28）。
- 用户针对具体替换另行授权后，正常生产CLI/OpenTUI真实接受已通过（§27）：来源已更新为run_01a08345-914d-7000-bae0-bb3394627f9e，峰值48.359901→47.813026MiB、增长38.359398→37.796898MiB。只有1个baseline改变，两次历史run的10份报告哈希未变；创建时间与去重来源历史保留，完整性通过、无锁/临时文件残留。CLI/driver正常exit0且socket移除，未执行新设备工作负载/采集。该次update_baseline授权已消费，不应重复发送accept/allow；零扫描、多轮及其他路线剩余责任不变。

- 本次提交前锚点`7ca4945`；用户已要求将本次接续的代码/文档提交推送到现有PR #82，最终提交SHA通过`git log -1`核对。T6.12仍in_progress，T6.13仍pending。
- 已检查历史公开CLI导出与Instruments AX界面，尚无有效零扫描完成证据；Codex Computer Use访问可用，无需再次索要同一辅助功能授权。detected-only不变，空详情不能判not_detected。证据见性能验证报告§21–22。
- 用户确认的等待职责修复已完成：将确认的性能观察配置和实际capture启动结果传至动作模型，保留原始目标和业务等待。DEF-035扫描路径修复已验证并resolved，保留审计。typecheck/lint/G2通过；全库4006 pass / 7 existing skip / 0 fail。见§23。
- 用户单独授权后的短工作负载真实TUI G5已通过：`run_01a08345-914d-7000-bae0-bb3394627f9e`。仅launch/tap一次/wait20s，无额外70/10s UI wait；49样本跨82.169s、录制100.003s、coverage complete，三项内存指标collected，17个观测泄漏分配/4.25MiB；canonical完整性通过、baseline文件名/哈希不变。详见§24，不把此单次结果泛化为全部T6.12通过。
- 新PTY socket和driver会话已结束，不复用旧授权。driver/CLI/Appium已退出、4723关闭、xctrace为0；测试App退出需本轮显式fixture进程收尾，已核验为0，不声称产品自动终止AUT。新raw证据只在`~/.itestagent/runs/memory-waits-tui-1788908546/artifacts/`，只能输出确定性脱敏投影。
- 后续优先明确有效零扫描可验证通道、已确认资产的多轮语义，以及Simulator/XCUITest和剩余性能出口；TUI接受baseline已在§26–27实现并完成真实替换验收。下方§6第3项与DEF-035已经完成本次增量，勿重复实现或重跑旧阳性验收。新的真机录制和高风险动作需要新的具体授权。

## 1. 接续目标与状态

本文件是本轮提交的交接快照，不替代规格、ADR和task-status。新session先核对Git及最新文档，保留用户后续修改。

- 仓库：iTestAgent；当前分支 `docs/def034-physical-cancellation-evidence`。
- 现有PR：[PR #82](https://github.com/logan-suu/iTestAgent/pull/82)，base `dev-1.0`；交接前核实为OPEN、非draft。不要新建重复PR，不自动合并。
- 上一提交锚点：`cdd3f92262b8b0849c7532f6cdde8fface713f7b`（自动内存增长与阳性泄漏诊断）。本次提交增量是无引号断言、采样余量、baseline策略隔离及§15–19实证；最终提交SHA由交接回复给出，可用 `git log -1` 再核对。
- T6.12 `in_progress`；T6.11已done；T6.13仍pending，不抢先启动。DEF-034已有真机取消清理证据并resolved；DEF-035仍open。
- 用户的目标是让通用itestagent具备**全自动**测试App内存增长和泄漏等性能指标的能力，不是证明某个App没有泄漏，也不接受每轮手动使用Instruments/Xcode导出文件的半自动方案。

## 2. 新session必读与约束

先读 `AGENTS.md`、`docs/INDEX.md`、`docs/05-planning/task-status.json` 和 `deferred-items.json`，使用 `retry-task-itest` 从已验证点继续。相关文档：

1. `docs/01-spec/全量用户故事与验收标准规格书.md`：US-11.1、US-12.1/12.2/12.3。
2. `docs/decisions/ADR-039-performance-capture-lifecycle-and-evidence-status.md`。
3. `docs/decisions/ADR-040-memory-growth-and-leak-diagnostics.md`；先读顶部最新实证，正文包含保留的历史调查结论。
4. `docs/06-verification/performance-capture-wiring-6.12.md`：§10泄漏证据通道、§13正常TUI阳性、§15断言、§16覆盖失败、§17修复、§18首次baseline、§19第二次比较。
5. `docs/decisions/ADR-032-local-raw-evidence-and-semantic-ui-risk.md`、ADR-036和ADR-037；后续涉及backend/采集时再按INDEX读技术选型§11、避坑§6与对应架构/数据流。

原文约束：

> AC3 后续 run 与 baseline 对比输出变化趋势

> AC4 泄漏结论必须来自真实诊断证据，区分检测到、本次检测未发现与无法检测；内存增长不能直接判为泄漏，未发现不承诺不存在所有泄漏。

> AC7 真机与 Simulator 能力分别实测，不能以独立后端 probe 或 fixture 单测替代生产链路验收。

> High-risk allow decisions cannot persist across sessions, and persistent deny rules must be revocable.

本轮及此前各轮构建/替换安装/准备WDA的授权**均已消耗**。本文件不是新授权；开始新一轮前需明确目标App和逐动作授权。不能自动重签WDA、卸载其他App、修改Keychain、覆盖baseline或重复有副作用的工作负载。新实现先Explore/Plan，再等用户确认；不要把“交接继续”解释为批准尚未提出的实现方案。

## 3. 已完成的产品链路

- 正常生产CLI/TUI→候选确认→设备选择→计划审核→PermissionEngine→物理DeviceBackend→性能采集→canonical三件套已经真实跑通，无模型/设备/采集替身。
- 显式请求 `memory_peak`、`memory_growth`、`memory_leaks`，计划显示观察/settling参数、成功条件、采样余量；执行期间有持续activity和倒计时。
- 中文/英文边界清楚的无引号可见性条件可编译为用户断言，带引号条件保持；按顺序合并去重，敏感目标和多case歧义仍阻断。否定/复合/条件语句不猜测。没有确定性条件不冒称passed或建立成功baseline，TUI给出缺失提示。
- 公开Activity Monitor采样提供带时间戳footprint，报告真实首尾、峰值、增长、样本数、覆盖；MiB明确，不能用录制墙钟替代有效样本跨度。
- 公开Leaks详情逐分配解析已接入阳性检测；仅聚合count/bytes进入结果。空node、未知格式、未证实扫描仍not_exportable，**没有实现有效not_detected语义**。
- `MEMORY_CAPTURE_POLICY` 为 `memory-observation-v2`，同一trace预留30秒有界采样余量：`max(readyAt + minimumDurationMs + 30000, actionsFinishedAt + settleDurationMs)`。不重复动作、不开第二条trace；长动作不额外重复加余量；工具600秒上限保持。
- 导出后严格覆盖门禁不放宽，不足仍inconclusive、不建baseline。新旧策略baseline隔离；首个合格run自动建立，后续只比较、不覆盖。

主要实现入口：

- `packages/itestagent-engine/src/test-plan-compiler.ts`
- `packages/itestagent-tui/src/plan-review.ts`
- `packages/itestagent-contracts/src/memory-analysis.ts`
- `packages/itestagent-backends/performance-xctrace-analyzer/src/production-capture.ts`
- 同目录 `activity-monitor-memory.ts`、`memory-growth.ts`、`leaks-detail.ts`、`capture-process.ts`
- `packages/itestagent-engine/src/baseline/production-memory-baseline.ts`
- `packages/itestagent-engine/src/confirmed-run-bundle.ts`、`production-run-executor.ts`

## 4. 最新真机证据（不要重复验证已通过点）

报告根是本机 `~/.itestagent/runs/<runId>/`，不是仓库目录。使用生产 `createDefaultRunStore().loadRunBundle()` 校验schema、引用与artifact完整性，读取聚合字段；不要把原始trace/XML/UI tree/截图导入模型上下文。

| 项目 | 首次baseline | 第二次比较 |
| --- | --- | --- |
| runId | `run_01a082ed-5ee5-7000-be47-00b41954a634` | `run_01a082fd-4353-7000-be2a-84cb022096a7` |
| case/run | passed / passed | passed / passed |
| 三项内存指标 | 全部collected | 全部collected |
| 样本数/有效跨度 | 89 / 227793.130ms | 96 / 226309.330ms |
| 录制时长 | 229791.503ms | 231016.274ms |
| 峰值MiB | 48.359901428222656 | 48.35992431640625 |
| 增长MiB | 38.359397888183594 | 38.921897888183594 |
| Leaks | 19条 / 4980736 bytes | 20条 / 5242880 bytes |

第二轮产品生成baselineDelta：growth **+0.5625MiB**、peak **+0.00002288818359375MiB**。逐项重算与报告相符；两轮execution、observation、appSource、projectProfileRef相同。首轮baseline文件数始终1、updatedFromRun不变，SHA256始终 `a0238dbcf9a92402dd3f42bea8f733b1559def771d75903da4b9763121ae0cfe`。可从第二轮result.baselineDelta.baselineId定位 `~/.itestagent/baselines/physical/<baselineId>.json`，不要重写它。

两个run均只tap一次，但模型另生成约20/70/10秒三次wait；因此约230秒长录制证明链路成功，**不构成30秒余量在短动作边界的独立因果验证**。当前regressed只是数值增加标签，峰值差约24 bytes，不代表统计显著退化。5MiB泄漏与38.92MiB总footprint变化不是同一指标。

历史失败 `run_01a082cc-99a3-7000-a96c-76d566174635`：功能passed，但约70秒录制仅59.85秒有效样本，正确inconclusive、不建baseline。不要改写历史结果。

## 5. 本机环境和复测入口（可能过期，先核查）

- 版本控制中独立样例：`fixtures/ios-memory-control/`，bundle `com.itestagent.spike.MemoryProbe`，不能覆盖device-lane或其他App。
- 本机临时项目：`/private/tmp/itestagent-memory-tui.s5FS7h`；可能被系统清理。包含个人签名配置，**不可整目录提交或输出**。失效时从fixture按批准范围重新准备，不从文档猜Team ID。
- 可见标题 `iTest Memory Probe`；按钮 `Run Leak Workload` / `Run Released Workload`，完成状态 `Workload complete`。四批0/5/10/15秒工作负载；每进程仅一次。工作负载receipt只证明App动作，不证明Leaks扫描成功。
- 已有API key在本地Keychain。不要打印或要求用户贴密钥，不重新初始化或删除已存凭证。当前真机/WDA/签名可用性必须重新只读核查，旧成功不保证下次仍可用。
- 从测试项目目录运行 `bun <repo>/packages/itestagent-cli/src/cli.ts`。不要从测试项目执行不存在的 `bun run itestagent` 或仓库相对源码路径。
- 本地 `baseline-drive.py` 只是正常TUI的PTY输入适配器和专用Appium owner，不是产品性能替身。最新socket `baseline-compare.sock` 是已结束会话的残留，不要向它复用旧授权；如需新driver先读代码并使用新的socket/唯一证据目录。
- 本轮TUI、专用Appium、xcodebuild/iproxy/xctrace及MemoryProbe应用进程已退出；应用安装、baseline和报告保留。新session不要按旧PID杀进程或广泛pkill。
- raw日志仅在 `~/.itestagent/runs/memory-baseline-tui-1788902920/artifacts/` 和 `memory-baseline-tui-1788903946/artifacts/`。仅提取白名单状态/计数/聚合，不能cat原始日志。更早probe的历史原始XML边界偏差见验证报告§10，不能宣称整个历史G7无例外。

两轮精确原prompt（用于理解已验证配置；不是自动复测指令）：

```text
用这台真机测试 MemoryProbe：启动后确认 iTest Memory Probe 可见，点击“Run Leak Workload”一次，等待20秒，确认 Workload complete 可见，并采集截图。采集内存峰值、内存增长和泄漏，观察70秒，操作后等待10秒。
```

## 6. 推荐下一步（尚待提出具体计划并批准）

1. **先补有效零扫描语义**：读已落盘释放对照的脱敏结构、公开工具状态与生产parser，列出至少3个按证据排序的假设。明确如何区分“有效扫描未发现”与“未扫描/导出失败/不支持/空node”。只有证据足够才设计not_detected接线，先提文件/契约/回归计划给用户确认；需要新真机录制时另外逐动作授权。不得把空XML/exit0直接填0或判健康。
2. **可复现多轮能力**：用已确认Flow/测试资产与轮次定义工作负载、间隔、每轮采样/增长证据及取消。不能暗中重复探索tap。两次独立baseline比较不等于已经实现多轮自动测试。
3. **观察时长职责与短窗口验证**：评估模型把性能70/10秒重复生成动作wait的问题；保持用户20秒业务等待。涉及目标提示/动作约束修改需先批准。设计不会靠长模型等待掩盖采样缺口的真实验证，但不注入假的采集/设备结果。
4. **Simulator/XCUITest和其他性能范围**：新增采集当前仅physical DeviceBackend路线；按US-12.1/12.3及ADR-039逐项列缺口，不能拿真机替代G5-SIM，不能把本轮说成hitches/hangs/launch/crash等全指标已通过。
5. **TUI接受新baseline及阶段收尾**：显式一次性高风险确认；竞争/环境指纹等已知边界见ADR-040。处理DEF-035并完成当前PR审查及任务出口，才考虑T6.12关闭与T6.13签名向导。

DEF-035：全库literal CLI把绝对路径传给相对scenario排除规则，误报feed-memory；changed/index范围不受影响。修复需独立批准的共享门禁代码/测试计划，不能绕过扫描或声称全库CLI已绿。现有记录保持open，不重复登记。

## 7. 检查、提交与接续提示

本次提交前检查结果见性能验证报告§20及Git目录中的T6_12 gate receipt；原始自动测试日志在 `/private/tmp/itestagent-handoff-*.log`。不要用更早3990或3966的数量覆盖本轮记录，也不要把新增22项沙箱skip隐去。

新session可从以下请求开始：

> 读取本handoff、AGENTS、INDEX、task-status和ADR-040，继续Task 6.12全自动内存/泄漏能力。先核对当前分支和PR，基于现有证据提出“有效零扫描/未发现泄漏”的最小实现与验收计划；不要重复已通过的阳性baseline验收，不把空导出当零，不沿用旧真机授权，等我确认计划及本轮高风险动作后再执行。


## 9. 最新接续覆盖（已确认多轮方案，2026-09-08本地）

前述§6为历史建议；最新实现以性能报告§29和ADR-042为准。baseline接受增量已提交推送bc35876至现有PR82；用户随后确认了已确认Flow的同进程多轮方案，当前代码及自动化已验证，未提交。新增`/memory-rounds <flow-id> <count> <interval-seconds>`只修改草稿；完整TestPlan确认后执行独立录制，不重复模型探索。MemoryProbe源码已扩展为每次tap一轮、最多十轮，但此前设备安装仍是旧版，不能直接拿旧fixture验收多轮。

DEF-034/035已resolved；短窗口G5及真实baseline接受已在性能报告§24/§27验证，不重做。零扫描仍未取得可验证完成事实，多轮新增G5待具体授权；其他路线/性能出口仍待完成。不得复用旧build/install/WDA/Flow-save授权或直接更新旧baseline。后续真实证据只提取白名单聚合，原trace/XML/UI保持raw-local-only。保持6.12 in_progress、6.13 pending，未经请求不提交推送、不合并PR。


多轮增量最终门禁：typecheck/lint901文件/G2全量80文件/gitleaks变更扫描通过；全库4047 pass、7 existing skip、0 fail（12564 assertions、373文件、126.35s）。正常PTY三轮闭环使用隔离fixtures通过，不是G5。下一步具体申请见`docs/06-verification/memory-rounds-g5-plan-6.12.md`；当前真机只有discovered，须恢复ready。新Flow尚未保存、新版fixture尚未签名安装。本次实现确认不代表已批准这些新高风险动作。


## 10. 最新真机执行覆盖（UTC 2026-09-09）

用户已回复“授权，iphone已连接”，完成新v2构建/安装、Route B准备与保存memory-probe-positive-rounds-v2；§9的“尚未保存/安装/discovered”是历史状态。真实正常TUI run_01a083d0-2cbe-7000-9f9c-dad11f2f860f第一轮失败，后两轮not_started，旧baseline仍1份且哈希未改。根因已确认是共享Flow定位器把实际428×926 UI坐标按固定1179×2556换算，按钮未命中，fixture零分配；不是业务等待或完成文案问题。已修复为从唯一有效Application边界换算，无证据阻断；回归及实际证据见性能报告§30。修复后的成功三轮G5仍待新授权，不自动重试。

新Flow已经保存，语义SHA256 dd101c1497d108927f690bab8db391921717fc7ff67faab4029ca4e39de7bfd1；下轮只重读复用，禁止拿原“新建Flow”授权覆盖。本轮CLI/Appium/采集/fixture进程已结束，安装和报告保留，不向旧socket输入。私有临时路径/PID记录在本地/private/tmp/itestagent-rounds-runtime.json（只作定位，不能盲用旧PID）；原始证据位于~/.itestagent/runs/memory-rounds-g5-1788917719/artifacts。新一轮具体授权申请见memory-rounds-g5-plan-6.12.md文末；仍不提交推送、不标done。

本轮最终门禁：typecheck/lint902文件/G2通过；全库4057 pass、7 existing skip、0 fail（12577 assertions、374文件、98.86s）。新增测试纯类型修正后typecheck/lint及10项locator定向复查通过，运行逻辑不变。完整证据与重试边界以性能报告§30为准。


## 11. 最新成功复测覆盖（UTC 2026-09-09）

用户单独授权后，正常生产CLI/OpenTUI修复后三轮真机G5通过，run `run_01a083e1-c0ff-7000-8ed8-eaf9b2178548`。18steps/6cases全部通过，3轮独立trace/截图/UI树共9项artifact完整性通过；checkpoint完成计数1/2/3，每轮20分配；每轮峰值/增长/阳性Leaks均collected。汇总峰值58.82867431640625MiB，末轮减首轮终点10.234375MiB。新建1份多轮baseline，旧1份baseline哈希未改（当前共2份）。不是零扫描或其他路线验收。

详见性能报告§31；§10的“成功多轮G5待新授权”为历史状态。本次授权已消费，未自动重试或重写Flow。原始证据位于~/.itestagent/runs/memory-rounds-retest-g5-1788918970/artifacts及canonical run；只允许本地提取白名单聚合，禁止cat原始设备/签名内容。CLI/Appium exit0，xctrace/xcodebuild/iproxy/appium计数0；fixture AUT显式测试清理1→0，安装/Flow/证据保留，不向旧socket或PID发送命令。

此次仅验收和文档，无新生产代码修改；继续沿用§30最终4057 pass/7 existing skip/0 fail及typecheck/lint门禁。尚未提交推送，现有PR82不自动合并。T6.12仍in_progress、T6.13 pending；下一步应处理有效零扫描语义、Simulator/XCUITest新性能采集和其余性能出口，不能把本次成功等同整项完成。


## 12. 下一单元计划（尚未确认/执行）

用户再次要求继续T6.12。有效零扫描公开TOC的图形节点补查仍无完成证据，不修改detected-only契约；详情见性能报告§32。本机已有iOS18.2 runtime，但两台现有booted Simulator归属未知，不使用或关闭它们。下一具体申请已写入`docs/06-verification/simulator-memory-evidence-plan-6.12.md`：专用临时Simulator、无签名fixture构建安装、阳性/释放各一次、明确目标PID绑定、公开xctrace与leaks对照及结束清理。需要用户确认这份新计划与具体Simulator动作，不能沿用三轮真机授权；尚未开始编码/Simulator操作。此为证据spike，成功也不直接宣称正常生产TUI G5-SIM完成。

已同步ADR-039/040、技术选型当前能力摘要，避免历史段落误盖§31实测。当前仍有未提交的多轮实现和实证文档；不擅自提交/推送或合并PR，T6.12仍in_progress。


## 13. 最新Simulator单元恢复点

用户已确认授权§12方案。专用itestagent-memory-evidence-t612（iOS18.2/iPhone16Pro）已创建，临时MemoryProbe v2 unsigned构建/安装成功；WDA首次构建遇ENOSPC，未进入目标PID绑定、工作负载或录制。正向/释放按钮、xctrace、leaks扫描均0次。已停止并关闭专用Simulator，本次关联进程0，两台原有Simulator仍运行；保留设备/安装/证据，不重跑create或删除同名设备。

详细失败与新的恢复申请见`docs/06-verification/simulator-memory-evidence-6.12.md`，原始证据~/.itestagent/runs/sim-memory-evidence-1788920322/artifacts，private owner定位在/private/tmp/itestagent-sim-memory-state.json。约4.52GiB可用空间，待批准清理Xcode DerivedData约9.45GiB和本次失败WDA cache119MiB，再核对>=10GiB工程余量后复用专用设备。缓存清理/重试未获授权，禁止自动执行；不碰原项目、证据/baseline、runtime与既有Simulator。此次无生产代码更改，不宣称G5-SIM或有效零结果。T6.12仍in_progress，无提交推送。


## 14. 用户清理后复测与最新恢复点

§13“缓存清理/重试未获授权”是历史状态。用户已自行清理并回复“已清理磁盘空间，请继续”；Agent未删除任何文件，复查137.98GiB后复用原专用Simulator与安装。Appium/WDA本次成功。阳性/释放各一次工作负载与20分配、0/20释放receipt通过；公开设备/bundle/宿主PID/realpath/启动时间绑定及前后校验成功。本地leaks阳性exit1报17项/4456448bytes，对照exit0报0/0，各有唯一完成summary；这是有效Simulator零扫描样本，不是生产能力或物理零扫描完成。

Leaks+Activity Monitor在Simulator设备目的地均exit2，明确Activity monitoring service not available on this device；无有效峰值/增长与采样coverage。Ctrl-C提示不能证明采集就绪；原probe未检查capture.finish.failed仍推进对照，完整计划未通过。临时probe已加入failed/cancelled阻断并只做语法检查，生产readiness尚未改。原始证据~/.itestagent/runs/sim-memory-evidence-retry-1788924619/artifacts；不要cat原始UI/trace/leaks输出，使用固定标记/聚合投影。

本轮probe/Appium/shutdown exit0，专用Simulator Shutdown、owner进程0，baseline仍2份；保留所有安装与证据。其余booted设备事后1台，未操作其他设备。private state仍在/private/tmp/itestagent-sim-memory-state.json，只用于定位owner，不复用旧PID或直接重跑旧probe。

下一具体申请为docs/06-verification/simulator-memory-host-capture-plan-6.12.md：复用专用设备，新的单次Activity Monitor宿主PID采集，使用公开开始通知和严格失败阻断，仅一次阳性工作负载、70秒观察/10秒settling/30秒余量、owner清理。不重复已取得的native阳性/零扫描，不写baseline或提交。该新采集路径尚未确认，不直接开始。证据充分后再确定生产Simulator/零扫描契约、接线与正常TUI G5-SIM计划。T6.12仍in_progress、6.13 pending，沿用4057 pass/7 existing skip/0 fail及typecheck/lint；详见性能报告§34。

本轮文档收口检查：git diff --check通过，G2 worktree/all 80文件通过，task-status JSON字段与6.12/6.13状态通过，56个变更文件gitleaks脱敏扫描无发现。未重跑全库测试。


## 15. 宿主PID方案已执行，最新停止点

用户已确认§14宿主采集计划。本次复用专用Simulator/安装，139.28GiB可用；4项临时进程guard测试及真实notifyutil握手通过。Appium/simctl/ps目标身份绑定和fresh receipt0/0通过，但唯一一次默认host Activity Monitor --attach返回exit21：Cannot find process for provided pid。实际PID与绑定相同；无真实开始通知、tap0、trace0、样本0，门禁阻断并完成cleanup。不能称为宿主采集可用或正常TUI G5-SIM通过。

原始证据~/.itestagent/runs/sim-host-memory-evidence-1788925514/artifacts；私有state=/private/tmp/itestagent-sim-host-state.json，原设备owner与之前相同，禁止直接复用旧PID。probe exit1、notify取消143，fixture/Appium/shutdown exit0；owner进程0，其他设备状态与本轮开始快照一致；baseline2份且全部哈希未变。不要重跑已消费的授权，也不要重复已有native leaks阳性/零扫描。

简单传参/旧PID错误已核对排除；宿主xctrace目标范围是候选解释，进程在绑定后退出仍因缺少失败瞬间identity而不能完全排除，底层原因inconclusive。未改签名、root或系统权限。详见性能报告§35与主证据报告末节。

下一具体申请docs/06-verification/simulator-memory-footprint-plan-6.12.md已准备，尚未确认：使用公开footprint按精确PID做JSON/计量语义预检，再有界采样与一次阳性操作，严格stop/abort；真实格式/时间/覆盖通过后再决定生产source和TUI接线。只读取了工具帮助，没有footprint目标扫描。6.12仍in_progress、6.13 pending；无生产代码变化，沿用既有4057-pass门禁，未提交推送。

宿主单元收口检查：git diff --check、G2 worktree/all 80文件、task-status JSON/字段/依赖与状态检查通过；57个变更文件gitleaks扫描无发现。没有生产代码变更，未重跑全库测试。


## 16. footprint方案成功，下一步生产接线

用户确认§15 footprint方案并执行通过。原专用Simulator/安装复用；1次格式预检+41次正式样本全部exit0；单位byte/1，唯一process.pid与Appium/simctl/ps/UID绑定一致，使用processes[0].footprint，不使用aux历史峰值或冒充Activity Monitor源。41样本覆盖101.68秒，首尾31.55→37.30MiB、峰值37.63MiB、变化+5.75MiB；一次阳性tap/20秒等待/断言、20分配0释放1轮receipt通过。详见性能报告§36和主证据报告末节。

原始证据~/.itestagent/runs/sim-footprint-evidence-1788964535/artifacts；private state=/private/tmp/itestagent-footprint-state.json（只用来定位owner，不复用旧PID）。probe/Appium/shutdown exit0、backend closed/reusable，owner进程0、专用Shutdown、其他设备状态及2份baseline哈希未改。无leaks重扫、无trace、无删除/覆盖安装/Flow保存/提交推送。

目前已有Simulator native footprint采样和先前native leaks阳性/完成零扫描工具证据；生产MemoryGrowth仍Activity Monitor-only、MemoryLeaks仍xctrace detected-only，不能直接注入新结果。下一明确计划docs/06-verification/simulator-memory-production-plan-6.12.md待确认，覆盖契约/ADR、backend目标绑定与原生采样扫描、engine/报告/abort、baseline skip隔离、自动化及正常TUI两次G5-SIM。不直接开始生产编码；当前成功不代表T6.12或正常TUI G5-SIM完成。

临时校验新增7 pass/23 assertions；生产代码未变，沿用4057 pass/7 existing skip/0 fail和typecheck/lint。6.12 in_progress、6.13 pending。physical xctrace Ctrl-C提示readiness不足仍是后续必改/实测项，不能因native gate通过就声称已修复；Simulator多轮/baseline、XCUITest新增性能及其余出口仍待完成。

footprint单元收口：git diff --check、G2 worktree/all 80文件及任务JSON/字段/依赖/状态检查通过；58个变更文件gitleaks扫描无发现。生产代码未变，未重跑全库。

## 17. 最新接续覆盖（2026-09-09，性能报告§38之后）

§16的生产接线待确认是历史状态。用户随后批准native生产接线及DEF-036入口修复，两组正常生产CLI/TUI Simulator单次内存G5-SIM均通过：阳性run_01a086d5-92dc-7000-ae89-a57bda35ec22、释放run_01a086dd-4659-7000-bad9-de8ca341315f。每组36有效footprint样本、一次tap及20秒业务等待；真实leaks分别20项/5242880bytes和完成0/0。canonical/原始数值/证据完整性及owner收口通过，专用Simulator Shutdown，其他设备与2份baseline哈希不变。DEF-036 resolved，无open延期项；门禁4077 pass /7 existing skip /0 fail，typecheck/lint910文件/G2/gitleaks通过。两组设备授权已消费，不重复运行。

用户要求继续T6.12后，本次只读调查与隔离复现确认physical采集仍以Ctrl-C提示错误放行，且单次启动失败后继续动作、多轮未连接capture.signal。未修改生产代码或启动设备操作。下一具体计划见`docs/06-verification/physical-capture-readiness-plan-6.12.md`，等待新实现范围确认；修复公开通知就绪、持续失败传播及审计保存，代码门禁后另行具体申请真实G5。当前T6.12 in_progress、T6.13 pending，未提交推送；physical零扫描、Simulator多轮/baseline、XCUITest及其他指标保持未完成。


## 18. physical通知门禁实现已通过，下一步G5待授权

用户“确认”批准§17计划。已实现公开Darwin开始通知/独立注册探针、真实exited与输出异常传播、单次/多轮动作阻断、失败audit canonical落盘及用户取消区分。无设备notifyutil握手和owned Bun子进程取消实测通过，不能称真机G5。最终全库4094 pass/7 existing skip/0 fail（12789 assertions、378文件、124.50秒），typecheck/lint913文件通过；首轮新测试夹具越过staging被拒，已修正夹具并完整重跑全绿，未放宽生产边界。详见性能报告§39。

当前只读发现1台iPhone14,8/iOS18.2.1，discovered而非ready。原独立临时MemoryProbe项目及Team配置存在，不证明签名当前有效；未构建安装、准备WDA或运行tap。下一具体申请docs/06-verification/physical-capture-readiness-g5-plan-6.12.md：先连接解锁确认ready，再授权正常单次阳性和多轮第一轮取消两个run，各一个tap，baseline=skip、只读复用既有Flow、owner收口。不复用此前G5授权、不自动重试或向旧socket/PID输入。T6.12保持in_progress、T6.13 pending，未提交推送。

§18最终文档门禁：G2全量80文件、gitleaks全库46.81MB无发现、diff检查通过；既有global Flow四步及语义SHA256只读核对匹配。所有代码与文档保持未提交，下一步只按新的G5具体申请取得授权后执行。


## 19. G5已授权，设备ready；先补baseline正常编辑入口

用户“好的我已经连上iphone了”同意§18两轮G5，生产重新发现唯一iPhone14,8/iOS18.2.1为ready。尚无构建/安装/WDA/Appium/AUT/tap，动作授权均未消费。执行前发现此前计划遗漏：physical正常TUI固定local_auto，不能设置方案要求的skip；真实parser/compiler三种跳过请求均复现local_auto。不能覆盖方案或注入替身，已停在高风险动作前。

下一代码计划docs/06-verification/baseline-plan-edit-fix-6.12.md待确认，补精确baseline草稿修改入口和保留逻辑，不扩schema或Simulator baseline能力。确认后完成代码/门禁即可按原已授权physical-capture-readiness-g5-plan-6.12.md继续，不再索取相同设备动作授权；执行时重查ready和Flow、不复用旧PID。恢复点详见性能报告§40，上一4094-pass门禁不被说成新G5。无生产代码更改或提交推送，6.12 in_progress、6.13 pending。


## Recovery checkpoint (2026-09-09)

The approved baseline editor is implemented. Gates: 4097 pass / 7 existing skip / 0 fail, typecheck, lint (913 files), G2 (80 files) and gitleaks passed. Real CLI/OpenTUI reviewed baseline=skip, minimum70s/settling10s, three memory metrics and the authorized single-tap/20s wait goal. Execution confirmation was rejected by automatic approval usage limits; Enter was not sent.

After the user requested continuation, approval service checks succeeded. The original driver/CLI/Appium were still alive (sandbox process-probe permission errors must not be treated as absent processes). A MemoryProbe AUT was present, although this session remained confirmed=false with no run ID and Appium had no session/launch/click commands. Its ownership is unverified; it was neither terminated nor replaced.

Normal TUI cancellation closed this CLI/Appium with exit0; all three recorded owner processes exited, port4723 and socket were released, and both baseline hashes remained unchanged. AUT cleanup is explicitly unverified. No build/install/WDA/workload/capture was started; both approved G5 action sets remain unconsumed. Ask the user to identify or close the external fixture AUT, then recheck readiness and start a fresh reviewed session. Do not reuse old PIDs/socket. T6.12 remains in_progress, T6.13 pending; no commit/push.
