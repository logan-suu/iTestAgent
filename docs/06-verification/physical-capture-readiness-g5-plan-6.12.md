# T6.12 公开开始通知与取消传播真机G5申请

最新状态（2026-09-09，优先于下文历史）：本申请两项G5已完成。单次阳性run_01a08719-247d-7000-905a-ffb402712b7d passed；用户另行明确授权补跑后，run_01a08730-6748-7000-b10e-5510ab7eb39d在第一轮业务wait开始约602ms后取消，第二轮not_started。canonical、取消audit、owner清理及baseline不变均验证通过。中间一次监测路由失误的晚取消保留历史，不算精准场景。详见performance-capture-wiring-6.12.md顶部最新结论。本申请动作授权已消费，不重复已通过run；T6.12其他出口仍未完成。

状态：用户回复“好的我已经连上iphone了”后，已同意以下两轮具体G5；重新发现iPhone为ready。执行前发现baseline=skip缺少正常计划编辑入口，尚无构建/安装/WDA/tap，授权未消费。最小修复待确认（baseline-plan-edit-fix-6.12.md），验证通过后按本计划继续。2026-09-09。实现依据：physical-capture-readiness-plan-6.12.md，证据：performance-capture-wiring-6.12.md §39。

## 已核实前提

- 最新生产DeviceDiscoveryProvider只读发现1台physical iPhone：iPhone14,8、iOS18.2.1，availability=discovered，尚非ready。请连接并解锁；执行前必须重新通过生产发现确认ready，并在正常TUI明确审阅目标。发现设备不等于WDA或签名可用。
- 原多轮G5使用的独立临时MemoryProbe项目仍存在，配置bundle为com.itestagent.spike.MemoryProbe，已有本地Team配置；本次不更改Team或其他项目。签名有效性须经本轮生产preflight核验，不猜测或沿用旧PID。
- 已只读核实global Flow memory-probe-positive-rounds-v2可读，四步内容及下列语义SHA256匹配，未保存/覆盖；执行前重查confirmed来源、步骤和语义SHA256：dd101c1497d108927f690bab8db391921717fc7ff67faab4029ca4e39de7bfd1。若不匹配或缺失则停止，不保存/覆盖。

## 请求逐项授权的动作

以下只针对上述fixture与TUI重新选定的iPhone，顺序执行两个run。上一run异常则停止，不自动重试。

1. **正常单次录制run。** 从原临时fixture项目启动真实CLI/OpenTUI，使用实际provider及生产组合，不替换编排/设备/采集结果。授权本run一次正常构建/签名、只替换安装MemoryProbe、本次Route B WDA准备。计划明确：内存峰值/增长/泄漏，minimum70秒、settling10秒、采集器30秒余量、baseline=skip；启动后确认iTest Memory Probe可见，一次Run Leak Workload tap、20秒业务wait，确认Workload complete可见。仅批准这一次按钮动作，最多20项/5MiB已知fixture分配，不重复业务动作补采样。公开通知未就绪/采集或断言失败即停止。
2. **多轮取消run，仅第一轮一个tap。** 第1个run通过并完成owner收口后，第二次从同一临时项目进入正常TUI；授权本run一次构建/签名、只替换MemoryProbe、本次Route B WDA准备。复用上述Flow，审阅`/memory-rounds memory-probe-positive-rounds-v2 2 0`完整计划（70秒minimum/10秒settling/30秒余量、baseline=skip）。只授权第一轮Run Leak Workload tap；观察到第一轮业务wait开始后，通过正常TUI取消本run。**第二轮不得执行或授权tap**；若不能及时确认取消则按owner边界停止本次执行，不继续后续步骤或重试。最多另20项/5MiB分配。此次是取消验收，不期待完整采样或成功泄漏结论。
3. **每个run收尾。** 等待所属录制/通知/导出结束，关闭本次CLI/Appium/WDA会话并终止本次启动的fixture AUT，保留安装、Flow和所有证据。只处理本次owner，不按全局进程名杀进程，不操作其他App/设备。不覆盖或创建baseline；核对既有baseline数量和哈希保持不变。

每次TUI仍保留完整候选/目标/计划审阅和逐动作权限。目标、bundle、Team、Flow或计划语义与申请不一致时停止；不自动安装其他App、修改系统权限或切换采集路线。

## 验收证据

- 单次run：raw-local-only audit内注册通知、真实开始通知及ready事件先于业务动作；正常录制收尾、实际采样数/跨度/单位、阳性Leaks和三指标状态，以真实结果判定。canonical三件套和steps引用/大小/hash可重载；不以录制墙钟代替采样覆盖。
- 取消run：真实TUI取消贯穿第一轮Flow等待及采集，canonical cancelled、第二轮not_started、无第二次tap，不虚构0泄漏或有效覆盖。该轮失败/取消审计保留，本次所属notifyutil/xctrace及执行进程全部收口，延迟复查无遗留。
- 原始UI/trace/终端/通知输出均只在本地run artifacts；模型仅查看白名单时序事实、计数与状态。新结果不能替代physical有效零扫描、Simulator多轮/baseline、XCUITest或其他性能出口。

## 确认依据

AGENTS.md R7：`Every high-risk operation requires per-action confirmation`。本次两个run的构建/签名、替换fixture、WDA准备与各一个tap是新的具体动作；之前一次性授权已经消费。本申请不请求提交/推送或合并PR。确认后先复查ready，再按上述顺序执行。


## Recovery checkpoint (2026-09-09)

The approved baseline editor is implemented. Gates: 4097 pass / 7 existing skip / 0 fail, typecheck, lint (913 files), G2 (80 files) and gitleaks passed. Real CLI/OpenTUI reviewed baseline=skip, minimum70s/settling10s, three memory metrics and the authorized single-tap/20s wait goal. Execution confirmation was rejected by automatic approval usage limits; Enter was not sent.

After the user requested continuation, approval service checks succeeded. The original driver/CLI/Appium were still alive (sandbox process-probe permission errors must not be treated as absent processes). A MemoryProbe AUT was present, although this session remained confirmed=false with no run ID and Appium had no session/launch/click commands. Its ownership is unverified; it was neither terminated nor replaced.

Normal TUI cancellation closed this CLI/Appium with exit0; all three recorded owner processes exited, port4723 and socket were released, and both baseline hashes remained unchanged. AUT cleanup is explicitly unverified. No build/install/WDA/workload/capture was started; both approved G5 action sets remain unconsumed. Ask the user to identify or close the external fixture AUT, then recheck readiness and start a fresh reviewed session. Do not reuse old PIDs/socket. T6.12 remains in_progress, T6.13 pending; no commit/push.
