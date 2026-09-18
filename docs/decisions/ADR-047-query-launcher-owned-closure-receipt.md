# ADR-047：query launcher所属退出回执

> 当前范围（2026-09-17，ADR-050）：用户已批准将 physical 有效零扫描及独立 memgraph 自动化延期至 T7.8/DEF-037；T6.12 优先补齐当前 XCUITest/解释/failed-only 出口。以下相关研究记录作为历史证据保留，不再要求继续 probe；未完成能力不标通过。当前清单见 `docs/06-verification/t6.12-exit-matrix.md`。

- 日期：2026-09-17
- 状态：Accepted（2026-09-17 用户确认整批离线实现；不批准真实 App/Xcode/设备运行）
- 关联：T6.12、ADR-023/044/046

## 背景与证据

独立query App正常握手/退出及启动前EOF已经实测通过。launcher保留原NSRunningApplication并观察isTerminated，Bun等待其自有launcher退出。但v3协议终止于helper的closed帧，TS协调器只能将helper标为unknown；正常App结果也不能通过v3账本释放capture lease。

原约束：“helper进程无法自证自己已退出，由launcher观测；launcher退出再由Bun等待。”“任何pending/unknown阻止释放全局lease。”US-12.3 AC6：“取消贯穿录制、等待、导出及所属进程清理。”

这不是把unknown改成closed即可解决的问题：须传递经过原owner观察、绑定本轮已验证channel的证据。物理generation、Xcode/document/debugger/AUT关闭来源仍未实现，不纳入本回执的证明范围。

## 方案比较

| 方案 | 判断 |
| --- | --- |
| helper的closed或launcher exit0直接当全部清理 | 拒绝，不能区分观察者/资源范围 |
| 结果文件传任意cleanup JSON | 拒绝，缺少本轮连接与原owner绑定，容易错误复用 |
| 修改v3解释，旧closed自动升级为已验证 | 拒绝，破坏旧语义并隐藏证据缺失 |
| 新内部v4协议的launcher专属终态回执 | 采用提案；明确角色、绑定、终态及可证明资源范围 |

## 决策

### 独立v4与角色边界

v3保留原语义；新实验入口显式使用v4，不自动协商或降级。v4保留原有帧限制、顺序、session/request/strategy/commandSHA256/challenge绑定。helper到launcher的解码器只允许helper角色消息，绝不能接收或转发launcher专属回执。

launcher在完整收到helper closed、socket EOF、确认本轮原NSRunningApplication已退出且清单仍匹配后，直接向Bun所属stdout发一次`launcher_closure`终态帧，序号紧接最后helper帧。帧包含固定scope、manifestSHA256、launcher生成且绑定原launch回调对象的launchInstanceId及helper=exited。launchInstanceId只是关联本轮App对象的不透明标识，不能冒充物理进程generation。禁止从PID清单重建/接管owner。

只有受信任本地候选解析器验证的manifest/签名及受控启动句柄可建立回执来源；调用方任意字符串/布尔值、另一child输出或离线JSON不能成为证明。nonce防误重放，不替代owner身份。同UID恶意任意代码执行的隔离不在此机制保证范围内。

### 第一批仅允许no_target_resources

首个支持scope固定为`no_target_resources`，只能来自经过审阅并固定摘要的无resource-provider入口。候选验证需固定这个执行profile与入口/源清单；不能信任用户传入的profile字符串，也不能让拥有Xcode创建能力的运行分支自行宣布no_target。

该入口从未尝试创建Xcode/document/debugger/AUT，不能prepare查询或消费grant。出现prepared/decision/result、任一创建尝试、物理identity、未知provider或profile不一致，即拒绝该scope的回执。没有query不等于没有调试目标；此结论来自受验证的入口/owner事实，不能单靠消息缺失推导。

TS须同时核验完整v4消息链、唯一回执、原channel绑定、匹配manifest/实例、最终EOF、实际launcher exit0及stderr为空，才由内部验证器产出一次性能力并应用到本轮ledger。helper据此closed，launcher由Bun观察closed，下游四项保留确证not_created；最后调用现有proof消费入口释放本轮lease。不能接收外部JSON直接操作ledger。

任何身份已绑定或下游资源曾开始创建的会话，仍执行ADR-046全资源强匹配，拒绝no_target回执。应用回执失败后不清除unknown、不重试release。lease inode/owner元数据验证与替换防护不变。

### 取消与失败

第一批只释放完整正常no-target握手的lease。父EOF、deadline、发送后断连、stderr、缺少回执、无launch回调、未知退出、异步late callback均保留锁。当前cancel会关闭读取端，不能借实现回执顺便宣称取消路径可收齐证明；未来取消收口通道需独立设计。启动前EOF测试不能用于推断未观测的helper创建次数。

只允许证明准确的提前unsupported退出；不会使query、物理target或capture ready，也不解决真实Xcode清理。

## 批准范围

本次请求只覆盖离线实现与测试：v4角色/帧/回执状态机、固定候选profile门禁、验证器不透明能力、ledger组合，以及真实无GUI管道/socket/子进程配合fake launch owner的测试。公开App适配器只编译；既有v3签名候选、已安装App、系统权限均不改变，不运行App/Xcode/设备，不commit/push。

通过后再准备新签名候选及明确真实App运行范围。当前两个v3真实运行额度已消费，不复用。T6.12保持in_progress。

## 实现边界

v4使用单独的`prepareMemoryNoTargetQuery`，不改变v3查询协调器，也不导出生产命令。候选resolver校验完整清单、签名及明确记录在源码中的无provider源摘要快照，然后发放WeakMap记录的一次性空对象能力；JSON/另一个对象/重复使用不能启动该路径。摘要快照不是运行时从任意候选自动生成；源变更须重新审阅。签名回调为离线测试的受信任依赖注入边界，不是外部JSON字段；生产默认调用真实codesign并由native再次核验。

launcher向Bun转发的hello_ack/closing/closed均附加其生成的launchInstanceId与固定manifestSHA256，终态回执必须匹配首次ack的实例值。helper侧严格decoder不接受这些launcher新增字段，也不接受launcher_closure。原生回执持有本轮原owner对象，须已收到helper closed和socket EOF、原实例退出、清单保持匹配；只发一次。TS验证完整四帧、manifest/首次ack实例、请求与挑战、最终EOF和实际launcher退出，再在内部创建owner凭据并消费既有ledger的一次性proof。没有向调用者提供外部JSON转proof接口。

无目标分支的握手和关闭全过程限制在min(调用期限,5秒)，不进入权限等待。取消/超时/父EOF/缺少或伪造回执/退出未知/有stderr/清单漂移均不释放；已有物理identity或下游资源的任何创建历史拒绝no-target scope，目标描述符本身不等于创建历史。lease被替换时原inode/元数据防护仍阻止删除替代锁。
