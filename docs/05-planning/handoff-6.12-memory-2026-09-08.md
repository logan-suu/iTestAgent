# T6.12 内存性能能力交接 — 2026-09-08

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
