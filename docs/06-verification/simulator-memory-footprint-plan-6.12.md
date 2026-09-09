# T6.12 Simulator原生footprint采样验证计划

状态：用户已回复“确认”，本单元已执行通过：格式预检1次、有效采样41次、覆盖101.68秒、一次阳性工作负载通过；清理及baseline不变核验通过。2026-09-09 UTC。此为独立工具spike，不是正常TUI G5-SIM；生产接线仍待下一计划确认。

## 依据与限制

本地leaks已取得Simulator目标绑定阳性与完成零结果。Activity Monitor的Simulator目的地不支持服务，默认宿主目的地又无法解析已绑定PID；后一次门禁在工作负载前停止。生产峰值/增长与正常TUI G5-SIM仍未完成。

US-12.3 AC2原文：“内存增长来自目标进程真实带时间戳的采样，报告首尾、峰值、变化、样本数与实际覆盖区间，明确近似值；不足数据不得填零或判健康。”

本机公开footprint帮助支持`-p <pid>`、`-j <file>`、`-f bytes`、`--noCategories`；man说明默认统计强调内核计账的dirty memory。这只能支持尝试公开工具，不能预定JSON字段含义或宣称与Activity Monitor source等价。新结果仅属于simulator_only、representativeOfPhysicalDevice=false，禁止与既有physical/xctrace baseline混比。

## 本单元具体授权请求

1. 复查>=10GiB工程余量、原专用iOS18.2/iPhone16Pro Simulator唯一owner、安装及端口；复用并boot。准备独立Appium/WDA会话，沿用owner的WdaDerivedData与4727/8213/9213端口；fresh launch已安装MemoryProbe。不删文件、不新建设备/覆盖安装、不动其他设备与真机、不修改签名/系统权限。
2. 用已有公开Appium/simctl/ps组合绑定Simulator、bundle、宿主PID、executable realpath和启动时间，确认fresh receipt0分配/0轮；缺失或变化即停止。只选择当前用户拥有的精确PID，不按名字、不扫描子进程或全系统。
3. 在新的本地run artifacts进行一次有界格式预检：`/usr/bin/footprint -p <PID> -f bytes --noCategories -j <unique-json>`，15秒上限；前后身份核对，保存真实退出与时间。私下解析JSON，仅向模型投影键名/类型、目标匹配布尔值和有明确计量语义的聚合；不得输出地址、路径、region或原始stdout。若成功但含义无法确认，停止于格式调查，不点击按钮；禁止猜字段或将空文件补零。
4. 格式和目标可证明后，运行一个有界采样区间：用相同公开snapshot命令按约2秒间隔串行取样，每次10秒上限，最多60次、总区间最多130秒；不重叠命令。分别保留命令开始/完成的真实单调时间和wall-clock，采样时间记为完成时刻并附测量耗时，明确它是宿主工具观测时间，不冒称精确内核时间戳。每个样本都须有合法退出、明确bytes计量、唯一目标和前后身份稳定；一个无效样本即停止，不剔除失败后继续拼成健康曲线。
5. 首个有效样本后仅点击`Run Leak Workload`一次；允许这一次fixture分配。20秒业务等待期间继续串行采样，检查标题/完成文本及receipt20分配/0释放/1轮。采样和Flow共享AbortSignal，任一失败立即停止另一方，不重复按钮、不执行释放对照或leaks重扫。
6. 目标观察跨度最低70秒、计划采样区间约100秒（含30秒余量），动作结束后至少10秒settling；实际首尾样本跨度决定coverage，不能仅凭墙钟等待。只从真实该目标样本派生首尾、峰值、变化及数量，保持approximate和新来源标记；增长不判为泄漏。未达到条件则partial/not_exportable，禁止重跑补齐。
7. 终止并等待本次footprint/Appium/WDA/AUT子进程，只关闭专用Simulator；核对其他设备状态和baseline哈希不变。保留所有安装、设备、临时项目和证据；不保存Flow、不写baseline、不提交推送。失败只诊断留档，不自动改用vmmap、xctrace或root重试。

## 实现与交付范围

只写临时probe、格式解析和控制检查，使用现有owner subprocess、真实Appium/Flow；没有新依赖、私有框架、进程内注入或.trace逆向。先用临时fixture检验非法/缺失JSON、错误PID、exit/timeout、取消、样本时间不合法/覆盖不足不能通过，再做真实设备操作。

更新主证据报告、性能报告、handoff、INDEX与task-status；实际数据及字段语义充分后再给出生产MemoryGrowth source/单位/时间、native泄漏契约、backend/engine生命周期、独立baseline域和正常TUI G5-SIM的实现计划。本方案不预先批准生产schema/source修改或把tool spike当产品验收。T6.12保持in_progress。

## 实测结果

原始证据`~/.itestagent/runs/sim-footprint-evidence-1788964535/artifacts/`。JSON为unit=byte、bytes per unit=1、唯一process.pid与绑定目标一致；使用processes[0].footprint当前值，未使用auxiliary.phys_footprint_peak历史峰值，也未假定与Activity Monitor physical-footprint数值等价。临时通用校验5项/15断言及真实结构解析校验2项/8断言均通过。

42次footprint调用（1预检+41样本）均exit0、无failure，所有样本errors/warnings为空，目标/单位/值与原始JSON逐项核对。41个样本跨度101677.879459ms，首尾31.549301147460938→37.29930114746094MiB，峰值37.62742614746094MiB，变化+5.75MiB；实际间隔2458.295291–2986.278ms，最长命令测量346.9915ms，时间为宿主命令完成时刻。一次tap allow、receipt20分配/0释放/1轮、完成断言通过。

probe/Appium/shutdown exit0，backend closed/reusable、owner进程0，其他设备状态不变，baseline2份且所有哈希不变。未重扫leaks或生成trace。后续具体生产实现及正常TUI验收方案见`simulator-memory-production-plan-6.12.md`，尚待确认。
