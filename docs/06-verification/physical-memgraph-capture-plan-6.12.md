# T6.12 B：独立 Xcode 自动捕获实现计划

## 2026-09-17 文档 URL 等价修复通过离线回归

新增受限本地工程目录 binding，以完整 canonical path+保留目录描述符的设备/inode 匹配，接受尾斜线/本地别名，拒绝非法URL/缺失/文件/不同工程/目录替换。原生 context 单次解析与临时0.1.3探针已接入；不宣称跨解析身份连续或真实Xcode已通过。已安装0.1.2未动。

四项定向原生测试通过；性能包254 pass/8 opt-in skip/0 fail、1570 assertions/40文件，typecheck/lint939/diff通过。0.1.3候选编译签名完成，升级/单项AX授权/一次宿主只读复检方案及锁定哈希见console plan顶部，待确认。本轮无Xcode/设备/系统权限/提交推送，T6.12 in_progress。


## 2026-09-17 AX 全阶段固定诊断单元完成

新增阶段/操作/原因枚举诊断，保留首错，错误码及预算/耗时有界，无原始文本。289 组合合成测试通过；临时只读 0.1.2 候选已编译/签名，未安装或执行，已安装 0.1.1 哈希不变。原失败的具体 AX 阶段仍待实证。候选哈希与新备份安装、单项 AX 授权及一次宿主复检范围见 console plan 顶部，待确认。

性能包 253 pass/8 opt-in skip/0 fail（1566 assertions/39文件），typecheck/lint938/diff通过；未跑全库/G5。本轮无 Xcode/设备/权限/提交推送，T6.12 in_progress。


## 2026-09-17 实例门禁诊断完成，升级/宿主复检待确认

新增固定 AppKit 观察诊断模块与 405 组合合成验证；原放行条件不变，未知值不伪装 false，完整白名单检查值保留。0.1.1 临时只读探针已编译/签名验证，未安装或执行；旧版哈希不变。具体文件/哈希及升级备份、AX preflight、一次无设备宿主复检范围见 console plan 顶部，等待确认，不能把旧系统授权当新版升级许可。

性能包沙箱内既有通知握手失败，沙箱外同命令 252 pass/8 opt-in skip/0 fail（1562 assertions/38 文件）；typecheck/lint937/diff 通过。没有本轮 Xcode/设备动作、全库或 G5。原 observation_conflict 根因仍 inconclusive，T6.12 in_progress，无提交推送。


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


## B 首个可验证单元（2026-09-09）

用户已确认 B 计划。已实现 backend 内部 `xcode-memory-session.ts`：严格版本/会话/序号/阶段协议、确认目标匹配、进程世代一致性门禁、取消后仅收口、全局 helpers-root lease、清理未确认保留锁及防误删 owner。新增 `xcode-memory-export.ts`：仅接受已确认 exported 阶段，校验独占私有目录、文件路径/链接/属主、捕获时间、文件稳定性和摘要，输出不包含原始字节；协议取消及 AbortSignal 均拒绝导出结果。

这些接口尚未连接原生 helper，不代表实际会话或捕获已实现。真实 metadata 身份入口固定 unknown，不生成伪世代。现有固定 helper、AX 权限、Xcode 和设备均未修改；没有 commit/push。

验证：新增 9 tests/46 assertions 通过；性能包正常宿主回归 235 pass/0 fail/1410 assertions（随后增加协议取消导出断言，定向回归通过）；typecheck 与 lint 924 文件通过。沙箱中的已有 notifyutil 用例失败，未修改该用例，宿主含六项无设备原生 fixture 的回归通过。

### 尚待解决的身份提供方

本机 `devicectl device info processes --help` 及既有工具证据没有已验证的进程启动/世代字段。宿主独立 LLDB 文档查询确认 `SBProcess.GetUniqueID()` 存在；[LLDB 官方说明](https://lldb.llvm.org/cpp_reference/classlldb_1_1SBProcess.html)描述它区分调试器中的进程实例。这是候选，不能从另一个 LLDB 实例查询 PID 后冒充 Xcode 所属实例，也不能将调试器对象 ID 当系统启动时间。

接下来必须验证通过独立 helper 的公开 Xcode 调试控制台读取固定、只读 LLDB 查询，并绑定本次 Xcode owner、目标设备/构建、所选 process 与连续会话；不可接受任意脚本输入或修改用户 lldbinit/scheme。尚未实现或执行该路径，也未宣称它可行。若公开访问无法提供充分证明，按 ADR-044 保持 target_identity_unverifiable；不能为继续捕获而降成仅 PID 比对。

剩余 B：真实身份提供方、公开 AX 动作适配、prepare/capture/export/close 的原生 transport 和取消收口；随后才是候选构建审阅、固定升级、具体真实动作验证及 C/D/E 接线。此处记录实际完成的第一单元，不把缺失实现改记为测试限制或完成。


状态：已确认；首个协议/产物校验单元完成，原生捕获未完成。2026-09-09。关联 ADR-044、US-12.3。

## 恢复点与验收约束

A4 固定 0.2.0 helper 已升级、保留旧版本备份并重新添加辅助功能权限。独立 App transport 复检为 eligible/xcode_not_running、targetVerified=false、Xcode 26.5、cleanupVerified=true。已通过性能包 226 tests/1365 assertions、typecheck 和 lint；这些结果仅覆盖既有实现。B 尚未实现。

AC6 原文：“复用公开工具，不逆向 trace；原始 trace/XML 不进入模型上下文。取消贯穿录制、等待、导出及所属进程清理。”

ADR-044 原文：“无法独立排除 PID 重用/目标漂移则不发布诊断，不能只看标题或摘要 PID。”

既有工具对照的进程记录仅含 executable、processIdentifier，没有启动标识。同路径、同 PID、请求 UUID 或连续轮询均不能单独证明进程世代。本计划不放宽该门禁；公开工具无法提供充分证据时返回 target_identity_unverifiable，生产接线继续保持未完成。

## 拟实现文件及职责

路径均相对 `packages/itestagent-backends/performance-xctrace-analyzer/`。

| 文件 | 变更 |
| --- | --- |
| `src/xcode-memory-session.ts`（新增） | 内部 prepare/capture/close 会话接口；全局 Xcode lease、严格序号协议、期限和 AbortSignal；注入目标身份读取接口，不互调 DeviceBackend |
| `native/itestagent-xcode-memory-helper.swift` 及按职责拆分的新 Swift 文件 | 保留只读 preflight；增加明确 session 模式、公开 AX 查询和有界动作、独立会话状态机、导出审计；只返回白名单阶段和错误码 |
| `native/itestagent-memory-launcher.swift`、`src/xcode-memory-app-launch.ts` | 扩展 session 生命周期，先请求 helper 收口 Xcode，再验证 helper 退出；不能沿用只适合预检的超时后直接终止策略来宣称资源已清理 |
| `src/xcode-memory-helper-install.ts`、`native/README.md` | 将新增源码纳入构建与完整性清单；仅构建临时候选，不自动覆盖已授信固定版本 |
| `test/xcode-memory-session.test.ts`、原生 fixture 测试 | 协议、动作前置、身份缺失、用户干预、导出路径、取消和 owner 退出负例；真实无设备 fixture 检验原生生命周期 |

接口输入绑定已确认的 project/workspace、scheme/configuration、物理设备 ID、bundle、构建引用与独占 artifacts 目录。单次动作许可绑定会话和操作，不接收任意命令、任意 AX 路径或永久 allow。此单元保持 backend 内部接口，C/D 再接 contracts、PermissionEngine 和正常 TUI。

## 会话与动作规则

1. `preflight → preparing → prepared → capturing → exported → closing → closed`；失败和取消进入 closing，不能回到 prepared 重试已执行动作。prepared 只在独立目标绑定通过后发出，不从 helper 启动成功推导。
2. lease 位于 helper 安装版本之外的同一本地 helpers 根，覆盖本机 Xcode UI，而非单个设备/候选安装目录。未知或清理未确认的 lease 阻断，不按时间自动接管。
3. 初始存在任何 Xcode 实例则阻断。公开 NSWorkspace 启动只归属本会话的新实例；验证无恢复的用户窗口后才打开明确项目。控件使用当前 AX 元素、角色和标识定位，歧义/窗口漂移/用户介入均停止；不猜坐标、不保存节点序号。
4. 调试启动必须在业务动作前；首个候选仅允许已确认且存在的调试构建走 Run Without Building。若需要构建、重新部署或改配置而缺少对应单次许可，停止并返回明确前置。禁止启动失败后自动 Run 或更改 scheme/签名；动作后不能重启 App 补捕获。
5. 公开来源的身份读取作为显式 proof/unknown 结果，验证设备、构建、bundle、PID 及进程连续性证据。实现阶段先核对现有公开工具/SDK能否取得所需证明；fixture 只能覆盖协议，不能使真实目标默认 verified。无法证明时禁止业务放行或诊断发布，并记录阻断点。
6. capture 仅对准备好的同一调试会话执行 Memory Graph 和 Export。每阶段有截止时间，取消后不再派发新动作。导出到本轮新建目录内的新文件；存在、链接、路径逃逸、错目标、过期、不稳定或未完成文件均拒绝。保留捕获时间、大小、摘要和导出动作审计，原始内容仅 raw-local-only。
7. TypeScript 失联通过 launcher/helper 生命周期通道触发收口；helper 先处理所属调试会话和文档。出现未知窗口/保存对话框/所有权不明时不强退共享 Xcode，不按进程名杀 AUT。超时或强制终止不能算 cleanupVerified；保留冲突 lease 和本地证据，禁止自动新开会话。

## 检验与交付门禁

- 先实现一个可测试单元再推进下一单元：协议/全局 lease → 原生动作适配和状态机 → 导出与清理。
- 覆盖重复/乱序/越权命令、旧请求结果、结果已写但尚未退出、身份缺失/PID复用、窗口冲突、迟到启动、父进程失联、各阶段取消/超时、导出覆盖/链接及取消后无继续动作。
- 运行新增定向测试、性能包回归、typecheck、lint、diff 检查。无设备原生 fixture 可执行；不申请额外 AX 权限或操作真实 Xcode/设备。
- 同步 ADR-044、生产计划、交接和任务 notes，保持 T6.12 in_progress。身份来源和真实 AX 控件兼容性如未解决，逐项记录，不能宣称 capture ready。

确认本计划授权 B 代码实现、文档同步、临时构建及无设备验证。实现完成后提供具体候选版本和测试结果，再审阅固定升级与真实设备动作。原有阳性/释放对照授权已经执行，不重复使用；本计划不包含 commit/push。C/D 接线与 E 生产 G5 继续独立追踪。

## 提交前 PTY 回归修复（2026-09-09）

全库检查发现 Simulator 原生内存 PTY 的 Test Plan 标题等待依赖完整文本，而 OpenTUI 增量绘制复用上页标题单元，实际已进入计划页仍超时。测试改为等待新呈现的 baseline=skip 编辑提示；不更改产品代码、不放宽 canonical 结果、许可次数与清理断言。该修复随本次提交，最终门禁结果记录于任务 notes。

完整复跑时既有组合 PTY/CLI/字符帧测试触发外层 15 秒或默认 5 秒时限，未发现残留 fixture。五个渲染进程串行的组合测试总预算调整为 60 秒，内部交互/退出 deadline 和结果断言保持；最终全库使用 `bun test --timeout 30000`，提高默认测试执行预算而不改变产品超时。首次标题检查失败、随后宿主超时与最终结果分别保留，不把失败运行标为通过。

最终提交门禁：`bun test --timeout 30000` 4127 pass / 13 skip / 0 fail，12958 assertions，384 文件，104.02 秒；typecheck、lint（924 文件）、generic/all/changed-index 禁用字面量与 staged gitleaks 均通过。13 skip 为 7 项既有 skip 与 6 项 opt-in 原生 helper 用例；后者已有独立宿主通过记录，不宣称本次全库执行了跳过项。
