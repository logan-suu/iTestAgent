# T6.12 固定查询会话接线：离线实现计划

日期：2026-09-17。状态：用户已确认，离线内部接线实现完成；生产IPC和真实验证尚未完成。依据ADR-023/032/036/044/045；不改变生产路线采用状态。

## 原文约束

- “PermissionEngine 是高风险操作唯一入口”
- “Provider/Backend/Server 各自拥有自己启动的子进程，禁止跨 owner 接管（ADR-023）”
- US-12.3 AC6：“复用公开工具，不逆向 trace；原始 trace/XML 不进入模型上下文。取消贯穿录制、等待、导出及所属进程清理。”
- US-12.3 AC7：“真机与 Simulator 能力分别实测，不能以独立后端 probe 或 fixture 单测替代生产链路验收。”

## 已核验现状

1. 0.1.1测试controller的normal、cancel-before、cancel-after-down已验证固定App接收计数与自动退出；测试发送器没有调用生产MemoryConsoleReturnExchange，取消模式为固定检查点分支，不是SIGTERM/EOF。
2. Return exchange只在构造/提交/轮询中调用既有绑定检查；固定query资源、输入全文、输出增量和候选过滤已有独立合成覆盖，但未由统一查询session调度。
3. PublicMemoryConsoleReturnTransport持有NSRunningApplication，但参数类型本身不证明来自自有launch callback。现工厂未绑定sessionId、一次性用户决定或命令摘要。
4. runOwnedMemorySession严格限制owned_app_only。真实查询将依赖已打开工程/调试器，因此不能复用该scope的闭合证明来释放capture lease。MemorySessionProtocol的capture闭合还要求可信物理身份及document/debugger/AUT/Xcode/helper退出；当前候选身份不足。
5. MemoryParentLifetime使用主队列DispatchSource读stdin及信号。主线程同步AX调用期间通知可能排队；假cancelled闭包测试不覆盖真实通知调度。必须做无App最小验证，不能直接认定SIGTERM已贯穿。
6. parseMemoryDebuggerIdentity已有严格schema及请求匹配，返回DebuggerMemoryObservation仍为候选，不能转换成MemoryIdentityObservation.status=verified或physical ready。

## 本批目标与边界

建立可组合的内部查询协调单元，将“自有实例能力 + 一次性授权 + 固定query + exchange + 候选解析 + 取消”连接并离线验证。此批不负责自动打开工程/运行scheme/绑定真机，也不改变capture lease释放条件，不把App-only runner扩权。禁止Backend import Engine、禁止新增持久allow或仅凭JSON中的allow=true执行。

### 单元A：会话绑定与一次性授权

拟新增 `native/itestagent-memory-query-session.swift` 及对应Swift fixture/Bun编译测试。协调器只通过所属owner回调获得不透明实例句柄；无法在外部用任意PID构造。绑定sessionId/requestId/明确strategy/固定command SHA256及本次owner对象身份；摘要覆盖实际固定命令字节（含资源路径和请求），不同会话/命令/实例一律拒绝。内部grant单次消费，包括前置失败；拒绝后不能新建exchange复用同一grant。

注入的授权边界在离线测试中可用假provider；实际生产allow仍须来自PermissionEngine现有interact_sensitive_ui动作的本次决议，由上层闭包传入，不自行新增授权引擎。拟新增 `src/xcode-memory-query-session.ts` 协调有限请求/响应及strict candidate parser；依赖注入仅是内部边界，不把它称为已完成生产TUI授权。grant保存在内存且不记录至stdout/文件；本批无真正helper IPC授权传输或公开CLI入口。

单元A的所有权能力为进程内对象身份和生命周期证明，不声称抵御同进程恶意代码或PID复用的系统级原子性。应明确句柄只在owner存活期间有效，关闭/取消后不可重获。

### 单元B：实际exchange调度与输出分层

新增查询协调状态：待授权、已消费/准备、提交、等候候选、终止。复用PreparedMemoryIdentityQuery和MemoryConsoleReturnExchange，不复制一份发送器。AXConfirm仍是原策略，pidReturn必须在本次授权之前明确选择；禁止失败后切换。输出边界先于插入，只提交一次，由main-run-loop定时轮询有界receiver；单个回调返回后才能继续下一步，禁止忙等。

Swift结束输出仅请求绑定的候选行和固定attempt/reason元数据，TS层必须调用parseMemoryDebuggerIdentity并检查大小、额外字段、请求、来源关联。unverifiable/格式错误/重复/超时均不是观测成功。候选解析成功也仅命名observed_candidate，targetVerified=false；不驱动现有capture协议进入prepared。

协调器只声明query结束，不声明完整资源清理。所属driver继续承担工程/调试器/AUT/App退出；未拿到现有capture要求的证明时保持lease retained。此批不得伪造generation或调用owned_app_only释放查询占用的完整session。实际全资源清理接线留在后续具有明确物理身份依据的单元，不以放宽schema解决。

### 单元C：取消可见性与无GUI进程验证

拟修改 `native/itestagent-memory-parent-lifetime.swift`：先用无NSApplication的子进程最小fixture验证主线程暂停时的EOF/SIGTERM/SIGINT通知。若确认延迟，使用专属串行队列监测并以锁保护单调cancel latch；语义操作在同步调用前后读取latch，AppKit清理仍回主队列。最多一次onLoss，不让信号回调执行UI，不busy-spin，不修改其他进程信号策略。

沿用每次AX调用<=0.5秒及总deadline，取消后不再执行新写入/keydown；已经尝试down时，仅在原实例仍可核验时最多一次up配对。无法证明原实例或释放到达就保留未证实状态。SIGKILL、信号与系统事件之间竞态不作保证。

新增无GUI原生fixture和Bun子进程测试，使用真实匿名pipe、EOF和仅对测试自有PID发送SIGTERM/SIGINT；不创建NSApplication、不调用CGEvent、不启动App，不影响系统权限。覆盖预关闭、等待阶段、主线程受控短暂占用、多通知与资源回收。现App-only调用者兼容性必须回归，不能因修改onLoss线程契约引入跨线程AppKit调用。

## 验证矩阵与文件范围

| 范围 | 必须验证 |
| --- | --- |
| 会话/授权 | deny/未回答/取消、过期、错session/request/摘要/owner、重复grant，均0写入0发送；失败消费 |
| 完整假环境exchange | 使用真实exchange+假AX/事件适配器；边界早于写入、最多一写一对事件、候选严格解析及拒绝重复/旧响应 |
| 中断 | 无GUI子进程EOF/SIGTERM/SIGINT latch及主队列清理；不将固定模式分支当OS中断证据 |
| 生命周期 | parent丢失禁止新语义动作、unknown cleanup不释放lease；原owned_app_only与capture scope负例不变 |
| 原行为 | AXConfirm原回归、Return负例、owner/identity parser/lease相关回归 |

预期文件除上述新增模块外，包括native parent-lifetime、必要的owner内部句柄接线、query/session/parent-lifetime测试，以及native README、ADR-045实施记录、交接/task-status。不修改用户故事AC，不新增公共config/schema、默认renderer或后端路由。若实际需要新的跨进程授权协议或scope，应先补独立方案而非临时扩大本批。

门禁：Swift warnings-as-errors；上述定向测试；性能包默认回归（App/LLDB opt-in保持关闭，既有通知测试按需沙箱外）；typecheck/lint/diff。不把这些离线测试计作G5/G5-SIM。所有源码/检查点标记使用英文，不输出原始控制台或secret。

## 确认范围

本计划请求仅上述代码、离线假环境和无GUI自有子进程/信号验证。不是安装/重签已授权App、刷新权限、真实AX写入或CGEvent、Xcode/iPhone/Simulator操作或commit/push授权。后续真实验证须锁定独立候选、身份和事件额度，不能接管CUA启动的Xcode或重用已消费的三项App实证额度。

## 2026-09-17 已确认实现记录

用户“确认”批准本批离线实现。新增native query-session、TS query-session及三组测试；owner模块提供只能由已acquired会话创建的不透明句柄，校验所属生命周期和期限。grant绑定同一对象、session/request/固定命令SHA及pidReturn策略，带期限；前置失败/错对象/错请求也消费，不能复用。生产公开默认与原AXConfirm入口不变。

原生协调器消费授权后才创建实际MemoryConsoleReturnExchange，先建立输出边界再执行一次提交；RunLoopDriver轮询有界候选并报告固定结果。显式owned入口强制传入MemoryParentLifetime，实时读取取消latch并持续检查owner。跨语言测试用真实协调器/exchange和假AX/事件适配器产生原生JSON，再经TS严格解析；观测只能为observed_candidate、targetVerified=false、leaseRetained=true。

已复现旧中断监测问题：无GUI子进程在main Thread.sleep期间，父管道已EOF但回调未发生；main RunLoop恢复后才通知。证据 `/private/tmp/itestagent-parent-delay-evidence.txt`。现监测源在专属队列以锁设置单调取消标记，AppKit清理仍调度至main；读源首次就绪即cancel，避免EOF重复唤醒。真实EOF/异常字节/SIGTERM/SIGINT/组合通知、预关闭pipe和非pipe输入验证取消在main drain前可见、onLoss仅一次且在main。原owner政策fixture以无参数模式运行，所有真实App分支均未启用。

没有把注入provider当作已完成生产授权：上层PermissionEngine/TUI实际入口、跨进程grant传输/握手及真实helper驱动尚未接线。生产捕获scope仍要求完整document/debugger/AUT/Xcode/helper与可信物理身份的关闭证明；本批没有修改该schema或调用App-only释放capture lease。query结束不是资源退出。测试中拥有句柄与授权不是针对同进程恶意代码的隔离边界，也不消除OS信号/焦点/PID与发送间的竞态。

本轮无App/CGEvent/AX写入或设备执行，没有升级重签已安装helper/fixture或更改权限。已安装Return0.1.1完整文件哈希与原清单一致。没有commit/push、没有新增G5/G5-SIM，T6.12保持in_progress。

最终门禁：性能包280 pass/8 opt-in skip/0 fail，1680 assertions/44文件；Swift warnings-as-errors、typecheck、lint944文件、git diff --check通过。日志 `/private/tmp/itestagent-query-package-final.log`、`itestagent-query-typecheck.log`、`itestagent-query-lint.log`。未运行全仓库测试。
