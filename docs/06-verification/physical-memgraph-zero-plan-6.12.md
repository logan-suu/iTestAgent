# T6.12 真机 memgraph 完成扫描对照方案

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

## 最新进展（2026-09-09，优先于下文）

用户同意建立调试上下文后再定位控件。Xcode正常Run执行本次唯一构建/签名/安装，确认同一iPhone和MemoryProbe scheme，Running状态成立；公开Debug Area随即暴露可用Memory Graph按钮。新查询唯一AUT PID并绑定，独立生产Appium Route B会话保持同一PID，执行一次Run Leak Workload、20秒wait及两条断言，全部passed。未重启阳性进程。

点击一次Memory Graph后捕获完成，File菜单出现可用Export Memory Graph。通过正常保存面板自动导出本次唯一positive.memgraph（1516321bytes，SHA256 1814693b3956934b3fc58e2de624af258c9d991c5df2168a6e02bd74ee905ff8）。本地leaks --list --nostacks --noContent只分析一次：exit1，唯一摘要的PID匹配，20项/5242880bytes，stderr为空。证明公开Xcode UI自动捕获/导出与阳性离线诊断通道成立；不是有效零扫描，也不是生产backend或正常TUI G5。

原始文件及输出留在私有state所指run artifacts，未向模型输出内存图、地址、栈或设备树。Computer Use节点不能直接写该目录AX文件（EPERM），未在其他目录绕存原始内容，改为仅本地内存处理emit:false AX；memgraph由Xcode保存面板直接写入run artifacts。唯一文件的size/hash与leaks摘要已保存为白名单proof。

阳性probe/Appium exit0，backend closed/reusable，Xcode Stop后devicectl确认AUT0；probe/driver/Appium记录PID延迟复查0，4723空闲；本次项目关闭无保存提示、Xcode退出（非激活listApps确认），baseline两份哈希不变。缺失/损坏文件两个离线边界检查均exit255且无扫描摘要，不得转换为not_detected。

**释放对照尚未执行**：当前可访问主菜单、Product和Debug Navigator未提供可靠的附加现有进程入口；不能据此推断所有Xcode环境不支持附加。已定位可用Product > Perform Action > Run Without Building，但其是否重新部署App尚未证明，不能静默突破原“不再次安装”限制。本次没有第二次启动/安装/工作负载/捕获或扫描。阳性授权已消费，释放工作负载授权未消费；不得重复阳性。

**最小补充申请**：允许仅释放对照通过Xcode Run Without Building建立新调试会话，并允许该动作必要时重新部署同一MemoryProbe；不重新编译、不改Team/源码、不安装其他App。核对新PID与原阳性不同且目标相同，再按原已批准释放流程：独立Route B WDA、一次Run Released Workload、20秒wait/断言、唯一捕获/自动导出control.memgraph、一次leaks分析，失败停止，最后owner收口/baseline不变。仅此启动/可能重部署差异待确认，原未消费释放动作不重复索取授权。

状态：用户已确认本方案。2026-09-09执行第1步预检后停止：无调试会话时未找到Memory Graph/专用导出控件。第2–4步设备动作未执行、授权未消费。下文末尾提出仅调整检查顺序的补充方案，待确认；不是已可用backend，不修改生产检测契约，不把本方案视为G5通过。

## 依据与当前缺口

US-12.3 AC4原文：“泄漏结论必须来自真实诊断证据，区分检测到、本次检测未发现与无法检测；内存增长不能直接判为泄漏，未发现不承诺不存在所有泄漏。”

US-12.3明确要求：“不得要求用户手动操作 Xcode/Instruments、导出内存图或搬运文件来完成每次测试；能力不足须明确报未完成，不能把人工操作作为本故事的验收通过路径。”

历史performance-capture-wiring-6.12.md §21–22已检查公开TOC/detail、os-log/signpost和Instruments AX表面；空详情、Automatic Snapshotting、Idle不构成扫描完成。当前Xcode26.5/17F42未变化，export公开帮助没有新增扫描完成选项。仅因新录制收到开始通知，也不能证明Leaks扫描完成。不重复父track崩溃查询、旧空导出或已通过阳性G5。

新候选是Apple公开支持的Xcode Debug Memory Graph→File > Export Memory Graph→leaks离线分析。官方资料明确直接进程分析面向macOS/Simulator，真机不能将远端PID直接交给宿主leaks。现有run目录无memgraph可复用。本候选须先证明自动导出、文件来源与工具完成语义，不能因为官方支持手工界面就称产品已自动化。

来源：
- https://developer.apple.com/documentation/Xcode/gathering-information-about-memory-use
- https://developer.apple.com/videos/play/wwdc2024/10173/
- https://developer.apple.com/videos/play/wwdc2021/10180/
- https://developer.apple.com/documentation/xcode-release-notes/xcode-27-release-notes （新录制选项不证明零扫描，当前不升级Xcode）

## 拟验证范围与逐项动作

1. **本地最小自动化探针。** 临时脚本仅使用现有工具与公开Xcode界面/Accessibility，先定位目标窗口、Debug Memory Graph和Export Memory Graph控件。只允许确定性白名单状态、布尔值、计数进入模型；原始AX、截图、栈、地址、memgraph只保存在独立run artifacts。无法可靠定位就停止，不改系统权限、不调用私有调试接口、不逆向trace/memgraph、不要求用户代替点击。技能的Simulator capture脚本不用于真机。
2. **一次构建/签名和安装。** 复用已验证独立临时MemoryProbe项目、现有Team和同一iPhone；允许一次构建/签名、关闭并仅替换com.itestagent.spike.MemoryProbe。不得改其他项目/Team/设备设置；Xcode如提示额外安装、系统权限或项目迁移则停止。只读打开临时项目及本次调试会话允许，必要的临时自动化代码不写入被测项目。
3. **阳性进程对照。** 一次Route B WDA准备、启动该fixture；一个Run Leak Workload动作、20秒业务等待和完成断言。Xcode仅附加该已核对目标进程，允许暂停以捕获一次内存图、自动导出到唯一新路径；然后由leaks对该文件进行一次有界离线分析。保留文件hash、设备/进程身份、捕获区间、文件创建时间、命令退出与扫描完成字段。完成后停止本次debug/fixture/WDA会话。若有任何失败，不自动进入释放对照或重跑。
4. **释放进程对照。** 同一安装新启动进程（不再次构建/安装），独立WDA会话；一个Run Released Workload动作、20秒业务等待和完成断言。重复一次明确捕获/自动导出/离线分析。只有目标/时间绑定和明确完成扫描成立，且实际结果确为0项/0bytes，才取得本次未发现候选证据；非零照实记录，不能调整解析或重复操作求零。
5. **边界/退出检查。** 离线构造缺失/损坏/中断输入验证不产生not_detected，不再操作手机。所有捕获/工具操作有超时，所属进程收口；保留安装与证据，关闭本次Xcode文档和调试会话，不退出或接管用户其他会话。两份现有baseline数量/hash不变，不保存Flow或建立baseline。

本探针每次导出上限120秒、离线分析60秒，单对照10分钟上限；超时停止并只清理本次owner。真实内存图捕获会暂停被测App，因此只能作为新的诊断快照来源，不能冒充原连续性能采样。没有用户原始secret输入，原始内存图仍按raw-local-only严格保存。

## 通过标准与后续分界

- 自动完成，无用户手动导出；同一已确认真机/fixture身份和新的快照时间绑定可信。
- 阳性文件确有诊断，释放文件存在完成的0/0扫描；任一不足保持inconclusive。
- 命令正常结束不单独代替扫描完成；空文件、截断输出、错误、超时、取消不产生零值。
- 若工具证据成立，另写ADR评估可发布自动化依赖、快照扰动、权限/取消/隐私与新source，再出生产接线计划。仅Codex工具能操作Xcode不算itestagent生产能力。
- 若自动导出或完成绑定不可行，记录明确技术阻塞并保留not_exportable；不升级Xcode、不引入新依赖或缩减AC。

实施涉及的新验证脚本/调试捕获和两次具体设备动作按R8/R7等待本方案确认。之前成功通知/取消G5授权已消费，本申请不复用。T6.12保持in_progress、T6.13 pending，无提交推送或合并请求。

## 预检结果与顺序调整申请

本方案随后获用户确认。实际Computer Use可启动Xcode26.5、只读打开已有临时MemoryProbe工程并展开Debug Area；没有新增权限、安装提示或迁移提示。File只有禁用的通用Export，AX中没有Debug Memory Graph/Export Memory Graph；主菜单在此无调试会话状态下没有Debug菜单，Debug Area仅暴露Variables/Console等控件。不能据此推断启动调试后也不可用。

初始getApp的自动欢迎页输出未被emit:false抑制；未涉及设备内存证据。后续AX均emit:false并白名单投影，未捕获设备内存图。文件选择器paste出现clipboard timeout、setValue后状态读取出现一次ScreenCaptureKit错误；重新只读核对确认路径已输入，实际Open成功。Escape未可靠折叠菜单，使用菜单公开Cancel动作成功。上述说明工具适配仍须验证，不能视为可发布自动化backend。

按第1步“无法可靠定位就停止”，未执行构建/安装/WDA/启动fixture/按钮/调试附加/捕获，设备动作授权未消费。关闭本次工程无保存提示，退出本次启动的Xcode，非激活listApps延迟确认isRunning=false；既有两份baseline哈希不变。未改生产代码或schema，沿用4097-pass门禁，文档diff检查通过。

**方案顺序缺口由Agent承担**：原方案要求先看到依赖调试上下文的控件，再允许创建该上下文，可能形成前置循环。以下是待批准的最小顺序调整，不额外增加原第2–4步设备操作数量：

1. 复用已获授权的一次构建/签名/仅替换MemoryProbe，启动并让Xcode仅附加已核对fixture PID；此时不点击工作负载、不捕获快照。
2. 在真实调试上下文重新定位Debug Memory Graph与导出入口；只观察，先检查可用性。控件缺失、无法确定身份、出现新权限或不可恢复工具错误即停止并收口，不启动阳性动作。
3. 控件可验证后按原阳性流程继续；同一进程恢复运行，一次阳性tap/20秒wait后一次快照及自动导出；通过后才进入原释放对照。保留原次数、超时、隐私、失败停止与清理边界，不要求用户手动导出。

本补充仅请求实施顺序变更确认，不重复索取未消费的相同设备动作授权。若无法通过公开界面可靠附加，则记录阻塞，不切换私有接口或增加依赖。
