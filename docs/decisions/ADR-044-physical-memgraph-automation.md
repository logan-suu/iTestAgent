# ADR-044：真机 memgraph 自动诊断与调试会话边界

> 当前范围（2026-09-17，ADR-050）：用户已批准将 physical 有效零扫描及独立 memgraph 自动化延期至 T7.8/DEF-037；T6.12 优先补齐当前 XCUITest/解释/failed-only 出口。以下相关研究记录作为历史证据保留，不再要求继续 probe；未完成能力不标通过。当前清单见 `docs/06-verification/t6.12-exit-matrix.md`。

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

## 待确认补充：固定 Return 宿主探针

现有 AX-only 提交检查未得到明确动作。拟仅通过现有 Computer Use 在独占 macOS fixture 中验证两条固定元数据查询的 Return 提交；执行步骤、候选产物、一次启动/两次提交/五分钟预算及清理边界见 `../06-verification/physical-memgraph-xcode-console-plan-6.12.md` 最新提案。原禁止未知键盘绕过的规则继续有效；用户确认只对该单次宿主探针作显式例外，不采纳生产 CGEvent/AppleScript，不升级固定 helper。状态为待确认，尚未执行或证明可行。

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

## 独立 memgraph 预检第一单元实施（2026-09-09）

用户已确认第一单元。已新增 Swift 公开 AX 只读 helper、TypeScript 有界协议、编译说明和 8 项测试；不启动 Xcode、不请求授权、不读取窗口内容、不操作设备。宿主 eligible 仅表示前置候选，targetVerified 始终 false；任何现有 Xcode 实例一律阻断，不接管。

公开 SDK 核对与 swiftc 编译通过。独立宿主运行识别 Xcode 26.5，返回 blocked/accessibility_unavailable；错误 bundle 返回 xcode_invalid。没有借助 CUA。获授权后的 AX/实例查询分支尚未实测，不宣称捕获可用。临时二进制不作为要求用户授信的固定身份，后续先拟定稳定 helper 安装/签名与权限引导，再批准 B 的实际 UI 操作计划。

新增 8 tests/35 assertions 通过，含真实自有子进程取消/超时及退出等待；全库 typecheck、lint（915 文件）通过；全包正常宿主 207 tests/1281 assertions 通过。沙箱内 206 pass/1 fail 为已有 notifyutil 通知用例，同代码宿主重跑通过。没有生产默认来源变更、新设备 G5、commit/push。

状态：第一单元预检已确认实施；后续捕获/生产架构仍为提案。日期：2026-09-09。关联：T6.12、US-12.3、ADR-023/032/036/039/040/043。

## 背景和已验证事实

US-12.3 AC4：“泄漏结论必须来自真实诊断证据，区分检测到、本次检测未发现与无法检测；内存增长不能直接判为泄漏，未发现不承诺不存在所有泄漏。”

AC7：“真机与 Simulator 能力分别实测，不能以独立后端 probe 或 fixture 单测替代生产链路验收。”

公开 Xcode Memory Graph → Export Memory Graph → 本地 leaks 文件分析已自动完成真机工具对照：阳性 20 项/5242880 bytes、exit 1；释放 0 项/0 bytes、exit 0，均为唯一匹配 PID 摘要。见 `../06-verification/physical-memgraph-zero-plan-6.12.md`。没有人工导出步骤，只有环境阻塞后用户退出 Xcode；这次环境恢复不能成为每轮测试的依赖。

但控制 Xcode 的是 Codex Computer Use，仓库没有独立可发布的对应运行时。生产 `PerformanceCaptureInput` 接收已运行 executable，尚无调试会话准备协议。工具对照先通过 Xcode Run/Run Without Building 启动，再由 Route B 保持同一 PID 执行业务；尚未验证附加任意既有进程、调试器与 xctrace 同时工作、正常 TUI 自动编排，以及 UI 超时后的可靠收口。

## 方案比较

| 方案 | 判断 |
| --- | --- |
| 空 xctrace Leaks 导出判零 | 拒绝，没有扫描完成证据 |
| 用户逐次手动导出 | 拒绝，违反 US-12.3 |
| 产品直接依赖当前 Codex CUA 会话 | 不采用为生产依赖，未证明独立部署、权限和生命周期契约 |
| 产品内有界公开 Accessibility 适配器，继续复用 Xcode/leaks | 推荐先验证；可发布性、权限和可靠性未证实前不接默认生产路径 |
| 延续 xctrace detected-only | 验证期间保留既有语义，不能关闭零扫描 AC |

技术选型允许 Swift“仅用于必要的原生子进程”。候选适配器是小型 Swift 子进程，通过公开 macOS Accessibility 控制 Xcode，TypeScript 负责协议、编排与产物验证；不是自研内存诊断或调试器。它的可行性不能从 CUA 成功推导，必须独立验证。该候选尚未批准或实现，不新增第三方依赖，不调用私有 API。

## 提议的边界

1. **显式来源和前置条件。** 新候选来源 `xcode-memgraph-leaks`，独立于 Simulator `native-leaks`；`scan_snapshot`，明确暂停目标。计划确认前展示需要 Xcode 调试、可能重新部署、全局 UI 占用和版本/权限前置。首版限 physical DeviceBackend、已确认源码项目/构建产物、明确 scheme/configuration/目标的单次流程；installed-only、XCUITest、多轮不宣称支持此来源。
2. **启动发生在动作前。** 独立 readiness/preparation 阶段建立本次调试会话，engine 经 backend 接口协调同一目标。不能在动作后 Run/重装再捕获替代原进程。新安装/重部署和调试准备分别纳入实际高风险动作确认；无此动作不制造重部署权限。禁止自动修改项目、scheme、签名或设备设置。无可用已构建调试产物时显式阻断，另行走既有构建确认流程。
3. **身份绑定。** 核对物理设备 ID、bundle、已确认构建引用、唯一 PID 和可获得的进程启动标识；在调试就绪、WDA 就绪、动作前后、捕获前后验证一致。无法独立排除 PID 重用/目标漂移则不发布诊断，不能只看标题或摘要 PID。
4. **快照与时间序列分离。** 初始验证只请求泄漏快照。联合 memory_peak/growth 前先验证 Xcode 与 xctrace 共存；若可行，连续采样及 settling 完成后停止录制，再暂停捕获。暂停区间不混入正常运行样本或增长曲线。不自动切换已有来源，能力不满足应在确认前给出限制，开始后失败不换路线。
5. **可审计产物。** 自动导出到独占 run 子目录的新文件；不覆盖，不接受用户交来的旧文件作为本轮结果。保存捕获起止、文件创建/修改时间、大小、SHA256、目标绑定和完成状态的 raw-local-only 清单；检查路径在 artifacts 内、非符号链接、时间顺序和文件稳定性。时间戳/哈希单独不证明来源，必须与自动导出过程审计共同验证。
6. **真实扫描。** leaks 只读已验证文件，不将真机 PID 交给宿主直接分析。一次有界命令，唯一匹配摘要；exit 0+0/0 才 not_detected，exit 1+正数才 detected。缺失、损坏、错误、身份变化、取消、超时或多个摘要均无诊断数值；保留具体失败/不可导出状态。复用现有解析规则，不能复用 Simulator 来源标签及环境限制。
7. **独立 owner 与取消。** 本机 Xcode UI 资源需要跨设备互斥，不能仅靠同设备串行。只管理本次会话，遇到用户窗口/调试会话冲突则拒绝接管；关闭自己文档，不强退共享 Xcode。prepare/capture/export/analyze/close 都有期限及 AbortSignal。后台失联不能继续动作；收口未证实则明确失败、保留 lease 冲突信息，不自动再开新会话。过期锁不能仅按时间抢占。
8. **隐私及报告。** 所有原始 AX、memgraph、命令输出留本地 artifacts；stdout/事件/报告只给固定状态、派生数值与 ArtifactRef。不让模型读取内存图或 UI 树来决策。报告区分快照时间与离线分析时间，明确调试器扰动及“本次未发现”的范围；首版 baseline=skip，不与既有来源比较。

## 接受条件与后果

先完成独立适配器的无设备行为检查与故障门禁，再按逐次授权做真实设备验证，最后正常生产 CLI/TUI → canonical 三件套 G5。不得用 mocks 或 CUA 再次对照替代独立运行时验证。联合采样、取消及用户会话冲突必须有独立证据。

增加可发布原生 helper 和 GUI 环境前置；无头运行、被锁屏/被遮挡、AX 权限缺失或版本不支持须明确阻断。UI 节点序号不能持久化复用，不通过猜坐标绕过目标确认。若该候选仍依赖人工恢复才能每轮完成，保持未完成并另提决策，不缩减 AC。

## A2 固定安装提案（待确认）

临时 helper 只读签名检查为 ad-hoc、DR 含 cdhash，不能将固定路径当作升级后权限连续性。拟先构建并校验固定只读 app bundle，再对可审阅的具体版本单独申请系统权限；A2 不请求 AX、不启动 Xcode/设备。详见 `../06-verification/physical-memgraph-helper-install-plan-6.12.md`。

## 2026-09-09 固定 ACK 多语句与 exec 对照通过

独立无目标 CLI LLDB 与一次 Xcode/My Mac 宿主会话均验证：150 字符 `script pass; print(...)` 与 174 字符 `script exec(...)` 各返回一条固定 ACK，分别通过生产 parseMemoryConsoleAck 的严格请求匹配。第二条仅在第一条通过、输入恢复为空且焦点核对后提交。没有目标元数据读取，未进行第三次提交。不能再把“多语句或 exec 一概不被 Xcode 接受”作为根因；完整身份脚本的长度、内容或输出通道仍未区分，短 ACK 不证明完整查询执行或身份绑定。

本轮 launch=1、pause=1、ReturnAttempt=2、resume=1、stop=0。Resume 后 Finished running，正常关闭所属工程及 Xcode；独立进程检查确认本次 Xcode、直属 LLDB RPC、宿主均已退出，应用清单确认 Xcode isRunning=false。初始应用清单过滤误用了 bundleId 字段，空结果不能单独证明初始未运行；随后打开时仅 Welcome、无恢复工程或调试会话。后续 inventory 必须使用实际 id 字段。既有 fixture 哈希一致，无构建、设备、权限、helper 或提交推送动作。

证据：`/private/tmp/itestagent-xcode-syntax-lldb-result.json`、`/private/tmp/itestagent-xcode-syntax-result.json`、`/private/tmp/itestagent-syntax-first-response.txt`、`/private/tmp/itestagent-syntax-second-response.txt`。本轮仅诊断与文档，沿用最近 255 pass 的代码门禁，JSON 及 git diff --check 校验。T6.12 保持 in_progress；下一缺口是完整固定身份脚本的提交/输出，生产捕获、物理绑定和 G5 尚未完成。

## 2026-09-16 等长固定 ACK 也未获 Xcode 响应

恢复检查发现历史临时根路径仅余目录，旧源码、工程文件和可执行文件已不存在。未启动旧工程；在新独占临时根恢复同样仅 alarm(60)+pause 的 C 程序，显式 macOS、独占 DerivedData、CODE_SIGNING_ALLOWED=NO 预构建一次成功。新产物 SHA256 为 d239145b49c89487139caa000c8cfd64df6a3fc244fe809c4b9a9b39c06d400b；位置记录于 `/private/tmp/itestagent-xcode-length-fixture.json`，不当作历史相同二进制。

先行无目标 CLI LLDB 对照：1803 字符固定 ACK（短 print 加无行为注释，与旧 compact 查询等长）及 2220 字符阶段查询全部固定 ACK 通过严格匹配，exit 0、stderr 空。阶段查询在原样 compact 源码加载前/后及 emit 返回后打印固定请求标记，未减少身份校验。准备与结果位于 `/private/tmp/itestagent-xcode-length-review.json`、`/private/tmp/itestagent-xcode-length-cli-result.json`。

随后一次 Xcode 对照：初始用正确 id 字段确认 Xcode 未运行；仅 Welcome，新临时工程/My Mac 核对后 Run Without Building 一次，Pause 后聚焦空 LLDB 输入。1803 字符原文写入、焦点核对后一次 Return；即时与完整 AX 状态均无匹配 ACK，生产解析器判定 false，只有一个可见提示符、命令仍可见。未提交第二条阶段查询，未重试，没有目标身份读取。完整查询内容不是出现“无响应”现象的必要条件；长度/布局相关的提交或输出观察问题优先，但没有证明精确长度阈值，也不能确定命令完全未执行。短命令成功证据来自上轮，夹具已重建，不宣称本轮进行了同会话短/长配对。

一次 Resume 后宿主自然 Finished running，无需 Stop；正常关闭文档/Xcode，独立 ps 核对本次 Xcode/直属 LLDB RPC/宿主均不存在，最终应用清单 isRunning=false。计数 launch=1、pause=1、Return=1、resume=1、stop=0；结论 long_fixed_ack_unverified。摘要 `/private/tmp/itestagent-xcode-length-result.json`，owner `/private/tmp/itestagent-xcode-length-owner.json`。

当前缺口优先为长命令提交/输出观察。后续应先对同会话输入/响应边界建立可靠观测，再评估固定源码短加载方案；不能因短 ACK 成功就切换生产门禁或放宽身份条件。本轮无生产代码变更；CLI 固定 ACK 检查、临时构建、JSON 和 diff 校验通过，255 项性能包测试仍是历史证据，未宣称重跑。未操作设备、权限、固定 helper 或提交推送。T6.12 in_progress，物理绑定、capture/export、全资源清理与生产 G5 仍未完成。

## 2026-09-16 独立回执未出现；144 字符固定脚本加载候选通过 CLI 身份对照

一次同会话短/长对照已完成。初始 Xcode 未运行，只打开哈希已复核的新临时 macOS 工程/My Mac；一次 Run Without Building/Pause。144 字符短 ACK 严格解析成功，确认独占目录的 xcode-receipt 不存在后，在空输入框写入 1803 字符命令并按第二次 Return。该命令仅独占写固定 UUID 回执并打印 ACK，不读目标数据。没有匹配输出，也没有回执文件，收口后仍不存在；不能用 CLI 的另一 cli-receipt 文件替代 Xcode 证据。

完整 AX 按控件区分后观察到：长命令位于 Console 输出区，debug console 输入控件为空，当前焦点仍为该输入控件；未观察到 SyntaxError/Traceback/NameError/PermissionError/FileExistsError/error:。因此“命令仍可见”不足以推断它留在输入区。没有文件不能区分提交后处理阻塞和执行失败；也不能仅解释为 ACK 显示遗漏。没有第三次提交或重试。一次 Resume 后 Finished running，正常关闭工程/Xcode；本次宿主、直属 LLDB RPC、Xcode PID 独立检查均不存在，应用清单 isRunning=false。摘要 `/private/tmp/itestagent-xcode-receipt-result.json`，准备 `/private/tmp/itestagent-xcode-receipt-review.json`。

随后仅在独立 CLI LLDB 评估短加载候选：将随包固定 Python 源码原样复制到独占 0700 临时目录，以 0400 新文件保存；固定 `runpy.run_path(...)["emit"]` 命令为 144 字符，调用仍只提供本轮 UUID，完整字段及拒绝逻辑不变。原源码 SHA256 79db65f1e0287380150d12bb5a931e826b210ced13de0c2623c61f8cf837a3c7。真实 LLDB 同一进程的原命令与短加载命令经生产解析器校验身份一致，重启后实例改变，原夹具退出/缺失目标保护及所属清理通过。exit 0、stderr 空。证据 `/private/tmp/itestagent-loader-cli-result.json`；下一 Xcode 候选准备 `/private/tmp/itestagent-xcode-loader-review.json`，xcodeExecuted=false。

CLI 前两次沙箱内尝试失败：首次缺少夹具结果文件，补充诊断后定位为 fixture.launch_failed，后续 fixture 未定义；LLDB 本身仍 exit 0，不能仅看退出码判成功。首次后独立检查未遗留宿主或 LLDB。经工具审核授权在沙箱外执行同一夹具后通过，支持启动环境差异的解释；未放宽成功条件。临时诊断保留失败记录，不将前两次计为通过。

下一步是单次 Xcode 验证这个短加载候选，再决定独立 helper 的固定源码路径、完整性与生命周期接线；CLI 成功不证明 Xcode 或生产能力。临时只读文件不是对同用户恶意修改的安全隔离，不能作为最终可信安装机制。本轮没有修改生产代码、安装 helper、操作设备/权限或提交推送；JSON 与 diff 校验通过，历史 255 项包测试未重跑。T6.12 保持 in_progress，完整捕获、目标绑定和生产 G5 尚未完成。

## 2026-09-16 短加载在 Xcode 返回完整身份，宿主匹配与退出通过

用户继续后完成一次已限定 Xcode 短加载验证。预先核对只读、非符号链接固定源码 SHA256 与既有 fixture 可执行哈希，初始 Xcode 未运行。仅打开新临时 MemoryIdentityProbe/My Mac，以一次 Run Without Building 启动并 Pause。短 ACK 经一次 Return 返回并通过生产严格解析；重新核对空输入与焦点后，提交 144 字符固定 runpy 加载命令一次，返回恰好一条同请求号、status=observed 的完整身份响应。没有重试或第三条命令。

生产 parseMemoryDebuggerIdentity 校验通过，宿主路径经 realpath 匹配既有 fixture，主模块 UUID 与 xcrun dwarfdump --uuid 实际产物一致；独立 ps 核对返回 PID 属于本次 fixture，LLDB RPC 是本次 Xcode 的直属子进程。这是单次宿主关联证据，不证明跨时刻 PID 连续性、物理设备 ID/bundle/构建绑定或原生 helper 提交可靠性。本次未做第二次身份查询，不能宣称同会话两次身份稳定已在 Xcode 复验。

一次 Resume 后 Finished running，无需 Stop。关闭工程后 CUA getAXState 返回 noWindowsAvailable，未重新启动或恢复窗口；正常 Quit 后独立 ps 确认本次宿主/RPC/Xcode 均不存在，最终应用清单 isRunning=false。没有将 noWindowsAvailable 本身当完整清理证明。launch=1、pause=1、Return=2、resume=1、stop=0。

证据：`/private/tmp/itestagent-loader-identity-response.txt`（仅白名单元数据、本地）、`/private/tmp/itestagent-loader-identity-validation.json`、`/private/tmp/itestagent-xcode-loader-owner.json`、`/private/tmp/itestagent-xcode-loader-result.json`。固定源码哈希 79db65f1e0287380150d12bb5a931e826b210ced13de0c2623c61f8cf837a3c7，宿主产物哈希 d239145b49c89487139caa000c8cfd64df6a3fc244fe809c4b9a9b39c06d400b。

短加载是已取得一次 Xcode 实证的候选，解决本次完整身份响应获取；不能据此断言此前长命令失败的精确根因或长度阈值。下一实施单元应把固定脚本来源/完整性、短加载命令与严格响应/owner 身份复查接到独立 helper，保持失败关闭、取消与资源清理门禁；临时源文件和 CUA 不能直接充当生产实现，也不自动升级已安装 helper。后续仍须原生通道验证、物理目标绑定、capture/export、生产接线及 G5。

本轮无生产代码变更、无构建/设备/权限/helper/baseline 动作，未提交推送。JSON 与 diff 校验通过；既有 255 项性能包证据仍为历史检查，未宣称重跑。T6.12 保持 in_progress。

## 2026-09-16 B 原生固定脚本加载器单元

验证：全部 opt-in 宿主性能包 256 pass/0 fail、1596 assertions、34 文件（26.31 秒）；补充 FIFO/目录/空文件负例后的定向原生用例再次 1 pass/0 fail（9 Bun assertions）。typecheck、lint（933 文件）与 git diff --check 通过。日志 `/private/tmp/itestagent-native-script-package.log`、`/private/tmp/itestagent-native-script-types.log`、`/private/tmp/itestagent-native-script-lint-final.log`。未重跑全库或 G5/G5-SIM。

在已确认 B 范围新增 `native/itestagent-memory-identity-script.swift`。PreparedMemoryIdentityQuery 只从指定 App bundle 的固定 Contents/Resources/itestagent_memory_identity.py 解析资源，不接受任意文件名、模块、源码或命令。编译时固定 SHA256 与随包源码一致；有界读取拒绝符号链接路径、硬链接、非普通文件、空/超大文件，使用 O_NOFOLLOW/O_NONBLOCK 避免被替换的 FIFO 在 open 时阻塞。读前后 fstat 核对，保存 dev/inode/size/mtime/ctime，生成命令前复核；调用方应在接收响应前再次 validateSource，替换为相同内容的新 inode 也拒绝。

请求仅接受规范小写 UUID，路径以 JSON 字符串编码形成固定 runpy 加载命令。1024 字节是传输预算，不声称 Xcode 长度阈值已验证。取消、单调期限、会话归属在读取前后检查，归属检查耗时后再检查取消/期限。仅返回待提交命令，不设置 targetVerified/submissionVerified，不自动执行 UI、发布 ready 或释放 lease。这个检查不是抵御同用户恶意瞬时修改的隔离机制；最终调用者仍需可信安装校验、源文件复核及真实身份/owner 校验。

新增真实 Swift fixture 及 Bun 集成测试：固定资源与被改/被替换文件、缺失文件、软/硬链接、FIFO/目录、空/超大文件、取消/归属漂移/截止时间，及带引号的 bundle 路径。Swift 构造的真实命令在无目标 CLI LLDB 中输出同请求的 unverifiable，确保不伪造目标存在。未安装升级固定 helper，尚未把此模块接到现有只读 preflight 可执行入口；原生 AX 提交/响应采集、目标绑定和完整会话接线仍需后续单元。不得把 CUA 成功当原生提交能力。

## 2026-09-16 B 原生增量响应接收单元

验证完成：启用全部 opt-in 宿主性能包 257 pass/0 fail、1603 assertions、35 文件（27.75 秒）；typecheck、lint（934 文件）、git diff --check 通过。日志 `/private/tmp/itestagent-console-response-package.log`、`/private/tmp/itestagent-console-response-types.log`、`/private/tmp/itestagent-console-response-lint.log`。没有重跑全库或 G5/G5-SIM。

新增 `native/itestagent-memory-console-response.swift`，从已归属且独立定位的输出元素读取字符数与 AXStringForRange，不读取完整 AXValue、不发现/接管窗口、不请求权限、不写入或发送键盘事件。创建接收器时记录输出边界并只读最后一个字符判定行边界；提交前已有输出和已有未完成行不成为本轮候选。真实 output 元素定位及提交仍由未来 transport 负责，不能把此前 focused text area 候选直接当输出控件。

每次读取前后检查 owner/context、取消、单调期限，AX 消息最多 0.5 秒；单次及累计最多 16384 UTF-16 单元、保留内容最多 32768 UTF-8 字节、单条响应最多 8192 字节。输出清空/缩短、范围不一致、超量、无效前缀 JSON、重复同请求候选、归属漂移和错误均关闭接收器，不重试。分段未完成行、仍在增长的快照继续等待原期限；CRLF 按 UTF-16 换行拆分。忽略普通回显和不同 requestId，仅返回一条本轮固定前缀候选，成功后关闭接收器。所有缓冲保持本地，退出时清空，不记录原始控制台文本。

候选不是可信身份。现有 TypeScript parseMemoryDebuggerIdentity 仍须严格校验完整字段和请求，随后另行完成 owner/设备/构建绑定；本模块不发布 prepared/readiness 或清理证明。接收前后复用 PreparedMemoryIdentityQuery.validateSource 检查源码没有变化。新增 fixture 验证分段/CRLF/Unicode 偏移、历史/旧请求/旧半行、重复、清空、超量、取消、超时、归属漂移及读取后资源变化；公开 AX 适配器对不存在的进程失败关闭。跨 Swift→TypeScript fixture 验证候选经既有解析器处理，错误请求/无效 PID 拒绝。没有读取真实 Xcode 输出或任何设备证据。

首次编译发现 Int32 与 CFIndex 算术类型不一致，修正显式转换。随后 CRLF 正例失败，确认 Swift Character 分隔不能正确按独立 LF 处理 CRLF，改用 NSString UTF-16 分隔与末尾 LF 字节判断后通过；这是新接收器的实现问题，不宣称它是之前 CUA 长命令故障根因。

现有确认仅覆盖 CUA Return 对照，没有扩大到原生 CGEvent/任意键盘注入；本单元遵守该边界。提交动作、原生输出元素解析/能力验证、完整 session/native helper 接线仍待完成，当前安装的只读 helper 不变。未操作 Xcode/iPhone/权限或提交推送，T6.12 保持 in_progress。

## 2026-09-16 B 原生控制台配对定位与接收绑定

验证：性能包启用全部 opt-in 后 258 pass/0 fail、1607 assertions、36 文件（31.95 秒）；随后取消/期限分类修正的两项原生定向测试 2 pass/0 fail、11 assertions（6.93 秒）。typecheck、lint（935 文件）与 git diff --check 通过。日志 `/private/tmp/itestagent-console-location-package.log`、`/private/tmp/itestagent-console-location-targeted.log`、`/private/tmp/itestagent-console-location-types.log`、`/private/tmp/itestagent-console-location-lint.log`。未重跑全库或 G5/G5-SIM。

新增 `native/itestagent-memory-console-location.swift`，复用既有唯一工程窗口/Debug Area/焦点/owner 定位，对同一 Debug Area 中公开 AXDescription 的 `debug console` 与 `Console` 作显式配对。输入必须是当前焦点，输出必须是不同元素且唯一。只把此前 CUA 观察的英文元数据当待原生验证候选，不按兄弟顺序、坐标或数字节点 ID 推断；未知/本地化/缺失描述、重复配对、输出在区域外均失败关闭。

对候选输出实际请求字符数与最多一个 UTF-16 单元的 AXStringForRange（空输出也请求零长度范围），验证范围 API 可用与返回长度；不读取整段控制台。随后重新解析工程上下文、配对及 owner；读期间出现窗口/sheet、工程/focus/输出实例或标签变化、取消/超时均拒绝。复用 512 节点/16 层/64 子节点预算与 0.5 秒 AX 消息上限。这个探针只证明当前输出元素的一次范围调用可用，不证明输入语义或提交能力。

新增 prepareLocatedMemoryResponseReceiver，把固定脚本 query、配对输出和既有增量接收器连接；每次接收检查会重新解析同一配对，而非仅信任缓存 AX 元素。创建前仍由调用方证明自有 launch/lease；提交动作未实现，不请求权限或引入键盘注入。绑定时发现接收器会把上下文复查期间发生的取消/期限耗尽误分类为 context_changed，现优先复查取消/期限并补负例，保留正确失败原因。

原生 fixture 覆盖正确/重排/空输出、聚焦输出而非输入、缺失/未知/本地化/重复描述、区域外输出、范围不支持/长度不一致、工程/焦点/标签/输出替换/owner 漂移、取消/超时及后出现 sheet。仅模拟结构与本地公开 API 编译；没有真实 Xcode AX 访问，不把 fixture 成功当原生真实宿主门禁。现有工程 URL 严格匹配策略未改变，路径别名兼容仍需单独验证。

下一缺口是原生提交动作和完整 helper/session 接线，再进行原生真实宿主与物理绑定验证。固定 helper 未安装升级，无 Xcode/设备/权限动作，未提交推送，T6.12 保持 in_progress。

## 2026-09-16 B 公开 AX 受控提交与一次性查询流程

验证：定向原生测试通过；启用全部 opt-in 的性能包 259 pass/0 fail、1611 assertions、37 文件（36.61 秒）；typecheck、lint（936 文件）与 git diff --check 通过。日志 `/private/tmp/itestagent-console-submit-package.log`、`/private/tmp/itestagent-console-submit-types.log`、`/private/tmp/itestagent-console-submit-lint.log`。未执行全库或 G5/G5-SIM。

新增 `native/itestagent-memory-console-submit.swift`。MemoryConsoleSubmission 只接收此前验证的 PreparedMemoryIdentityQuery；检查当前 owner/context、取消/期限和源码指纹，要求输入内容严格为 `(lldb) `、光标位于末尾且无选区、AXSelectedText 可写、公开动作列表明确包含 AXConfirm。缺少任何条件时在写入前失败；不根据 AXValue 可写、AXPress 或 CUA Return 成功推断提交能力，不提供 CGEvent/键盘 fallback。

使用 AXSelectedText 只在空末尾插入固定命令，不替换整段 AXValue 或移动焦点/选区。写入后再次核对完整输入、光标、能力、源码与上下文，再调用一次 AXConfirm。每次调用均设置最多 0.5 秒消息期限并复查取消/截止；动作尝试标记在调用前记录，错误/超时不代表没有副作用。任何失败都消费本对象的单次额度；不清空输入、不重试或补发按键。返回仅代表 AXConfirm 调用成功，不能发布提交已验证或 target ready。

MemoryConsoleQueryExchange 在写入前创建输出增量边界，串联提交与接收：未提交不能 poll，提交失败后不能恢复/接收成成功，响应候选返回后终止本次对象。工厂将此前唯一输入/输出定位与每次重新解析的 context 闭包接入流程，保留动作尝试标记供后续 owner 收口。候选仍须现有 TypeScript 严格语义解析和目标/构建绑定；没有以候选存在判 observed 或 readiness。

原生 fixture 验证空/非空输入、非空选区、不支持/仅 AXPress、不可写、错误写入内容、插入失败或确认失败的结果不确定性、单次消费、写后取消/期限/owner/能力/源码变化，以及完整合成查询/失败后禁止 poll。公开 AX 实现仅编译，没有对真实 Xcode 执行动作。本单元不声明实际 AXSelectedText/AXConfirm 可用，也不把严格空 prompt 假设视为已原生实测；支持不足必须显式返回 unsupported，不能放宽门禁。

后续仍需将流程纳入临时候选 helper，验证实际 Xcode 原生能力和 owner/session 生命周期，之后才具备真实设备绑定/capture/export 生产接线条件。已安装 helper 未升级；无 Xcode/设备/权限动作，无提交推送，T6.12 保持 in_progress。

## 2026-09-16 原生能力观察权限边界

独立只读 App 候选的 CLI/App preflight 均 AXIsProcessTrusted=false；旧 CUA/固定 helper 授权不能被假定覆盖新进程。本轮仅临时构建、签名验证和无 Xcode preflight，正常退出已证实。新 App 安装、辅助功能授权及一次宿主只读观察的具体范围见 console plan 顶部，尚待用户确认。能力结果不代表提交成功或生产 owner/readiness；不以键盘 fallback 绕过权限阻断。

## 2026-09-17 原生只读观察结果

新 App 经用户确认与 Touch ID 后 AX trusted preflight 通过；单次宿主观察返回 observation_conflict，在任何控件读取前失败。组合实例门禁不能区分前台/PID/路径/注册状态，根因仍 inconclusive；不得放宽门禁或宣称 AXConfirm 不支持。一次 Resume、正常关闭/Quit、独立所属进程退出检查通过，单次范围已消费。下一步先补离线可区分诊断，不自动升级已授权 App 或重跑。详见 console plan 顶部。

## 2026-09-17 实例观察诊断单元

已实现固定原因/可选布尔检查值，405 组合验证保持原门禁，无原始 PID/路径/UI 输出。临时只读 0.1.1 候选已准备未安装/执行；实际 Xcode 初始实例错误尚无可区分实证。升级、可能需要的正常 AX 重新授权和单次宿主复检范围见 console plan 顶部，待确认。性能包 252 pass/8 opt-in skip、静态检查通过，未新增 G5。

## 2026-09-17 0.1.1 真实宿主观察

用户确认升级并手动移除旧单项 AX 记录后，新版正常添加与 trusted preflight 通过。一次宿主初始实例检查全部通过，后续 bounded_observation_failed，未得到控件能力。所属宿主/RPC/Xcode 正常退出已独立核验，单次范围消费。下一离线诊断应完整覆盖所有 AX 阶段/错误类型且不输出原始值；不放宽门禁、不推断 AXConfirm 不支持，不自动再次升级/执行。详见 console plan 顶部。

## 2026-09-17 AX 诊断政策

固定 stage/operation/cause 和 AXError 数字白名单替代统一未知错误，记录有界节点/深度/耗时，禁止记录 raw UI 值或异常文本；首错冻结，未知能力读取失败关闭。289 合成组合与性能包253 pass/8 skip通过。临时0.1.2仅编译签名，未升级/执行；真实AX原因未证实，后续具体单次升级复检范围见console plan，待确认。

## 2026-09-17 文档匹配诊断实证

0.1.2 单次真实宿主实例检查通过，固定诊断定位 document/document/mismatch，未进入控件树。独立离线同工程目录 URL 尾标记差异复现 URL 相等 false、规范 path 相等 true；证明当前算法存在误拒绝，但缺少本次原生 AXDocument 原值，不能认定该 live 失败唯一根因。正常收口与独立所属退出通过，单次额度消费。下一离线受限本地文档等价修复计划见 console plan 顶部；不放宽到标题/文件名匹配，不自动升级或重跑。

## 2026-09-17 本地文档绑定修复

使用受限本地URL解析、realpath、现存目录描述符及设备/inode替代目录URL表示相等；尾标记/本地别名等价，非法URL/不同目录/替换拒绝。context中绑定仅覆盖单次解析，不代表完整session连续性。已接入原生context及未安装的0.1.3候选，离线254 pass/8 skip和静态检查通过；真实Xcode验证待具体升级复检授权。无生产目标/readiness语义扩张。

## 2026-09-17 公开AX提交能力的实际边界

0.1.3单次原生只读宿主观察完整通过，文档绑定修复得到真实验证。输入AXSelectedText可写、空prompt/末尾空选区及输出范围可读，但confirmAdvertised=false。现有显式AXConfirm提交门禁必须拒绝，不把CUA Return证据提升成原生生产通道。下一步先决策新的受限提交路径，未经具体范围确认不引入键盘注入/AXPress/AppleScript，不自动重跑。正常收口与独立所属退出检查通过，B完整自动化及T6.12仍未完成。

## 2026-09-17 替代提交决策提案

公开AXConfirm缺失后的选择与新授权边界已单列ADR-045-bounded-native-console-return.md（Proposed）。推荐先确认固定pidReturn离线实现，不变更现有禁止自动键盘fallback规则，不授权真实输入。批准实现不等于接受生产路线或通过G5。


## 2026-09-17 显式Return离线实验

ADR-045第一阶段已获用户确认并实现：共享固定输入/源码门禁、原实例定向Return适配器及无副作用状态机测试。原AXConfirm默认与禁止自动fallback不变；未安装/运行真实事件适配器。void发送与配对释放均不证明delivery；完整owner/token/授权接线和G5仍未完成，不构成生产采用决策。

## 2026-09-17 ADR-049文档关闭来源补充（已确认）

用户已确认[ADR-049](ADR-049-xcode-document-process-closure.md)。document.closed可由保留原Xcode owner在期限内实际终止证明其进程内文档生命周期结束；不代表磁盘归属、保存成功或外部进程退出。额外未修改文档下Quit必须明确披露并取得本次动作授权，完整快照/目录binding/原owner复查仍必需。debugger、AUT、helper仍独立证明，unknown仍阻止完整lease释放。该条仅修订过去“Xcode实际退出也不能作为任何文档关闭来源”的绝对表述，窗口/PID消失或Quit请求仍不足。首个实现接诊断App，生产接线与真实G5未完成。
