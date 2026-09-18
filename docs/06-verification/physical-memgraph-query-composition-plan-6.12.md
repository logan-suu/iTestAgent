# T6.12 查询完整接线与候选清单计划

日期：2026-09-17。状态：用户已确认，离线接线及门禁通过。沿用ADR-044/045/046，不改变物理身份及关闭证明要求。

## 已核对的恢复点

T6.11 done、T6.12 in_progress、T6.13 pending；deferred-items无open项。上一批307 pass/8 skip是离线性能包+engine桥证据，最终原生定向2 pass/57 assertions。已有工作树改动全部保留，本次没有运行App、设备或重新消费历史授权。

规格原文：

> AC5 正常生产 TUI 到报告三件套贯通，采集期间有持续活动、阶段与耗时提示；报告列出指标、限制和本地证据路径；请求指标不可用时不显示全项成功。

> AC6 复用公开工具，不逆向 trace；原始 trace/XML 不进入模型上下文。取消贯穿录制、等待、导出及所属进程清理。

> AC7 真机与 Simulator 能力分别实测，不能以独立后端 probe 或 fixture 单测替代生产链路验收。

架构约束：“PermissionEngine 是高风险操作唯一入口”；“Provider/Backend/Server 各自拥有自己启动的子进程，禁止跨 owner 接管（ADR-023）”。

## 代码证据与接线缺口

1. `xcode-memory-helper-install.ts`固定旧helper/launcher源、协议1和0.2.0清单。新query包含多份Swift与Python资源，不能由旧installer验证或直接覆盖既有安装。
2. `prepareMemoryQuerySession`在run前请求权限；`runMemoryQueryTransport`在prepared后请求权限。两者直接嵌套会重复ask，或诱使调用方注入恒定allow。应抽取严格结果解析，完整IPC协调器只有prepared之后的一次真实PermissionEngine决议。
3. `createMemoryQueryPermission`仅publishAsk，未提供resolved通知；`agent-session.ts`已有pendingPermissionIds/pendingPermissions及permission_request/resolved通路。必须让拒绝、超时、abort、发布失败都清理同一callId，防止过期弹窗/迟到allow。
4. `MemoryQueryAppLaunch`仍靠注入manifestMatches，且App启动期间尚未进入bridge的stdin读取循环。完整入口必须在launch前启动唯一控制reader，父EOF/期限立即置cancel，迟到launch只保留原owner用于收口，不能发送grant。不能再启用第二个MemoryParentLifetime stdin reader。
5. v3账本现为owner-local能力。跨进程closed帧不是helper/launcher退出或Xcode/debugger/AUT清理证据。真实资源证明来源缺失时保留unknown和lease，不把fixture常量移入生产。

## 一次确认覆盖的离线实现批次

### A. 查询协调与权限UI生命周期

- backend新增内部`xcode-memory-query-coordinator.ts`，改`xcode-memory-query-session.ts`抽出共享纯解析器；保留旧内部API行为及回归。
- 协调器负责一次请求绑定、verified launcher依赖、IPC prepared后权限、严格结果解析及终态。结果始终为候选或明确失败，不发布physical ready。权限拒绝无query；发送后断连保留attempt，不重发。
- engine扩展`memory-query-permission-wiring.ts`的resolved回调，保证每次ask只产生一次终态；TUI新增小型query权限适配模块，并复用agent-session现有请求/应答/活动清理机制。采用可注入会话依赖做测试，不新增用户调试命令或放开默认capture路线。
- 验证真实PermissionEngine、TUI pending状态、late allow、deny/abort/timeout、事件发布失败，以及一次正常请求恰好一次ask。不得通过恒定allow绕过重复授权。

### B. 独立候选清单与原生入口组合

- 新增query专用候选清单/解析模块，与旧installer隔离。清单固定完整源集合、Python资源、plist、工具链、launcher/helper二进制及签名验证结果的来源；严格路径、文件类型、尺寸、无软链接/新增遗漏文件及内容漂移检查。
- 新增query launcher/helper入口源码，组合既有socket、App launch、原生grant与Return session。父控制reader在launch前即生效；原实例检查、manifest检查和期限贯穿准备/授权/退出。
- 实际Xcode创建/打开工程/调试启动所需输入与动作授权保持显式独立边界。缺少真实owner/关闭观察者时返回unsupported/unknown；不得从PID清单收养Xcode或沿用外部实例。没有可用生产资源观察者时不进入真实query。
- 本轮只在新建临时目录编译候选入口、生成源码/构建清单；不签名安装、不替换已授信helper、不执行候选App。签名验证适配器只用隔离fixture及注入结果测失败路径；未签名候选不能通过可运行就绪门禁。

### C. 资源owner组合及验证

- launcher/helper创建前记录pending；创建失败无回调保持未知。helper退出由launcher保留的原App实例观测，launcher退出由Bun实际wait观测；仅query closed不释放lease。
- 接入v3账本时区分本地owner证据与跨进程声明；暂缺的document/debugger/AUT物理证明明确unsupported，不引入新cleanup消息或弱化现协议。如果证明传输必须扩协议，应先记录具体决策再实现。
- 离线假owner覆盖父EOF发生在launch前/回调前/回调后、迟到callback、主线程延迟、授权期间断连、授权发送后中断、helper退出但下游未闭合、错误manifest/目标/世代和lease替换。
- 无GUI子进程/Unix socket组合测试继续使用真实管道与真实PermissionEngine；fixture身份和query结果明确标为合成。公开AppKit/AX/Return适配器只编译。

## 门禁与产出

Swift warnings-as-errors；新backend/engine/TUI定向测试；性能包默认回归（真实App/LLDB opt-in关闭）；TUI权限现有回归；typecheck/lint/diff。修改文档与task notes，保留T6.12 in_progress。不运行与此变更无关的真机或全仓库测试，不commit/push。

交付为完整离线组合、未安装候选清单、逐资源证明缺口表，以及下一次真实验证所需的具体候选/动作/清理范围。真实候选安装、授权变更、Xcode/设备操作和CGEvent仍须在候选可审阅后单独确定范围。不能以本批完成代替US-12.3 AC5/AC7或宣称T6.12完成。


## 2026-09-17 实施结果

A单元：新增`prepareMemoryIPCQuery`，直接在IPC prepared阶段调用一次PermissionEngine；旧query-session复用新纯解析器，保留既有API/测试。engine发布同callId的一次resolved终态；TUI适配器共享session pending集合、标准permission_request/resolved及activity清理，session注入钩子无新增用户命令、未启用默认capture路线。真实TUI session测试覆盖一次ask/resolve及dispose后的拒绝。

B单元：新增query专用候选构建与校验，25项文件覆盖Swift入口/公共模块、Python、plist和两个二进制，记录工具链与固定manifest摘要。候选路径和manifest/hash/文件类型/所有者/大小/软链接/新增遗漏文件校验与签名验证分离；签名验证失败不可得到可启动能力。原生launcher重新核验固定manifest和公开代码签名；旧安装器和旧helper未改。候选仅编译、未签名安装、未启动。

唯一父控制reader在launch前启动，预先EOF阻断启动；其后台线程在main阻塞/launch回调延迟时仍置cancel。原生helper会话由worker收发帧、main调用owner-bound grant/Return session；所有真实UI适配器仅编译。缺少生产owner provider的候选发送ack/closing/closed但不prepared，不触发ask或查询，协调器返回unsupported。

C单元：协调器在创建尝试前登记launcher/helper，launcher退出只由实际child.exited记录；目前不存在已验证的跨进程下游关闭证据来源，所以helper保持unknown，不凭协议closed或exit0释放capture lease。完整离线组合用真实socket、真实PermissionEngine、完整helper会话和假资源provider验证allow/deny/unsupported/missing-closure；fake query身份不能升级为physical verified。

### 候选产物

- 目录：`/private/tmp/itestagent-query-composition-QY43Gb/candidate`
- 清单：`candidate.json`，SHA256 `26d1d7908151fd1bdbbfec8a8cbdeb7de6e242a5f090e123d6119a8b302f1553`，25文件。
- 原生源快照与当前仓库逐项SHA256一致；候选标记runnable=false，签名验证测试通过注入false证明阻断。没有运行候选来宣称App身份或系统授权已验证。
- 类型检查、lint日志分别为`/private/tmp/itestagent-composition-typecheck.log`、`/private/tmp/itestagent-composition-lint.log`；候选构建元数据为`/private/tmp/itestagent-composition-candidate.log`。

### 逐资源真实证据缺口

| 资源/事实 | 已实现来源 | 尚缺的真实验证/接线 |
| --- | --- | --- |
| launcher退出 | Bun自有child.exited，已无GUI实测 | 正常App组合的退出路径实测 |
| helper退出 | launcher保留的原NSRunningApplication.isTerminated，编译通过 | 正常App实测；可审计传回TS的owner证明，不能由helper自证 |
| Xcode实例 | 既有owned handle和唯一实例检查 | query候选中实际创建、退出观测与动作额度 |
| document关闭 | 既有本地目录/文档身份绑定 | 同实例document关闭证据来源与未知窗口处理 |
| debugger/AUT退出 | ledger严格要求相同物理identity | 真实绑定与退出来源；PID列表/Stop禁用不够 |
| physical generation | 既有严格候选解析 | 可信真实来源；不以临时UUID或host fixture替代 |

下一真实验证应先限于独立候选App的launch/握手/无provider unsupported/父EOF/原实例退出，预期零AX/Return/Xcode/设备动作；需要先准备签名候选及其新manifest，再具体确认安装/运行次数和清理范围。本批未授权或执行该步骤。真实Xcode查询必须在资源provider与关闭证据方案完善后另行验证，仍不能直接开放生产路线。


### 最终门禁

- 性能包+engine权限桥：315 pass / 8 existing opt-in skip / 0 fail，2291 assertions、50文件、71.67秒。日志`/private/tmp/itestagent-composition-package.log`。
- TUI会话、权限适配及错误路径：97 pass / 0 fail，356 assertions、3文件。日志`/private/tmp/itestagent-composition-tui.log`。
- Swift全部候选入口与fixture warnings-as-errors编译通过；新组合真实无GUI测试已包含在性能包回归中。
- typecheck、lint959文件及git diff --check通过。未运行全仓库测试，不以这些离线结果替代G5/G5-SIM。
- 首轮类型检查发现纯解析器返回类型推断与测试断言类型问题，已补明确返回类型并修正测试类型；lint格式/表达式问题已修正。最终以上门禁均为修复后结果。

T6.12保持in_progress、T6.13 pending。本轮没有App候选启动、签名安装、Xcode/设备操作、AX/CGEvent、权限变更、commit/push。已安装helper/probe/controller二进制哈希复核未变化。
