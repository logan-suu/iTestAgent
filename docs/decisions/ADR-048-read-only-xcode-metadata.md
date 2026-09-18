# ADR-048：所属 Xcode 的只读 Apple Events 元数据

> 当前范围（2026-09-17，ADR-050）：用户已批准将 physical 有效零扫描及独立 memgraph 自动化延期至 T7.8/DEF-037；T6.12 优先补齐当前 XCUITest/解释/failed-only 出口。以下相关研究记录作为历史证据保留，不再要求继续 probe；未完成能力不标通过。当前清单见 `docs/06-verification/t6.12-exit-matrix.md`。

状态：2026-09-17 用户明确同意只读元数据通道；实际 App 运行和系统授权另行审阅。

## 背景与比较

AX 窗口销毁只能证明窗口不可用，不能证明 NSDocument 已关闭；不能用目录 inode 或窗口不存在来释放完整 capture lease。继续只使用 AX 无法补齐该来源。私有 Xcode 框架和 Cocoa 内部实现键违反 R1，不采用。公开 Xcode.sdef 已提供 documents、workspace documents、path、modified、loaded、active scheme、active run destination/device/device identifier。

## 决策

增加公开 NSAppleEventDescriptor 的固定 get-data 查询，仅绑定 MemoryOwnedAppHandle 所保留的本次 Xcode。禁止任意脚本、任意 property/event 输入、Run/Stop/close/set 和 bundle-id 广播。只有 read enum 可构造事件；不调用 sdef 中显示的内部 Cocoa selector。

查询字段限文档路径/修改状态、公开document.file的有界类型/缺失值诊断、workspace 加载状态、scheme ID、目的地 platform、设备标识和 generic 状态。不查询源码、控制台、环境变量或设备内容。结果仅保留内存，错误使用固定分类，不输出原始 AE reply/error 文本。有界响应、列表数量、字符串长度、消息及总期限，前后核验 owner/取消；返回两次一致快照仍不宣称原子或目标进程身份。

正常查询不调用可能无界等待的 permission-determination API；有界发送同时指定 neverInteract 与 do-not-prompt-for-user-consent。缺少 Automation 权限即不可用，不能复用 Accessibility 授权。新 App 的实际 Automation 授权在候选可审阅后由用户执行或具体授权；如使用 AEDeterminePermissionToAutomateTarget 申请，必须在后台线程，并独立处理授权等待生命周期。

完整文档清单为空是“该观察时刻没有开放文档”的候选证据。只有同一 owner、原窗口连续性/销毁观察、无未知文档/修改及 debugger/AUT 原实例关闭等条件共同成立，才能进入完整资源收口；该模块不产生 cleanup proof，不请求退出，不释放 lease。设备标识只补充目的地观察，不把所选目的地与正在执行的 LLDB 进程自动等同。

## 后果与验证

固定查询编码与严格回复解析可离线用真实 AEDesc 测试；实际 Xcode 响应类型、空清单、权限拒绝及关闭观察仍需宿主验证。公开接口可用不等于本机实测通过。ADR-044/046/047 的 owner、单次权限和闭合门禁不放宽。

本机依据：Xcode.app/Contents/Resources/Xcode.sdef；公开 Foundation NSAppleEventDescriptor.h、CoreServices AppleEvents.h（AEDeterminePermissionToAutomateTarget 和 kAEDoNotPromptForUserConsent）。不使用私有接口。

## 首次实测与编码修正

0.1.0单次无工程Xcode验证未通过：元数据未确认、自动关闭未确认，随后经用户明确授权普通Quit恢复；不算G5。离线公开AECreateDesc对照确认typeAbsoluteOrdinal不能以手写ASCII字节代替本机OSType表示。改由公开API创建typed ordinal，回归先RED后GREEN；旧测试直接比较同样错误的字节，未能识别该缺陷，已纠正为公开API基准。

新版补充固定诊断：query/failure枚举、descriptor类型数值、有界数量与OSStatus，首错冻结，不输出原始响应或错误文本。编码缺陷确定，首次真实失败的唯一原因仍待0.1.1实测；详见metadata-probe-plan。实现和诊断不扩大事件或权限范围。

## 启动状态与有界诊断补充

0.1.1首条documentPaths实测返回-1712超时，尚未进入解析。0.1.2候选增加公开isFinishedLaunching检查与有界等待；它只证明应用启动阶段结束，不证明Apple Events已就绪。单条查询上限2秒，仍被调用方和owner期限约束，不自动重试。诊断仅增加启动布尔值与有界耗时，首错冻结。离线29场景通过不替代本机验证；详见metadata-probe-plan。

## 0.1.2无工程宿主验证

一次实际空文档查询及退出前复查通过，probe记录observed_empty_closed并退出；最终独立进程核验无残留。界面核验工具可能重新启动的Welcome实例另经普通Quit关闭，独立留档。非空workspace/scheme/device字段仍无实测，不据此宣称生产provider或G5通过。完整证据见metadata-probe-plan最新段。

## 非空workspace准备

公开字典要求loaded后才能读取workspace对象属性；读取器在未loaded时拒绝继续读取scheme/device。独立诊断App可在另行确认后经公开NSWorkspace打开单一临时项目，固定只读loading查询在原期限内等待后再执行双快照。Apple Events事件范围不变，不新增Run/Stop/close/set。非空匹配和所属Xcode退出不冒充独立NSDocument关闭或AUT身份。0.1.3仅候选，未实测。

### 0.1.3非空验证结果

单次非空临时项目workspaceLoaded发送超时（-1712/1986ms），未取得元数据，自动cleanup未确认。已按本次授权正常退出两者，独立检查无残留。Xcode重写临时共享scheme，旧项目manifest不再有效；源文件及pbxproj未变。根因尚未确定，不重试，不计G5，详见metadata-probe-plan最新记录。

### 0.1.4分阶段实测

同实例空基线、项目打开、加载与文档/scheme解析通过；deviceIDs在17ms返回list(1)但条目validation失败，未取得完整非空snapshot。未查询platform/generic；不证明设备身份。本次正常Quit恢复后无残留，旧helper/项目清单未变。新增离线条目类型与固定拒绝原因诊断，47场景通过；不放宽解析。详见metadata-probe-plan最新段。

### 0.1.5复验未到设备解析阶段

空基线首条documentPaths在2003ms超时，未打开项目，未取得新的deviceIDs诊断。对比0.1.4首条1972ms成功/后续11ms，仅支持继续区分初始事件处理与稳定态读取，不能认定根因。正常Quit恢复后无残留，helper与项目清单未变。两项阻塞独立保留，不重跑已消费额度。

## 文档观察与目的地观察的失败隔离

固定只读文档双快照允许独立于目的地字段解析：只读四个文档字段，不返回目标身份；完整目标路径不接受该不完整snapshot。目标解析失败不能据此宣称捕获可用，但无debugger/AUT的独占诊断项目可用重新观察的原目录/未修改/无额外文档证据决定正常退出。生产debugger/AUT/lease完整关闭约束不变。显式诊断首条documentPaths允许一次8秒预算，默认稳定态2秒不变；总期限、不可重试和owner约束保持。候选0.1.6尚待真实验证。

### 0.1.6结果与诊断补齐

空基线/项目打开/加载通过，独立文档观察失败；因独立reader诊断未加入receipt且匹配仅返回bool，实际失败原因未区分。已补独立解析分类与五项布尔匹配诊断，严格门禁不变。原Xcode/probe普通Quit恢复后独立核验无残留，文件未变。本轮未到设备字段，不计G5，见metadata-probe-plan最新记录。

### 0.1.7明确的集合匹配结果

独立文档双快照解析成功，但完整documents多于一个，未满足单workspace一对一匹配；unmodified=false是与[false]不相等，不能推断存在修改。额外文档触发暂停，经用户另授权普通Quit恢复后独立无残留。下一步需取得关联范围的聚合分类证据后决定归属规则，不直接放宽门禁；未到deviceIDs，不算G5。

### 文档集合聚合诊断

0.1.8候选只输出有界文档数、修改数及相对审阅项目/临时根的位置分类。realpath失败记unknown，符号链接解析后按完整组件分类；位置不等于ownership，不据此放宽退出规则。53场景及构建检查通过，尚未真实运行。

### 0.1.8聚合分类实测

2 documents/1 workspace/0 modified；其中1个原项目、1个realpath不可解析条目，其余位置计数为0。未知条目性质不能推断为内部虚拟文档或外部文档，单文档关闭门禁未通过；未到deviceIDs。授权普通Quit恢复后无残留，旧helper/项目清单未变。必须先明确公开文档语义和关闭前置再改规则，不把本轮作为G5通过。

## 2026-09-17 已确认的有限诊断补充

用户确认增加固定document.file只读形状，且在专用无debugger/AUT诊断中允许额外未修改文档下继续只读目标查询。每轮目标查询前重查原完整文档快照、单workspace loaded、全部未修改及目录binding；owner/取消/期限不变。file失败与目标诊断隔离，不解析alias或输出payload，计数不产生对应关系证明。严格自动退出/身份/lease条件均不放宽。69场景离线回归与0.1.9候选构建通过；安装实测另需具体授权，见metadata-probe-plan顶部。

### 0.1.9授权等待实测

已安装且单次运行在permission_pending后约60秒记录cleanup_unverified，未到任何元数据查询或项目打开。工具禁止读取系统授权窗口，未绕过；已授权普通Quit恢复后独立无残留，helper/项目未变。无需再次换签名，先明确用户侧Automation权限再决定新运行；本轮额度已消费，不算G5。详见metadata-probe-plan顶部。

### 0.1.9 observe结果

用户另授权的一次observe通过空基线与项目打开；2个未修改文档均返回file表示（不证明磁盘存在/归属），deviceIDs条目为typeType而非字符串，具体typeCode尚未记录，不能认定missing value。严格退出未通过，已授权普通Quit恢复后独立无残留、文件未变。无新G5，见metadata-probe-plan最新证据。

### 0.1.10离线分类补充

现有typeType仅输出missingValue/otherType/malformed；realpath错误输出固定errno类别计数。无新增查询字段、无任意值输出或门禁放宽。74场景及候选构建通过，尚未安装实测；真实两项阻塞仍未解决，见metadata-probe-plan。

### 0.1.10实测分类与恢复暂停

本次Mac项目deviceIDs实测cMissingValue；额外文档realpath实测ENOENT，归属仍未知，不放宽校验。UI工具因轮次错误不可用，尚未发已授权普通Quit；原Xcode41776/probe41757保留，下一用户消息后优先恢复。完整证据及限制见metadata-probe-plan顶部，无新增G5。

### 0.1.10恢复完成

下一用户消息后UI工具恢复，原Xcode41776/probe41757各一次普通Quit完成；独立确认无残留、helper/项目未变。自动cleanup失败与授权恢复成功分开记录，无重跑或新G5。见metadata-probe-plan最新记录。

## 2026-09-17 ADR-049文档关闭来源补充（已确认）

用户已确认[ADR-049](ADR-049-xcode-document-process-closure.md)。document.closed可由保留原Xcode owner在期限内实际终止证明其进程内文档生命周期结束；不代表磁盘归属、保存成功或外部进程退出。额外未修改文档下Quit必须明确披露并取得本次动作授权，完整快照/目录binding/原owner复查仍必需。debugger、AUT、helper仍独立证明，unknown仍阻止完整lease释放。该条仅修订过去“Xcode实际退出也不能作为任何文档关闭来源”的绝对表述，窗口/PID消失或Quit请求仍不足。首个实现接诊断App，生产接线与真实G5未完成。

### 显式物理目的地候选

0.1.12已完成显式预期设备ID（仅内存环境）、有界选择等待及完整双快照匹配；98场景/类型/lint/构建通过，尚未安装实测。目的地匹配不等于运行进程身份。只读发现当前0台ready iPhone，连接及具体整批授权后才能继续；清单和授权范围见metadata-probe-plan顶部。

### 0.1.12所属文档自动关闭实测通过

iOS临时项目在唯一连接iPhone场景实测，ADR-049自动Quit/原owner实际终止产生owner_process_exited，probe自动退出，独立无残留、文件未变；无人工恢复。目的地观察40轮仅到platforms，尚不能区分missing或其他平台值，未到设备标识。保留destinationSelectionObserved=false，不算生产G5。详见metadata-probe-plan顶部。

### 0.1.13选择分支诊断

既有只读字段增加固定selectionReason和解析后sample记录，补齐0.1.12平台waiting分支缺口；不放宽iphoneos/设备ID匹配。108场景及构建门禁通过，候选未安装实测，0.1.12自动关闭通过证据保留。详见metadata-probe-plan。

### 0.1.13真实分类

40次平台查询均为公开missing value，arud/plat与本机sdef一致，未到设备ID字段；不放宽校验。原owner文档自动关闭再次通过，独立无残留、文件未变，无人工恢复。见metadata-probe-plan最新段，非完整生产G5。

## 固定单workspace平台对照（0.1.14候选，未实测）

既有9种get-data编码与公开CreateObjSpecifier构造一致；公开every属性语义允许集合查询，不能认定现有链式请求非法。增加同字段的固定firstWorkspacePlatforms诊断变体（workspace index 1/arud/plat），在单workspace完整文档检查前后夹住集合→单对象→集合查询。结果只有有限分类，不接受任意索引/属性，不回放返回对象，不作为目标身份或生产fallback；原期限、一次授权和无重试不变。129离线场景及构建检查通过，真实差异尚待验证。具体候选/授权清单见metadata-probe-plan最新段。

### 0.1.14实测结果

单次集合/单workspace对照在firstWorkspacePlatforms收到reply/-1728后按设计停止，没有后测或完整comparison结果。Apple将其定义为对象引用运行时解析失败，当前证据不能定位复合说明符中哪一层不存在，不证明集合语法错误或设备断开。ADR-049自动退出通过，旧helper/临时项目未变，原进程无残留。目标仍未验证，不计生产G5；详见metadata-probe-plan最新段。
