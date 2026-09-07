# TUI 计划确认后停滞与陈旧设备状态

## 症状

- 真机从未连接变为 USB 连接后，用户按 `r` 刷新并选择设备；TestPlan 确认后却返回聊天页，没有开始后续执行。
- 聊天中可能同时出现 `generate_draft_test` 权限请求和基于旧发现快照的 `device_not_ready`。
- header 与设备选择页对同一时刻的 readiness 结论不一致。

## 根因

确定性规划状态机在产生候选、设备或计划审阅页后，仍继续启动同一轮 AI SDK tool loop。模型因此可以在用户尚未完成检查点时并发刷新设备、编译计划或请求执行，造成会话 inventory、面板 inventory 和权限请求来自不同快照。设备 Enter 只读取已有数组，没有重新验证所选 UDID；计划 Enter 只把模式切回聊天，没有调度已确认计划。

此外，`compileTestPlan` 被错误映射为 `generate_draft_test`。后者是生成测试代码草稿的独立高风险动作，不适用于只在内存中形成 TestPlan。

## 修复原则

1. 确定性人机检查点存在时暂停模型 tool loop。
2. `r` 与设备 Enter 共用串行发现队列；Enter 只接受刷新后仍为 ready 的同 targetKind、同 UDID 设备。
3. TestPlan Enter 直接调度已确认计划；安装、WDA、构建等高风险动作仍由 `PermissionEngine` 逐项确认。
4. `compileTestPlan` 不请求 `generate_draft_test` 权限。
5. 真实 PTY 回归断言一次 Enter 只触发一次当前面板事件，并且不会穿透到切换后的面板。

## 验证场景

从 physical 设备 `discovered` 开始，模拟 USB 接入后按 `r`，选择刷新后为 `ready` 的同一设备，确认 TestPlan，处理真实执行权限，并验证执行 seam 只调用一次。整个规划阶段不得产生模型 turn 或 `generate_draft_test` 权限请求。

## 后续修复：权威状态与异步结果顺序

真机复测继续暴露了两个交互层问题：设备页遗留的 `device_not_ready` 会在后续聊天页继续显示，而 OpenTUI 会在入口与会话确认动作前先本地执行 `plan_confirm`，造成页面先切回聊天、但权威确认结果和权限提示尚未提交的假象。此外，`r` 刷新与设备 Enter 的异步结果缺少版本约束，较早请求可能在较新操作后回写。

修复后，候选、设备与 TestPlan 的确认、取消及提交动作只由入口/会话层提交权威状态；设备刷新和选择使用单调操作版本，迟到结果被丢弃。真实 PTY 回归必须连续验证“设备 Enter → TestPlan Enter → 权威确认/权限提示”，同时保留第一次 Enter 不得穿透到下一面板的断言。

再次真机复测发现，TestPlan 确认消息可见后，权限请求、权限超时和执行结果虽然已进入 TUI state，却可能不再出现在 OpenTUI 消息区。根因是聊天页在挂载时把 `messages` 属性固化为旧数组，后续状态更新只刷新了 header，消息列表没有响应新数组；用户因此只能看到“Starting execution”，无法判断是在等待权限还是执行已经失败。修复后，消息区通过显式 memo 跟踪 state 中的数组替换并增量更新；确认动作还会同步发布 `Preparing confirmed TestPlan execution…` activity，权限阶段切换为 `Awaiting permission`，执行队列以 operation owner 清理，防止旧异步清理覆盖新执行。`PermissionEngine` 必须先注册 pending ask 再发布请求事件，确保事件消费者即时答复不会丢失。真实 PTY 回归必须同时观察 activity、权限正文，并证明设备 UDID 不进入聊天 transcript。

## 后续修复：窄输入视口与静默执行阶段

真机复测在连续权限确认时又暴露了两个问题。第一，聊天输入框位于横向 flex 容器内但没有占据剩余宽度；OpenTUI 因而为它分配了极窄的可视区域。`allow` 的完整值仍进入输入事件，但屏幕只显示末尾的 `low`，用户容易重复输入并得到 `aallow`。修复方式是让聊天输入控件显式 `flexGrow`，并以长中文消息提交后立即输入 `allow` 的 character-frame 与真实 PTY 场景同时验证完整显示和完整提交。

第二，权限全部放行后，生产执行虽然继续运行，但 `tool.progress` 被 TUI 映射层丢弃，DeviceBackend 闭环也没有发布“启动应用、读取界面、等待模型动作、执行动作、评估断言、保存结果”等阶段，因此长耗时操作只显示静态的 `Executing confirmed TestPlan…`。本次现场运行实际在约 101 秒后提交了 `infra_failed` bundle，并非永久死锁；失败原因为模型对无需元素定位的观察动作省略 `target`，而解析器对所有动作统一强制 `target`。修复后，生产执行只发布不含设备标识和原始 UI tree 的真实阶段文本，不使用伪造百分比；`screenshot`、`swipe`、`wait` 可生成确定性的审计目标，`tap`、`input` 仍必须显式提供元素目标并 fail closed。失败终态必须清除 activity，显示原因，并在 bundle 已提交时显示对应 run。

## 后续修复：第三项授权超时被误报为用户拒绝

2026-09-07 15:57 的截图显示，`execute_project_build` 和 `replace_device_app` 都有对应的用户 `allow`，但 `prepare_wda` 没有收到有效答复，120 秒后出现 `Permission deny` 与 timeout。当前入口在调用执行器之前依次收集三项授权，因此这次尚未进入构建、安装或 WDA 启动；不能由此判定真机连接或 WDA 执行失败。

根因有三处：权限异常被统一转换为 `effect=deny`，但事件没有保留超时、取消或错误原因；TUI 因此一律显示用户拒绝。权限提示未强调必须输入并回车、等待上限，以及 WDA 的自动化用途。新加入的构建授权还遗漏了目标脱敏，超时字符串也拼入原始 resource。

修复保留 R7 的逐项授权和 120 秒默认时限：请求事件携带真实 `timeoutMs`，非用户决策的失败事件携带 `reason`，TUI 分别展示并清除等待 activity。构建、安装和 WDA 权限正文只显示脱敏后的目标，权限失败输出只包含 action，不泄漏 UDID。直接执行的超时终态给出 `/plan <test goal>` 恢复方法；该入口重新规划、确认目标并逐项询问，不自动执行，也不复用此前的 allow。

回归覆盖完整的“前两项 allow → 第三项超时 → 不调用执行器 → 迟到 allow 无效 → `/plan` 重试 → 三项全新 allow 后只调用一次”链路，并单独检查主动拒绝、取消、内部错误和 OpenTUI 等待/终态字符帧。这里的执行器替身只验证编排与权限边界，不构成真机安装、启动或点击的 G5 证据。

## 后续修复：构建完成后查询了错误的 DerivedData

2026-09-07 16:17 的复测截图显示，构建、安装和 WDA 三项授权均已通过，但随后以 `physical_preflight_artifact_validation: Application source does not exist` 结束。失败路径位于 Xcode 默认 DerivedData；本次运行记录为 `infra_failed`，没有测试步骤或设备证据。因此不能把授权成功视为已经安装或操作应用，也不能把这次错误归因于 WDA。

根因是 `buildForPhysical()` 在 `xcodebuild build` 中传入了 run staging 下的 `-derivedDataPath`，后续 `-showBuildSettings` 却漏传同一参数。后者返回默认构建目录，`TARGET_BUILD_DIR + FULL_PRODUCT_NAME` 因而指向另一个位置；原有测试直接返回固定 settings 路径，未反映命令参数差异。生产执行器在结束后清理 staging，失败后的目录不存在也不能用来反推构建阶段没有生成产物。

修复让两次命令复用同一组 container、scheme、configuration、destination、DerivedData 参数。`-allowProvisioningUpdates` 仍只由显式开关控制并用于 build；构建或 settings 查询失败不返回可安装路径，产物仍经过结构、平台/架构、bundleId 和签名验证，禁止用其他目录的旧 `.app` 绕过校验。

验证采用命令参数驱动的 process fixture：build 在本次 staging 中生成测试 bundle，settings 根据收到的 `-derivedDataPath` 返回路径。跨包回归保留真实 `createProductionPhysicalPreflight`、AppSource、build、归一化、coordinator 和 devicectl 编排，仅替换外部进程与设备 backend；断言本次产物依次进入 install、launch、WDA probe。另一分支故意不生成产物，必须在任何设备操作前阻断；另有构建失败不查询 settings、settings 失败不返回路径、含空格目录及默认参数回归。修复前对应路径用例失败，修复后通过。

这些是参数传递与生产组合的自动化证据，不是真机安装或点击的 G5 证据。用户需要重启使用修复代码的 TUI，再开始新计划并逐项授权；本轮不修改 API key、不清理 Xcode 默认 DerivedData，也不自动操作设备。

## 后续修复：WDA 已提前退出，却只报告一分钟后的 socket timeout

2026-09-07 16:45 的复测中，用户已看到 AUT 安装并打开，随后出现 `physical_preflight_wda_status`，正文为 WDA `/status` 等待约 60 秒后 socket connection closed。对应 run 为 `infra_failed`，没有测试步骤或设备证据；AUT 启动成功不代表 WDA 自动化通道已就绪。

只读检查对应 Xcode test result 的脱敏错误摘要后，确认 WDA 测试启动约 3.7 秒便因安装失败结束；底层错误明确包含 `This provisioning profile has expired.`。因此本例有直接的 Xcode 错误证据支持 WDA profile 过期，而不是根据安装清单、超时或账号类型推断；没有读取或声称精确过期日期。

代码根因是 `WdaManager.launch()` 创建了 stdout/stderr pipe 却没有消费，也没有把 owned child 的退出接入 `waitForReady()`。即使启动进程已经失败，readiness 仍继续轮询，最后用网络层错误覆盖用户真正需要处理的签名问题。

修复保持 Route B 默认及原有 R7 边界：

1. launch 时立即并行消费两个 pipe，仅保留各自最多 4096 字符的识别窗口及 allowlist 诊断事实；错误不包含原始 Xcode 日志尾部、路径、Team ID、UDID 或任意 token。未识别的失败只报告 exit code、launch 阶段和查看本地 Xcode test result 的建议。
2. 子进程退出后最多等待 250ms 收取缓冲区诊断，防止 descendants 持有 pipe 导致永久等待；退出会中断 pending `/status` 请求或轮询间隔。已退出的 owned launch 不能因其他服务返回 `ready` 而被判成功；HTTP 非成功响应也不能通过 readiness。
3. 使用 typed failure code/stage 区分 signing/configuration、launch 与 `/status`，不再由恢复提示中的 “signing” 等词改变错误分类。run abort 和 deadline 贯穿状态请求；正常轮询会移除 abort listener。
4. session 创建失败时，即使 launch leader 已退出，也调用其 owner 的 stop 回收进程组与 pipe，并停止 owned tunnel；不会扫描或终止其他 Appium/Xcode 进程。
5. 明确过期时提示使用有效 profile 重新构建/签名 WDA，再替换安装 Runner；重签和替换安装各自需要明确确认，不能复用上一轮 allow，也不自动卸载其他 App。恢复后必须重新验证 WDA `/status`、目标身份和 Appium session。

自动化验证使用无设备副作用的真实 Bun 子进程注入观察到的 Xcode 错误文本，覆盖提前退出、stdout/stderr 大量及跨 chunk 输出、过期与非过期区分、HTTP/status deadline、run abort、旧 launch 隔离、持有 pipe 的 descendants 清理；跨包验证贯穿 WdaManager → AppiumDeviceBackend → physical preflight，证明签名错误与恢复提示保留、Appium session 未启动、没有自动修复。修复前两个关键用例分别退化为 timeout 和错误的 ready，修复后通过。

本轮只修复错误报告与生命周期等待逻辑，未重签、覆盖安装或实际启动设备上的 WDA；当前环境恢复及修复后 G5 仍需单独授权与真机验证。DEF-034 所述 AUT build/validation 的独立取消链缺口仍保持 open，不以这里的 WDA 取消测试替代。
