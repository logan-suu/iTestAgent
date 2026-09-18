# T6.12 真机G5前的baseline审阅入口修复计划

状态：2026-09-09用户已确认，修复与全库4097 pass/7 existing skip/0 fail通过。此前两轮真机G5已获用户同意，但未开始任何构建/安装/WDA/工作负载；原动作授权未消费，修复验证后按原具体范围继续，不重复索取同一授权。

## 已有事实与计划遗漏

用户回复“好的我已经连上iphone了”后，生产发现已确认唯一iPhone14,8/iOS18.2.1为ready。原G5方案明确两轮均baseline=skip，但Agent此前未核对正常TUI能否设置该字段，这是验证计划遗漏。

按证据排序的假设：

1. 编译器忽略显式跳过基线，已复现。使用真实parseIntent→compileTestPlan、隔离项目fixture，分别输入baseline=skip、不要创建或更新基线、skip baseline，三次physical计划均为local_auto（70秒观察保留）。编译器当前只为Simulator native内存自动设skip。
2. 普通计划修改可更改baseline，代码核对否定。PlanningSession.modifyPlan只合并目标/指标/观察等字段，然后重新编译；没有baseline选择入口。Plan Review虽然把Baseline标为editable，但当前正常renderer路径只有统一修改输入。
3. 配置或现有TUI命令可满足skip，未找到证据。现有/baseline accept是既有报告的高风险替换，/memory-rounds只配置轮次，均不能设置本次计划策略。不得改canonical文件、注入测试依赖、换store root或静默执行local_auto来绕过。

因此停在设备高风险动作之前，未启动CLI/Appium/采集或AUT，没有新的真实run或baseline变化。

## 依据与最小实现

US-5.1原文：

> AC2 TestPlan 至少包含 target/device(targetKind+selector)/appSource/execution/features/testData/assertion/flows/metrics/performance(baselineDomain)/artifacts/report

现有TestPlan schema已经允许baseline为local_auto或skip；本修复不新增schema/Intent字段，不改变自动基线默认行为或扩大Simulator baseline支持。

1. 在PlanningSession的正常计划修改入口支持精确命令`baseline=skip`和`baseline=local_auto`，仅允许awaiting_plan_confirmation状态。将显式选择保留在当前planning session，经后续目标/观察条件修改、设备选择或memory-rounds配置后仍生效，直到完整计划确认。新会话不继承。Simulator native内存仍强制skip，不允许通过命令开启未实现的local_auto；无效命令或状态不修改草稿。
2. 在TUI计划审阅的Baseline字段说明精确修改方式，沿现有modifyPlan→planningPatches→重新审阅路径使用，不新增CLI参数、运行时替身或隐藏数据写入。切换策略本身不调用baseline存储；完整计划确认后，已有production-memory-baseline实现执行skip。
3. 回归覆盖草稿限制/非法值、目标与断言和Flow不变、普通修改及多轮配置后skip保留、默认local_auto兼容、Simulator native限制、新会话隔离；真实PTY通过正常修改入口显示并确认skip，生产执行→canonical验证不新建/覆盖baseline。运行typecheck/lint/定向及全库bun test/G2/gitleaks；同步规格实施补充、ADR-040/041/042、数据流、报告与handoff/task-status。
4. 上述门禁通过后直接恢复**已授权**的physical-capture-readiness-g5-plan-6.12.md：每轮TUI明确修改并审阅baseline=skip，再确认实际计划，按原一次阳性/一次多轮取消的动作及owner边界执行。执行前重查ready和Flow内容，不增加轮次、tap或其他高风险动作；任何条件不符则停止。

## 确认依据

AGENTS.md R8：`未经人确认的实现计划不得进入编码`。本次发现的是新的计划编辑入口修复，原确认只涵盖通知/失败传播和具体设备验证，不能默认为已批准新增编码范围。确认此小范围计划后，不再就原已授权且未消费的两轮G5重复询问。
