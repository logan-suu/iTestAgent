# ADR-044：真机 memgraph 自动诊断与调试会话边界

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
