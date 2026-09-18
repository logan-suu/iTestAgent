# T6.12 Simulator正常入口修复与复验计划

状态：用户已回复“继续下一步”，批准该计划；代码与两组正常TUI G5-SIM已通过，DEF-036已resolved（性能报告§38）；本计划设备动作均已消费，不自动重跑。前一计划在实际安装权限提示处按约停止，见性能报告§37、DEF-036。

## 依据与范围

AC7原文：“真机与 Simulator 能力分别实测，不能以独立后端 probe 或 fixture 单测替代生产链路验收。”

前一计划原文：“正常入口如要求额外build/install或遇到权限不符，停止报告具体情况；不绕过产品权限。”

实际发现：Simulator DeviceBackend的productionPermissionActions为空，但正常TUI把空集合默认映射为replace_device_app，造成没有安装也要求安装授权；正常TUI又无法传入专用Appium/WDA端口与owner DerivedData，不能按原计划隔离执行。不是采样器返回零或失败，本次根本未启动采样。

## 拟修改的可验证单元

1. **真实动作映射**：修改`packages/itestagent-tui/src/agent-session.ts`的executeTestPlan映射。确认计划和目标校验保留；没有实际高风险动作时使用明确的execute_confirmed_test_plan语义，不默认制造replace_device_app。实际physical/XCUITest构建安装、WDA准备、敏感UI动作仍逐项经过PermissionEngine；global deny、拒绝、超时与取消仍生效。不能移除安装/构建风险集合或把已有allow持久化。
2. **正常CLI瞬时连接参数**：在CLI无子命令TUI入口、TUI启动/session配置与production composition传递显式Simulator Appium连接选项（Appium URL、WDA/MJPEG端口、owner DerivedData），复用现有ProductionAppiumConfig。参数只对所选Simulator生效，不改变physical默认Route B，不写个人路径进仓库，不替换provider/discovery/backend或运行脚本伪造生产组合。URL限定本地连接、端口校验并阻止冲突；配置进入计划审阅说明，WDA实际准备有独立prepare_wda权限，AUT build/install不是此动作。优先采用单次CLI参数，避免写用户/项目持久化配置；若实现需要改变持久化配置或权限契约，先补充该决策再实施。
3. **验证与文档**：补充真实PTY native无虚假安装请求、实际WDA授权、physical/XCUITest仍分别询问、deny/cancel无后续命令、无安装AUT和正常参数透传测试。更新CLI帮助、规格/数据流与ADR-043实施边界，保留DEF-036原始失败证据。通过typecheck/lint/full bun test/schema/G2/gitleaks后，再进行下列具体G5-SIM。

## 拟重新确认的正常TUI实测

只复用原专用iOS18.2 Simulator及已安装MemoryProbe，Appium4727、WDA8213、MJPEG9213与该fixture的owner WdaDerivedData。允许boot和专用WDA/Appium准备；如需构建/覆盖AUT、改变系统权限/凭证或操作其他设备则停止，不能泛化此授权。

先正常生产CLI/TUI确认一次fresh launch、Run Leak Workload一次、业务wait20秒、Workload complete可见、peak/growth/leaks、最低70秒/settle10秒、baseline=skip的计划。只有首run完整成功且真实native-leaks为detected并清理后，才fresh launch并确认Run Released Workload一次的同配置对照计划。工作负载均不自动重试；失败立即停止依赖的后续run。敏感UI动作仅允许对应具体按钮一次，不新增Flow/安装/重建/基线写入，不操作物理iPhone。

从canonical plan/steps/result/artifact-index/summary验证真实动作、来源/单位/覆盖、扫描完成及原始证据引用/hash/size。0扫描只按工具实际事实判断，不为了得到0重复运行。原始内容不进入模型；cleanup自有采集/诊断/Appium/WDA/AUT，关闭专用Simulator，核对其他设备和两份既有baseline不变。保留App/设备/artifacts。完成后更新DEF-036状态与证据；T6.12仍需其余出口，不自动done、commit/push/merge。
