# T6.12 Simulator宿主PID内存采集验证计划

状态：用户已回复“确认”，已执行一次并停止；宿主目的地xctrace在通知/工作负载前exit21（Cannot find process for provided pid），按钮0次、trace0个。门禁与清理通过，采集能力未通过。生产代码未改。2026-09-09 UTC。

## 已有证据与本单元目的

上一单元的真实本地leaks阳性17项/4456448bytes、释放对照0项/0bytes均有目标/时间/退出完成证据；不重复这两次扫描。Simulator设备目的地上的Leaks+Activity Monitor则均exit2：`Activity monitoring service not available on this device.`。当前生产契约与正常TUI Simulator新增性能仍未完成，不能直接移除engine的physical条件。

AC原文：“泄漏结论必须来自真实诊断证据，区分检测到、本次检测未发现与无法检测；内存增长不能直接判为泄漏，未发现不承诺不存在所有泄漏。”

ADR-011原文：“Simulator reports must carry `environment = simulator`, `representativeOfPhysicalDevice = false`, `comparisonScope = simulator_only`.”

本机公开xctrace record usage明确：`If target device UDID or name is not specified — host device is used for the recording.`；同时提供`--attach <pid|name>`与`--notify-tracing-started`。`/usr/bin/notifyutil`存在。usage是候选路径依据，不是采样成功证明；该次`record --help`本身exit46并打印usage，未启动录制。

## 请求确认的具体动作

1. 核对磁盘工程余量、原owner唯一ID/名称/runtime、已安装fixture以及专用端口空闲，复用专用iOS18.2 iPhone16Pro Simulator并boot。保留所有设备、runtime、缓存和证据，不创建或覆盖安装fixture。
2. 准备本次独立Appium/WDA会话（4727/8213/9213、原owner独立WdaDerivedData）。本次允许该WDA准备与fresh launch已安装MemoryProbe；不触碰物理iPhone、其他Simulator或签名/凭证配置。
3. 使用已有公开Appium/simctl/ps realpath和启动时间组合，先绑定该Simulator的AUT到唯一宿主PID；无法绑定即停止。准备新的raw-local-only证据目录。
4. 只运行一次宿主目标`xctrace record --template 'Activity Monitor' --attach <bound host PID> --output <new trace> --time-limit 600s --no-prompt --notify-tracing-started <unique owner notification>`，省略`--device`按公开语义选择宿主。只附加精确PID，不使用all-processes，不添加Leaks/VM Tracker，不把未知列猜作footprint。
5. 先核对公开notifyutil参数；启动本次owner专用通知观察进程，等待真实开始通知并检查xctrace仍存活且无已知失败。`Ctrl-C to stop`提示不能单独触发工作负载。30秒未就绪或工具错误立即停止并清理，不点击按钮、不替换路径重录。
6. 真实就绪后只点击`Run Leak Workload`一次，允许这一次fixture分配；等待20秒，断言标题/完成文本、receipt20分配/0释放/1轮，并重核同PID/启动身份。不能根据旧receipt判本次成功。
7. 保留最低70秒观察、10秒settling与30秒采样余量，600秒录制硬上限；失败/提前退出停止后续阶段，只有有效录制才沿公开TOC导出实际列并按PID筛选。记录真实样本数量、时间跨度、footprint列语义和coverage；不把宿主全机内存、其他进程数据或Allocations总量冒充该AUT内存。没有有效列就明确not_exportable。
8. 结束本次录制/通知观察/Appium/WDA/AUT并关闭专用Simulator；只操作本次owner。保留设备/安装与所有证据，不写baseline、不保存Flow、不提交推送。无自动重试授权。

## 代码/契约与验证边界

本单元只修改临时probe编排及仓库验证/交接/任务文档；加入录制开始通知和fail-closed控制，不改生产源代码或schema。先用不触碰设备的临时进程fixture核对：提示后错误不允许tap、缺少开始通知超时、capture失败阻断后续阶段、取消清理自身进程；这些检查不能替代真实采样。

成功条件是实际目标绑定、一次工作负载、真实导出且时间覆盖符合要求以及owner清理；不是只看到通知、exit0或trace目录。失败则收口并记录三假设排查；不自动切回Simulator目的地或其他模板。

若证据充分，后续另行确认生产实现计划：performance backend拥有Simulator/宿主身份与捕获生命周期；contracts区分native-leaks scan和xctrace-leaks-detail source、detected/not_detected及无效扫描；engine接线、报告与baseline域隔离；单测/跨包/真实PTY及正常TUI G5-SIM。实际采样尚未完成前不预先决定支持范围。真机零扫描、XCUITest新增性能及其他性能出口仍独立待完成。

## 产物

更新`simulator-memory-evidence-6.12.md`、`performance-capture-wiring-6.12.md`、handoff及task-status。原始trace/XML/UI只在新run artifacts，模型仅获取固定状态、脱敏错误和聚合。T6.12维持in_progress。

## 执行结论与恢复边界

原始证据在`~/.itestagent/runs/sim-host-memory-evidence-1788925514/artifacts/`。公开notifyutil的-1注册/通知握手通过；4项临时进程门禁检查通过。专用Simulator和既有fixture准备成功，fresh receipt为0分配/0轮；Appium、launchctl、app container/realpath和启动时间身份核对成功，实际--attach参数与该PID一致。省略--device的唯一一次Activity Monitor命令exit21，未收到开始通知；没有按钮allow、采样、导出或native leaks重扫。

门禁立即停止后续阶段并清理，probe exit1、notify observer被取消exit143、Appium与fixture cleanup及专用shutdown exit0。owner匹配进程0，其他设备状态与本轮开始快照完全一致，baseline2份且全部哈希未改。没有重试/换模板/改权限。详细三假设与证据限制见主证据报告的宿主路径节。

公开footprint帮助提供按PID的summary、JSON、bytes与有界sampling，但尚未扫描目标；新方案`simulator-memory-footprint-plan-6.12.md`待确认，不属于此次授权自动fallback。当前不能宣称Simulator峰值/增长或正常TUI G5-SIM完成。
