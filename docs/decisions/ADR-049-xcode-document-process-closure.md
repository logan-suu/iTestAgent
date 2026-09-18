# ADR-049：所属 Xcode 文档的进程终止关闭证据

> 当前范围（2026-09-17，ADR-050）：用户已批准将 physical 有效零扫描及独立 memgraph 自动化延期至 T7.8/DEF-037；T6.12 优先补齐当前 XCUITest/解释/failed-only 出口。以下相关研究记录作为历史证据保留，不再要求继续 probe；未完成能力不标通过。当前清单见 `docs/06-verification/t6.12-exit-matrix.md`。

状态：2026-09-17 用户明确确认；原生来源与离线验证已实现，生产接线和真实验收尚未完成。

## 背景

ADR-044/046要求document、debugger、AUT、Xcode、helper逐项关闭，禁止把窗口消失或PID消失当完整证明。ADR-048补入公开文档元数据，但诊断实现额外采用documents恰好为一个项目路径的限制。0.1.8—0.1.10实际观察到一个workspace、两个未修改document；一个路径对应审阅项目，另一个路径realpath返回ENOENT。0.1.10还确认Mac目的地deviceIDs为公开missing value。两项事实不证明额外文档归属，也不表示iPhone标识不可用。

持续补充路径分类不能给不存在的对象建立inode绑定；公共文档路径也没有已验证的永久文档实例ID。需要明确document.closed语义，而不是绕过现有断言。

## 方案比较

1. 保留“单磁盘项目目录=完整文档集合”的自动退出前置：在已实测环境中阻塞，继续增加日志不能解决语义问题。
2. 忽略未知文档或按路径前缀认领：缺少归属证据，拒绝。
3. 对所属Xcode实例的文档采用进程内生命周期证据，并把退出授权与关闭事实分离：建议采用以下受限方案。

## 已确认决策

### 退出授权（退出前）

- 仅本会话独占启动、从公开launch回调保留的原NSRunningApplication句柄；启动前不能已有Xcode，不接管用户实例、不按PID重新认领。
- 原项目目录binding仍匹配、单一workspace loaded、完整文档双快照一致且全部未修改。缺失、不完整、owner变化、额外workspace均暂停。
- 额外未修改文档不被认定为临时项目所属，也不自动获得退出权。正常运行计划必须明确披露：将退出本次独占Xcode及其中全部未修改文档，包含无法证明磁盘归属的条目；在PermissionEngine取得对应会话、原owner和本次动作的一次授权。诊断阶段使用明确整批授权。旧实验授权不可复用。
- 只发一次正常Quit，不保存、不丢弃、不强退；出现保存/停止提示就暂停。观察超时保持unknown和lease。取消不产生新的业务操作；清理权限与本次动作绑定。

### 文档关闭事实（退出后）

- 将document.closed明确定义为：本会话所观察的文档在原Xcode实例中的开放生命周期已经结束。它不表示文件被保存、磁盘对象存在、文档没有在其他实例重新打开，或磁盘内容未改变。
- 只有保留的原NSRunningApplication报告isTerminated，且owner生命周期中无替换/身份冲突，才可为已关联原owner的文档集合产生`owner_process_exited`来源。单独PID缺失、AX窗口消失、Quit返回或元数据读取失败均不够。
- 这是拟采用的进程包含关系推论：原实例终止后，其进程内文档对象不再存活；并非Apple Events提供了新的永久文档ID。采用前需审阅实现中的owner连续性和终止观察，并以真实运行验证。文档若需表达跨进程资源，仍为unknown，不适用本来源。
- 关闭证据携带内部session/owner关联及固定来源，报告不输出路径或设备ID。不得把此前人工恢复结果追认为新provider/G5通过。

### 保留的独立约束

- debugger和AUT可能为独立进程，必须保留各自退出及原进程代际证据；绝不能由Xcode退出推导。
- helper单独验证退出；完整lease仍要求每一资源closed或经创建前账本确认not_created。创建已尝试却缺失身份继续unknown。
- 真实iPhone目标选择必须经公开目的地元数据与用户选定设备匹配，再与实际构建/LLDB进程代际绑定。Mac missing value保留unavailable，不制造ID，不把目的地匹配当运行进程身份。
- Apple Events仍仅固定只读元数据；不增加Run/Stop/Quit/set事件或任意脚本。普通退出沿用公开所属App生命周期接口。

## 实施和验收

1. 更新ADR-044/046/048的文档关闭来源说明与内部closure契约，在native owner/document组合中实现以上新来源；不将nil provider直接替换为常量成功。
2. 测试原owner实际终止、换PID/换owner、窗口消失但owner存活、取消、超时、保存提示、未知资源和晚回调；同时验证独立debugger/AUT的unknown仍阻止完整lease释放。
3. 准备一个无脚本/无依赖的iOS临时项目及签名候选清单。具体运行另行审阅：只打开并选择用户确认的已连接iPhone目的地、不Build/Run/安装AUT/调试；同一次读取文档和目的地，并验证正常退出及新文档关闭来源。
4. 只读目标和文档生命周期通过后，才推进实际构建/调试身份、capture/export及生产TUI到报告。AC7保持：“真机与 Simulator 能力分别实测，不能以独立后端 probe 或 fixture 单测替代生产链路验收。”

## 范围与风险

本决策改变的是document.closed的证据来源与额外未修改文档下的退出授权方式，属于ADR语义决策，已取得用户确认，按小步实现和验证推进。不会把已有Mac probe宣布为完成，不缩减T6.12剩余生产验收。主要风险是owner替换、文档修改的观察竞态及跨进程资源误归类；以上检查降低风险，遇不确定保持unknown，保存提示不得自动确认。

## 首个实现单元

- owner句柄新增originalProcessExitObserved，由原状态机在保留实例实际终止、身份无冲突、独立期限内才设置。观察过的身份冲突锁定，不允许恢复后认领；缺少PID、窗口消失、Quit返回、超时后的终止均不产生来源。
- MemoryDocumentProcessLifetime在owner仍current时关联session；只给进程内文档返回owner_process_exited，不改变磁盘归属或debugger/AUT证明。
- 诊断App新增显式--allow-unmodified-documents-quit选项；没有该选项仍沿用旧门禁。选项须由实际运行的一次授权覆盖，不因本ADR确认就启用。MemoryMetadataQuitGrant绑定原句柄/完整文档快照/期限；fresh快照、全部未修改、单workspace和目录binding复查通过后仅可消费一次，失败同样消费，不自动重试。
- 首个接线仅诊断App，生产helper-main仍nil provider；PermissionEngine到实际Quit的生产传输尚未实现，不能把CLI选项当生产权限来源。内部TS完整资源账本未放宽，新增测试确认document/Xcode closed仍不能代替debugger/AUT pending或unknown。
- 已审阅owner源码摘要同步到no-target source profile；旧签名候选不能冒充当前源码，已安装helper未修改。完整捕获协议和lease门禁不变。

### 显式物理目的地候选

0.1.12已完成显式预期设备ID（仅内存环境）、有界选择等待及完整双快照匹配；98场景/类型/lint/构建通过，尚未安装实测。目的地匹配不等于运行进程身份。只读发现当前0台ready iPhone，连接及具体整批授权后才能继续；清单和授权范围见metadata-probe-plan顶部。

### 0.1.12所属文档自动关闭实测通过

iOS临时项目在唯一连接iPhone场景实测，ADR-049自动Quit/原owner实际终止产生owner_process_exited，probe自动退出，独立无残留、文件未变；无人工恢复。目的地观察40轮仅到platforms，尚不能区分missing或其他平台值，未到设备标识。保留destinationSelectionObserved=false，不算生产G5。详见metadata-probe-plan顶部。

### 0.1.13真实分类

40次平台查询均为公开missing value，arud/plat与本机sdef一致，未到设备ID字段；不放宽校验。原owner文档自动关闭再次通过，独立无残留、文件未变，无人工恢复。见metadata-probe-plan最新段，非完整生产G5。
