# T6.12 多轮内存真机验收申请

状态：首次授权执行在第一轮失败后停止；用户再次单独授权复测，修复后的正常TUI三轮真机G5已通过。以下历史申请及授权边界保留作审计，最新结果见文末。2026-09-08本地（UTC 2026-09-09）。代码与边界见ADR-042、performance-capture-wiring-6.12.md §29。

## 首次申请时已核实前提（历史）

- 当前发现一台physical iPhone，型号标识iPhone14,8、iOS18.2.1，availability=discovered，尚非ready。执行前须连接/解锁并由生产发现确认ready，再在正常TUI明确选择；不能从inventory状态宣称已连接。
- 新Flow ID `memory-probe-positive-rounds-v2` 的默认本地文件尚不存在。以下申请只允许新建该Flow；若执行时出现同名文件，停止，不自动覆盖。
- 独立fixture源码位于`fixtures/ios-memory-control/`，v2为每次tap一轮、最多十轮。本次只运行三轮；不接触其他App或用户项目。

## 本次请求的动作与顺序

1. 从仓库fixture准备新的临时Xcode项目，使用既有且用户认可的本地签名配置构建、签名；个人Team值只在临时项目/运行环境中读取，不写回仓库。
2. 只替换安装`com.itestagent.spike.MemoryProbe`，正常生产Route B准备本次所需WDA/Appium会话。替换安装可能影响fixture自身数据；不卸载其他App、不改系统权限。
3. 在`~/.itestagent/flows/`新建下列confirmed Flow，作为此次明确审阅的可复现资产。正常TUI审阅仍会展示实际来源、语义SHA256和全部步骤，发生变更即阻断。
4. 正常TUI提交目标“启动后确认iTest Memory Probe可见，运行已确认Flow并在每轮结束确认Workload complete可见；采集内存峰值、增长与泄漏，观察70秒，操作后等待10秒”。确认候选与设备后，修改草稿：`/memory-rounds memory-probe-positive-rounds-v2 3 0`，再确认完整TestPlan。
5. 三轮分别开始真实xctrace录制后，经TUI逐次批准具体按钮操作；每轮动作如下。各轮独立trace，轮间间隔0秒，采集器预留30秒采样余量。每轮540秒/整体30分钟预算触发取消，清理沿owner边界执行；任何断言、权限、进程或采样失败停止后续轮次，不自动重试。
6. 重载canonical bundle并校验schema、轮次/步骤/证据引用、真实采样覆盖、每轮阳性Leaks和末轮相对首轮终点变化。完整成功时仅允许按确认计划自动建立新的多轮baseline；不替换已存在的单轮或多轮baseline。结束后收口本次owner进程，并终止此次启动的MemoryProbe进程，保留安装与本地证据。

```yaml
schemaVersion: itestagent.flow.v2
flowId: memory-probe-positive-rounds-v2
source: user-authored
status: confirmed
supportedTargetKinds: [physical]
requiredCapabilities: [uiTree, coordinateTap]
lastValidatedTargets: []
steps:
  - action: tap
    target: Run Leak Workload
    locator: {strategy: identifier, value: run-leak-workload}
    safetyGate: ask
  - action: wait
    durationMs: 20000
  - action: assertVisible
    locator: {strategy: identifier, value: memory-probe-title}
  - action: assertText
    locator: {strategy: identifier, value: memory-probe-status}
    expectedText: Workload complete
```

每轮fixture最多制造5 MiB已知不可达分配，三轮最多15 MiB。fixture收据只证明动作；Leaks各轮可能重复报告既有分配，不累加成新泄漏量。有效零扫描、Simulator/XCUITest及其他性能验收均不包含在本次申请中。原始trace/XML/UI树/截图/终端输出只在本地run artifacts保存，模型仅接收白名单状态和聚合数据。

## 为何需要新的确认

AGENTS.md R7要求：“Every high-risk operation requires per-action confirmation”，并禁止跨会话持久化高风险allow。本次构建/签名、替换安装、WDA准备、保存新Flow与三次工作负载是新动作；既往baseline替换和真机运行的一次性授权已经消费。此文档将每项具体化供审阅，未提前执行；TUI内仍保留每项一次性确认。


## 本次执行结果与后续复测申请

用户授权后生产发现确认ready，已准备新临时v2项目、保存上述confirmed Flow、经正常TUI逐次批准构建/替换fixture/WDA和第一轮tap。生成run `run_01a083d0-2cbe-7000-9f9c-dad11f2f860f`：第一轮文本断言failed，第二/三轮not_started；没有新baseline。只读本地证据确认fixture仍Ready、零分配/零完成轮次；Flow旧坐标换算按固定1179×2556，而实际UI bounds为428×926，点击偏离按钮。已按原申请停止，结束CLI/Appium并终止fixture AUT，安装/报告/Flow保留。详情及修复验证见performance-capture-wiring-6.12.md §30。

**第二次复测的具体申请（用户随后单独授权，现已执行）**：从本次临时v2项目启动正常CLI/OpenTUI，复用已保存的`memory-probe-positive-rounds-v2`，不保存/覆盖Flow；TUI重查来源、全部四步和语义SHA256 `dd101c1497d108927f690bab8db391921717fc7ff67faab4029ca4e39de7bfd1`。授权一次正常构建/签名、只替换`com.itestagent.spike.MemoryProbe`、本次Route B WDA准备，并分别授权三次已展示的Run Leak Workload tap。完整计划仍为3轮、0秒间隔、70秒最小有效采样、10秒settling、20秒业务等待、原目标及Flow两条断言、截图和三项内存指标；每轮单独TUI确认，失败立即停止不重试。成功时只允许建立此前不存在的新多轮baseline，不覆盖任何既有baseline；结束后清理本次owner与fixture AUT，保留证据。新会话不得直接输入此前消费的allow，也不得只重跑失败子步骤跳过完整计划。


## 第二次复测结果

用户再次回复“授权”，按上述具体范围执行，未新增或覆盖Flow。正常TUI run `run_01a083e1-c0ff-7000-8ed8-eaf9b2178548`三轮passed，18实际steps、6cases全部通过；3个真实checkpoint分别显示1/2/3轮完成和每轮20次分配。每轮真实覆盖大于70秒，三项内存指标均collected。9项artifact与canonical重载通过；峰值58.82867431640625MiB、末轮减首轮终点10.234375MiB，建立新多轮baseline1份，旧baseline未改。正常退出CLI/Appium并显式清理fixture AUT，设备安装/报告保留。详见performance-capture-wiring-6.12.md §31。此轮一次性授权已消费，本文不授权未来重复运行。
