# ADR-046：查询 helper IPC 与逐资源关闭证明

> 当前范围（2026-09-17，ADR-050）：用户已批准将 physical 有效零扫描及独立 memgraph 自动化延期至 T7.8/DEF-037；T6.12 优先补齐当前 XCUITest/解释/failed-only 出口。以下相关研究记录作为历史证据保留，不再要求继续 probe；未完成能力不标通过。当前清单见 `docs/06-verification/t6.12-exit-matrix.md`。

- 日期：2026-09-17
- 状态：Accepted（2026-09-17 用户确认，仅离线实现）；不批准生产路线或真实动作
- 关联：T6.12、ADR-023/032/036/044/045

## 背景及约束

原文：“PermissionEngine 是高风险操作唯一入口”；“Provider/Backend/Server 各自拥有自己启动的子进程，禁止跨 owner 接管（ADR-023）”。US-12.3 AC6：“取消贯穿录制、等待、导出及所属进程清理。”

已完成内部query协调、once grant、owner句柄、严格候选解析和无GUI中断测试；真实上层PermissionEngine与独立App helper之间尚无授权传输。现只读helper的NSWorkspace launcher经stdin EOF收口，0.5秒后可能forceTerminate helper，不能直接承载持有Xcode/debugger/AUT的有状态查询。保持旧只读入口行为，本提案另建有状态通道，禁止在缺少下游关闭证明时force退出持有者。

MemorySessionProtocol capture的闭合证明要求已有可信identity及所有资源退出。若还未建立可信物理identity就失败，此要求无法表达“没有创建任何调试目标”的安全退出；不能凭空填generation、伪造AUT exited或套用owned_app_only scope释放锁。需要明确resource未创建与未知的区别。

## 比较与提案

| 方案 | 结论 |
| --- | --- |
| argv/env/磁盘文件传allow或nonce | 不采用：易重放/混淆启动配置与授权，授权材料不落盘 |
| 直接Bun.spawn App内部二进制 | 不采用：本机已有CLI与正常App权限结果不同的实证 |
| 沿用只读launcher的结果文件与强制终止 | 不适合有状态查询的双向授权和资源关闭 |
| 独立stdio桥接launcher + 私有Unix socket到NSWorkspace启动App | 提议采用内部实验通道；无需第三方服务或公共网络监听，需peer/顺序/期限验证 |

### IPC 边界

Bun通过自有子进程stdin/stdout与新query launcher交换有界帧；launcher通过本轮0700临时目录中的Unix domain socket与其NSWorkspace启动回调返回的helper交换。socket路径是非秘密定位信息，可在App启动参数传递；授权及挑战值只在内存/连接中传递。helper无自动UI副作用，握手完成之前不得启动Xcode或创建资源。

launcher使用公开getpeereid和LOCAL_PEERPID核验对端UID/PID，并结合保留的NSRunningApplication、bundle路径/完整构建清单、实例存活及本轮challenge关联。helper核验launcher对端凭据和预期启动信息。随机challenge只能防止意外重放，不替代peer身份；同UID恶意进程、任意代码执行和校验到动作之间竞态不宣称完全隔离。LOCAL_PEERPID等在本机公开SDK sys/un.h可用，原语存在不代表整体握手已实测。

本轮只一个连接、一个session、一个request；严格版本/sequence/session/request/strategy/命令SHA绑定。帧上限16KiB、增量buffer上限32KiB、初始握手5秒、单次授权等待最多120秒（沿用PermissionEngine期限），每步到期均关闭新语义动作。错误/重复/乱序/额外字段/截断/断连失败关闭，禁止重连重试。Bun是其launcher唯一父owner；launcher是helper唯一启动owner；helper是其Xcode及调试资源owner。

流程：连接确认 → helper报告固定prepared描述符（候选命令摘要与原生owner关联）→ 上层PermissionEngine对interact_sensitive_ui给出当次决议 → launcher转发一次授权 → helper匹配本地PreparedMemoryIdentityQuery/owner并消费 → query候选结果 → 逐资源closing → helper正常退出 → launcher独立观测退出 → TS最终清理判定。授权之前所需的打开工程/启动调试等动作必须有它们各自先前已确认的权限；不能用“查询授权”倒推授权其他资源创建。

新stdio是控制协议，不能同时交给旧MemoryParentLifetime把任何字节当取消；必须只有一个读者，负责帧解析与EOF，并复用线程安全cancel latch语义。信号、断连和期限先置取消，AppKit清理仍在main。发送grant之后的通信故障不能宣称未执行；保持attempt/unknown记录，不擦除、不重发。

### 逐资源关闭账本（提议内部协议v3）

资源类型固定：helper、Xcode、document、debugger、AUT。每项为not_created、creation_pending、owned、closed或unknown。只有owner记录的创建前状态可为not_created；一旦尝试创建即进入pending，不能因未收到回调改回not_created。任何pending/unknown阻止释放全局lease。

closed必须来自对应owner的观测，关联本次实例/资源身份；helper进程无法自证自己已退出，由launcher观测；launcher退出再由Bun等待。query结果/AX动作成功/Stop禁用/文件存在不是关闭证明。若已建立物理identity，保持现capture identity强匹配和各资源关闭要求，不能以新ledger降低它。

若尚未获得物理identity：仅对确证未创建的debugger/AUT允许not_created；如果已尝试调试或启动AUT而身份未知，保持unknown和lease，不编造关闭证明。已拥有的Xcode/document/helper仍必须逐项关闭。此规则可释放“实际未创建目标”的提前失败，不能保证所有未知失败可自动回收。

原protocol v2和owned_app_only已有调用保持原约束。新v3 ledger/decoder另建内部模块，并让lease释放入口只接受经本轮可信owner证据校验的终态证明；不能直接以外部JSON ledger调用release。具体权限桥及终态类型仅包内使用，不新增公共CLI/config字段。

## 批准范围及接受条件

仅请求离线实现：有界协议状态机、无GUI子进程/Unix socket真实通信、fake launch owner、假资源创建/关闭观测、现PermissionEngine的一次allow/deny/abort桥，以及提前失败资源账本负例。公开App launch适配器只编译，不运行；不升级旧固定helper/Return fixture，不更改权限，不发AX/CGEvent，不启动Xcode/设备，不commit/push。

通过不等于真实资源观测来源已存在。后续仍须为每一种Xcode/document/debugger/AUT证明实现并实测来源；缺失即保持unsupported/unknown，而不是自动采用模拟账本结果。单独真实候选及明确安装/动作额度确认后才可进入App/Xcode验证。


## 离线实现结果（2026-09-17）

独立query协议/launcher/Unix socket、真实PermissionEngine桥及v3资源账本已实现。正常App启动适配器仅编译，无默认生产入口；通过注入manifest验证器、保留原NSRunningApplication并在main核验，worker驱动协议，不接管旧preflight launcher。原生grant匹配本地PreparedMemoryIdentityQuery与owner，消费一次并复用Return exchange；新通道使用自己的cancel latch，不复用旧stdin reader。

协议字节16KiB/缓冲32KiB、严格字段/序号/绑定、5秒握手/最多120秒权限等待、总期限均有界。权限等待同时读控制通道，提前数据/EOF取消真实pending ask；发送grant后错误保留attempt，不重发。launcher用getpeereid/LOCAL_PEERPID、私有目录与socket inode/模式检查；单连接，不force终止资源owner。stdout背压时仍检查取消/控制管道及期限。生产方仍须提供完整manifest验证和资源owner观测，不能仅凭这些适配器宣布支持。

新lease proof由本轮ledger私有对象身份消费一次，外部JSON、别轮proof、未知/未闭合资源不可释放。物理identity须与预期target强匹配，并要求全部六项资源（含launcher）closed；无身份时debugger/AUT创建尝试不可降为not_created。原v2路径禁止绕过已经激活的v3账本。

验证：性能包及engine桥307 pass / 8 existing opt-in skip / 0 fail，2200 assertions、48文件；最后Swift改动定向复检2 pass / 57 assertions。typecheck、lint953文件、diff检查通过。沙箱初次禁止socket创建；获准在沙箱外重跑离线测试后通过。无GUI自有Process是真实socket/pipe/signals传输，fake App owner/假查询不是真实Xcode、物理identity或资源闭合实证。后续仍需真实helper候选、具体动作授权和G5。

## 2026-09-17 ADR-049文档关闭来源补充（已确认）

用户已确认[ADR-049](ADR-049-xcode-document-process-closure.md)。document.closed可由保留原Xcode owner在期限内实际终止证明其进程内文档生命周期结束；不代表磁盘归属、保存成功或外部进程退出。额外未修改文档下Quit必须明确披露并取得本次动作授权，完整快照/目录binding/原owner复查仍必需。debugger、AUT、helper仍独立证明，unknown仍阻止完整lease释放。该条仅修订过去“Xcode实际退出也不能作为任何文档关闭来源”的绝对表述，窗口/PID消失或Quit请求仍不足。首个实现接诊断App，生产接线与真实G5未完成。
