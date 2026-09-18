# T6.12 Return 受控 App 候选与首次执行范围

日期：2026-09-17。状态：候选已编译/临时签名，尚未安装、preflight或运行。用户最新“确认”用于准备候选；本节末尾的真实事件范围需单独确认。

## 目的与边界

本候选是传输层探针：验证公开postToPid能否向自有启动回调返回的固定App传送无修饰Return。接收端只统计本App收到的down/up、repeat、是否出现其他按键、活动/焦点布尔值；不记录字符、原始按键或桌面内容，不解释命令，不使用事件监听tap。

它不是LLDB/Appium/Xcode适配器。生产PublicMemoryConsoleReturnTransport继续只允许Xcode，未为夹具放宽门禁。候选发送器为测试专用，复用MemoryOwnedAppSession/RunLoopDriver，采用同一公开CGEvent构造及postToPid API；通过只说明该传输层环境可行，不能替代生产exchange、AXSelectedText、Xcode焦点、固定查询响应或真机G5。

规格原文：“真机与 Simulator 能力分别实测，不能以独立后端 probe 或 fixture 单测替代生产链路验收。”

## 可审阅产物

源码：
- `packages/itestagent-backends/performance-xctrace-analyzer/test/memory-return-controller-app.swift`
- `packages/itestagent-backends/performance-xctrace-analyzer/test/memory-return-target-app.swift`
- 复用 `native/itestagent-memory-owned-app.swift`，没有修改该文件。

临时候选 `/private/tmp/itestagent-return-candidate/iTestAgentReturnController.app`，包含固定路径 `Contents/Resources/iTestAgentReturnTarget.app`。

| 项目 | 锁定值 |
| --- | --- |
| Controller bundle ID / version | com.itestagent.return-transport-controller / 0.1.0 |
| Target bundle ID / version | com.itestagent.return-transport-target / 0.1.0 |
| Controller executable SHA256 | c7f80433ed667f4cfe433000d64caed60bdd0d7614e281d9bcb2e9b9bc74b6a7 |
| Target executable SHA256 | a78a6c2f00c0764b1a52a21ee7a0eab6e8dd8a5a4241b71b4e02c6e4e2827589 |

完整文件哈希、Info.plist/签名及源码副本：候选根目录下 `review-manifest.json`、`review-sources/`。两个App均采用临时ad-hoc签名；warnings-as-errors编译、deep/strict签名验证通过。没有执行任何候选二进制，签名本身不是运行或权限授权。

## 接口与有限执行

- `--preflight`：只输出accessibilityTrusted/postEventAccess/eventsAttempted=false，不申请权限、不创建NSApplication或启动目标。
- `--authorized-fixture-run normal`：唯一controller注册实例检查；AX和post-event权限分别检查；缺失则不启动接收端。固定嵌套目标预先无实例；NSWorkspace独立启动返回原实例，禁替换，允许该测试App成为前台。
- 接收端起始计数必须0/0、active/focused为true；最多一次Return down和一次同原实例up。检查与发送之间仍有竞态，不能宣称原子性。
- 发送后至少观察1秒，接收端每0.1秒更新私有文件；期望1/1、unexpected=false、repeated=false。发送API没有回执，必须区分attempt与receipt。接收端内容仅为测试自报告，不是系统级认证。
- 15秒owner期限+最多5秒正常退出收口；接收端另有30秒run-loop定时退出。无force quit、无重发、无自动修改焦点或切换策略。run-loop期限不是系统级强制终止保证；未退出须记录cleanup_unverified，不能报告通过。
- 每次输出独立0700目录 `/private/tmp/itestagent-return-run-<UUID>/` 下controller.json和target.json，包含requestId、固定布尔/计数和自有PID，不含原始UI、任意输入或秘密。两文件须匹配本轮UUID，最终独立检查该PID/该bundle无实例。
- 已编译但首次不执行的模式：cancel-before（0/0）及cancel-after-down（只继续一次配对up）。它们是指定代码检查点的取消模拟，不证明SIGTERM/EOF/任意进程中断传播；真实中断和原实例消失还需后续单独方案。

## 首次真实检查的具体授权请求

1. 确认候选完整清单和签名未变、无已有controller/target实例。复制新候选到独立目录 `~/.itestagent/helpers/return-transport-fixture/iTestAgentReturnController.app`；若目录已存在则停止核对，不覆盖旧helper/probe。
2. 只执行新controller的preflight。必要时通过正常系统设置为**这个新controller**授予辅助功能/事件发送所需权限，不能假设现有probe的授权覆盖它；不重置TCC、不请求Input Monitoring、不触及其他权限项。preflight仍不足则停止，不自动发键。
3. 首次仅运行一次normal：固定嵌套自有App、最多1 down+1 up，自动正常关闭。若前置失败没有启动/发送，允许完成本次已授权的权限配置后再做首次实际发送；任何downAttempted=true即消费额度，不重试。
4. 检查请求匹配、接收计数与正常退出，独立核实controller/target进程不存在。未收到、重复、意外输入或清理不明都记失败/未证实。

上述授权不包括取消模式、Xcode、LLDB命令、iPhone/Simulator、memgraph捕获、升级原0.1.3/0.2.0、commit/push。若首次成功，先报告证据再准备后续取消/上下文漂移及完整exchange验证。

## 本轮离线检查

两App的Swift warnings-as-errors编译和deep/strict签名验证通过。定向Return合成回归1 pass；真实owned-App opt-in测试1 skip，未启用。typecheck、lint与git diff --check通过。本轮没有全性能包/全仓库重跑，也没有新增G5/G5-SIM。日志 `/private/tmp/itestagent-return-candidate-{tests,typecheck,lint}.log`。

## 安装与权限阻断记录

2026-09-17：用户确认安装/权限/首次normal范围。Return控制端0.1.0安装和完整清单/签名核验通过，preflight两权限均false、无事件。系统辅助功能Open面板已选中正确App；点击Open被自动审批拒绝，要求提交时再次确认安全敏感授权。未绕过，未启动target，首次事件额度未消费；旧helper/probe未改，无提交推送。安装/preflight证据位于候选目录installation-result.json、installed-preflight.json。下一步只待确认当前Open提交，之后继续原已授权首次normal范围。

## 首次normal实证与收口缺陷

2026-09-17：用户完成新controller辅助功能授权后，CLI preflight仍false，正常App启动preflight两权限true。唯一normal请求d1b1f25b-826a-4495-b2e1-ad67e4a759ae实际发送down/up各1，target收到1/1、无repeat/意外键，request匹配。target82579正常退出，但controller82573在app.stop之后仍驻留，自动整体收口失败。一次公开NSRunningApplication.terminate正常退出请求后两PID均消失，无force/重发。传输层实证通过但完整生命周期未通过；单次额度已消费，尚无Xcode/设备验证或提交推送。

证据：`/private/tmp/itestagent-return-candidate/app-preflight.json`、normal-before.json、normal-cleanup-observation.json、normal-cleanup-final.json；本轮接收及控制记录位于 `/private/tmp/itestagent-return-run-d1b1f25b-826a-4495-b2e1-ad67e4a759ae/`。controller内部cleanupVerified只描述其owned target退出，不能误用为controller自身退出或整体生命周期通过。正常App preflight快速退出导致open -W报告无法取得等待PID；结果文件完整且后续无旧实例。

收口问题假设按当前证据排序：
1. app.stop(nil)仅结束App运行循环的语义/唤醒方式不足以保证该accessory进程退出（最符合已写最终文件且外部正常terminate即可退出）。
2. run-loop/driver保留或回调终止顺序使主程序未返回（需更细本地固定阶段标记区分）。
3. AppKit关闭请求/注册状态延迟（持续驻留和已知PID检查不支持“已经退出只是清单滞后”，仍不能仅凭代码排除所有系统因素）。

未将假设1标为已完全证明根因。下一最小修复计划：控制端最终结果持久化后采用明确的正常App终止路径，并加入仅含固定阶段值的退出诊断；保持发送器/目标/权限/额度规则不变。先编译、离线检查及锁定新候选哈希，再申请升级和单次真实生命周期复验；不得直接重签覆盖现有已授权0.1.0或复用已消费发送额度。取消模式和Xcode验证继续未执行。

## 0.1.1 最小退出修复与升级复验方案

2026-09-17：用户继续批准controller最小退出修复。Apple stop文档明确timer/observer调用不结束NSEvent循环，与owner timer内app.stop和真实驻留证据吻合；改为结果写入后app.terminate(nil)，添加固定退出阶段诊断。0.1.1仅临时构建签名，warnings-as-errors/签名、1项Return合成回归、typecheck/lint/diff通过；初次Swift主actor隔离编译错误已修正并重新成功编译。安装0.1.0完整清单未变，未运行候选/发事件，真实自动退出仍待授权复验。

依据：[Apple stop文档](https://developer.apple.com/documentation/appkit/nsapplication/stop%28_%3A%29?changes=_7)说明stop仅设置标记，在NSEvent分发后检查；timer/observer调用不会结束循环。当前onClosed由MemoryOwnedAppRunLoopDriver的Timer调用，因此已确认采用了不适用的退出API；不再将此代码缺陷仅列为无依据假设。修复后的真实退出仍未验证。

变更仅限测试controller：正常terminate代替stop，增加controller-exit.json（requestId、自有PID、固定stages）。willTerminate观察器明确在main queue同步处理，主actor隔离编译通过。接收端及固定发送条件/次数保持原样。owner cleanupVerified仍仅描述target，will_terminate也不是进程已退出证明；必须独立检查controller/target PID消失。

候选 `/private/tmp/itestagent-return-exit-candidate/iTestAgentReturnController.app`，源码快照及完整review-manifest.json同目录。controller版本0.1.1，SHA256 `fafa47b63eed83e22c0fb0d849b14f98d077d0b70870844a3982a04c9938f15d`；内嵌target仍0.1.0，SHA256 `a78a6c2f00c0764b1a52a21ee7a0eab6e8dd8a5a4241b71b4e02c6e4e2827589`。旧候选、首轮证据及当前安装均保留。未实际启动新版二进制。

下一具体授权范围：
1. 核验新旧完整哈希/签名和无运行实例；将当前安装复制到独立 `~/.itestagent/helpers/return-transport-fixture-backup-<UUID>/` 并校验，再升级仅此controller App及其未变嵌套target到既有安装路径。原MemoryConsoleProbe/MemoryHelper不动。
2. 从正常App启动路径执行只读preflight（CLI路径已证实不能代表App权限）。若新签名需刷新，只处理该controller辅助功能条目，经正常系统设置授权，不重置TCC；需Touch ID/系统即时确认则由用户完成。
3. 新版仅执行一次normal，最多一对Return，独立请求目录；一旦downAttempted即消费新版本次额度，不重发。检查接收1/1、无repeat/unexpected、固定终止标记以及controller和target自行退出。不能把外部terminate后的退出算自动退出通过。
4. 若控制端再次驻留，只对核验后的本轮自有实例最多一次正常terminate收口，不force quit，记录复验失败并停止。

不包含取消模式、Xcode/设备操作、命令写入或commit/push。执行门禁证据日志 `/private/tmp/itestagent-return-exit-{tests,typecheck,lint}.log`；没有全性能包或全仓库重跑，没有新增G5/G5-SIM。此段方案尚待升级/真实运行授权。

## 0.1.1安装完成，单项权限待刷新

2026-09-17：用户授权0.1.1备份升级及一次normal复验。新旧完整哈希/签名及无实例检查通过，0.1.0备份return-transport-fixture-backup-c03460c2-5bb7-4aa3-8238-1d721f5e7b9f，0.1.1安装后清单验证通过。正常App preflight两权限false、eventsAttempted=false；辅助功能旧controller条目仍on。AX与坐标点击均无法选中，Remove disabled，等待用户仅手动移除此controller旧条目再正常添加新版。未启动target或发送事件，本次normal额度未消费；原helper/probe未改，无提交推送。证据位于 `/private/tmp/itestagent-return-exit-candidate/installation-result.json` 与 `app-preflight.json`。

2026-09-17：用户已移除旧controller授权，UI核实条目消失；重新定位安装App，面板确认0.1.1。点击Open被自动审批拒绝，要求该权限提交即时确认，未绕过；等待用户完成当前Open添加。未启动target或发送按键，已授权normal额度未消费。

## 0.1.1单次复验通过

2026-09-17：用户完成0.1.1单项授权重加；正常App preflight两权限true，新版完整清单/签名及无旧实例验证通过。唯一normal请求18e0a2c2-e082-414c-a3fe-451a9422afa2，接收down/up各1，无repeat/unexpected；controller阶段initialized/owner_closed/termination_requested/will_terminate，open等待正常结束。独立ps及进程清单确认controller61733/target61738均消失，无外部terminate或force。自动退出修复本次实证通过，本轮额度消费；targetVerified仍false，未进入Xcode/设备/完整query exchange，T6.12仍in_progress。无提交推送。

证据：`/private/tmp/itestagent-return-exit-candidate/normal-verification.json`、normal-run-directory.json、app-preflight-authorized.json；本轮目录 `/private/tmp/itestagent-return-run-18e0a2c2-e082-414c-a3fe-451a9422afa2/` 下controller.json、target.json、controller-exit.json。未新增代码，无需重复离线门禁；JSON与diff检查通过。这是macOS测试App传输及正常退出证据，不是G5/G5-SIM或生产提交完整验收。

下一待授权的有界检查可复用同一0.1.1，不再升级/重签：先运行一次cancel-before，期望0 down/0 up及自动退出；仅该项通过后再运行一次cancel-after-down，最多一对Return，期望down后仅配对up、接收1/1及自动退出。每个模式独立请求/证据目录，发送即消费，不重试、不切回normal；前项失败则停止第二项。仍不证明真实SIGTERM/EOF传播或原实例消失，不能扩大为任意取消已通过。本段只准备下一范围，尚未执行或取得新事件额度授权。

## 0.1.1两个取消检查点实证

2026-09-17：用户继续授权同一0.1.1两项固定取消检查。cancel-before请求2243db3f-30d3-4fe4-95bc-f93868ed6d34，接收0/0，controller18329/target18330自动退出；通过后执行cancel-after-down请求0ea5e48e-64d4-4372-982b-d418db9642c3，接收1/1，controller22168/target22169自动退出。均请求匹配、无repeat/unexpected，独立ps/进程清单证实无残留，无外部terminate/force/重试，两个额度已消费。此为测试发送器指定检查点取消，不代表生产exchange或真实SIGTERM/EOF/原实例消失已验证。无升级/权限变更/Xcode/设备/提交推送，T6.12仍in_progress。

证据汇总位于 `/private/tmp/itestagent-return-exit-candidate/cancel-before-verification.json` 和 `cancel-after-down-verification.json`。各文件记录独立request、证据目录、所属PID、计数和外部退出未使用标志；原始运行目录各有controller/target/controller-exit三份白名单元数据。两个open等待命令均正常结束，退出阶段包括will_terminate，独立进程消失检查通过。

语义限制：cancel-after-down模式在固定发送点选择取消原因并只完成配对up，并未向生产MemoryConsoleReturnExchange注入异步取消，也未触发SIGTERM/EOF。此次证明该测试发送器的固定事件对可被接收和正常收口；不能把它提升为所有取消路径通过或生产自动化ready。targetVerified仍false。最新变更仅文档，JSON及diff检查通过，不重复代码门禁或声称新增G5/G5-SIM。

下一工作应准备完整exchange的受控接线：同一个owned launch实例/会话授权、固定PreparedMemoryIdentityQuery、真实输入/输出绑定、唯一响应严格校验及父进程中断传播。先形成离线实现与无事件测试方案，再决定真实App或Xcode执行范围；不能直接在Xcode重放本测试发送器，不能将测试接收器当LLDB。现有两个取消模式不再重跑。

后续完整查询接线的可审阅离线计划已准备：[query-session-plan](physical-memgraph-query-session-plan-6.12.md)，尚未实施。
