# ADR-045：受限原生控制台 Return 通道（实验实现）

> 当前范围（2026-09-17，ADR-050）：用户已批准将 physical 有效零扫描及独立 memgraph 自动化延期至 T7.8/DEF-037；T6.12 优先补齐当前 XCUITest/解释/failed-only 出口。以下相关研究记录作为历史证据保留，不再要求继续 probe；未完成能力不标通过。当前清单见 `docs/06-verification/t6.12-exit-matrix.md`。

- 日期：2026-09-17
- 状态：Experimental implementation approved；用户确认第一阶段离线实现，已实现并验证合成状态机；生产路线未接受、真实事件未验证
- 关联：T6.12 / US-12.3 / ADR-023/032/036/044

## 背景与规格

US-12.3 原文：“不得要求用户手动操作 Xcode/Instruments、导出内存图或搬运文件来完成每次测试；能力不足须明确报未完成，不能把人工操作作为本故事的验收通过路径。”

AC6：“复用公开工具，不逆向 trace；原始 trace/XML 不进入模型上下文。取消贯穿录制、等待、导出及所属进程清理。”

AC7：“真机与 Simulator 能力分别实测，不能以独立后端 probe 或 fixture 单测替代生产链路验收。”

0.1.3 原生只读宿主实证：工程/实例/焦点、空 prompt、末尾空选区、AXSelectedText 可写与输出范围读取通过，但 confirmAdvertised=false。现有 AXConfirm 策略在插入前拒绝是正确行为；不删除这个条件来伪装同一路线已可用。此前 CUA 固定短脚本成功是另一控制通道的证据，不证明原生键盘接口可靠。

## 接口依据与证据边界

Apple [Core Graphics Functions](https://developer.apple.com/documentation/coregraphics/core-graphics-functions) 列出公开 CGEvent 键盘事件构造和 postToPid。精确本机依据为 Xcode SDK 的 CoreGraphics/CGEvent.h：CGEventPostToPid 返回 void、指定 pid；CGPreflightPostEventAccess 检查已有事件合成权限；CGRequestPostEventAccess 可能提示授权。HIToolbox/Events.h 的 kVK_Return 为0x24。

本轮只查文档和 SDK 声明，没有构造/发送事件、调用授权请求或测试 Xcode。网页具体符号正文的 Markdown 抓取失败，函数签名细节依据本机公开 SDK；不依赖第三方博客。公开 API 存在不证明 Xcode 接受事件、权限已具备、PID 世代安全或生产兼容。

## 方案比较

| 方案 | 判断与代价 |
| --- | --- |
| 继续仅 AXConfirm | 当前控件不支持，保留明确 unsupported；不能完成此环境的自动提交 |
| AXPress、在 AXSelectedText 中添加换行 | 没有已验证提交语义，不猜测或自动替换 |
| 每轮人工 Return / 依赖 Codex CUA | 可作为调查手段，不符合独立生产和自动验收要求 |
| 任意全局键盘、AppleScript/System Events | 范围过宽，排除；不发送到全局事件流 |
| 独立原生、只向已核验进程的固定 Return | 推荐作为显式实验策略；需新增实现、事件权限检查、状态机/真实宿主验证，失败仍 unsupported |
| 独立 LLDB 附加、私有 Xcode 接口或修改 lldbinit/scheme | 当前无证据证明能安全复用 Xcode 已有调试会话，不作为本次捷径或范围 |

## 已批准的实验边界

只允许开发阶段内部显式选择 `pidReturn` 候选；原 `axConfirm` 保持默认/原语义。禁止运行时遇到 AXConfirm 缺失或开始后失败便切换。生产路由是否采用该候选，要在后续真实验证、权限集成及完整生命周期完成后另决策。本提案不是通用桌面自动化接口。

1. 输入只接受既有 PreparedMemoryIdentityQuery 与本次自有启动返回的 NSRunningApplication、会话 token；没有任意 key、修饰键、脚本或调用方随意 PID 参数。未来一次性授权须绑定请求号、会话、固定命令摘要和目标实例，不能跨会话保存 allow。
2. 可测试策略通过注入环境检查现有 AX 权限和事件发送权限。仅检查，不调用 CGRequestPostEventAccess、不新增 Input Monitoring、不安装事件监听 tap。两种权限不能相互推断；缺失在写入前拒绝。
3. 全局 Xcode lease、最初未运行、自己的 launch callback、同实例/有效 PID/前台、唯一工程及已保留目录身份、无 sheet/dialog、唯一 input/output、输入焦点、空 `(lldb) ` 和末尾空选区、脚本指纹均须成立。此候选只豁免 AXConfirm 存在这一与自身策略无关的条件；不能豁免其他门禁。
4. 在输入前捕获响应增量边界；AXSelectedText 仅插入固定完整单行命令，随后核对全文/选区、目录/owner/focus、源码、取消和期限。对任何写入不确定性都终止，不清空、不重写、不补发 Return。
5. 只预构造无修饰键的 Return key-down/key-up，目标固定为同一个已核验实例的 PID；在第一次发送之前记录 attempted 并消费本次额度。发送 API 的 void 返回不能判成功；不使用全局 post(tap:)、任意键码或自动激活来纠正焦点。
6. key-down 前取消/漂移：不发送。key-down 已尝试后取消：停止新语义动作，仅当仍能验证原实例时最多一次 key-up 配对清理，且仍向原 PID；无法验证不得向可能复用的 PID 发送，报告清理未证实。不得用重试/第二个 key-down 处理不确定状态。测试须明确 key-up 是配对清理而非再次提交，记录两个 attempt 标记。不能声称发送与焦点变化/PID复用之间有系统级原子性；此残余风险是后续生产采用的阻断评估项。
7. 必须经既有有界接收器及 TypeScript 严格解析得到唯一同请求响应，才证明本次固定查询执行。响应仍为候选，不能自行将 targetVerified/physical ready 设 true；不同请求、回显、重复、超时、未知输出保持不可验证。
8. 后台 EOF/abort/期限传播和全部资源收口另有独立 owner 证明；未证实清理不能释放 lease/开始新会话。stdout 只含固定元数据，不包含原始控制台/键盘数据。

## 分阶段授权与接受条件

### 已批准第一阶段：代码与离线验证

允许新增固定 Return 策略/接口、无副作用测试适配器、公开原生适配器的编译检查及相关文档。代码中可以引用 CGEvent.postToPid 但本阶段不得实际调用，不能以“测试”名义向任何 App 发送键盘事件。现有0.1.3只读 App不升级、不重签，系统权限不改，不启动Xcode/宿主/App夹具/iPhone/Simulator，不提交推送。

明确修改清单及用例见 `../06-verification/physical-memgraph-native-return-plan-6.12.md`。通过此阶段仅说明代码与无副作用状态机成立；ADR状态只能推进为实验实现获准，不可标生产路线已接受。

### 后续阶段，尚未请求执行授权

先有独立可审阅候选及完整哈希，正常安装/权限配置与受控自有无设备App夹具验证；再提出一次Xcode宿主固定查询、最多一次写入与一对Return事件、严格响应/身份/收口的具体方案。夹具/Xcode必须由相应owner启动并绑定，不直接接管CUA启动会话来伪装生产owner。若初次受控App不能证明事件/焦点/取消和清理则停止，不进入Xcode。

物理目标绑定、memgraph捕获导出、leaks分析、取消、生产CLI/TUI/G5仍未完成，不能用单次Return成功关闭T6.12。用户若不接受新输入方式，维持unsupported，T6.12继续未完成，不转人工路径降低AC。

## 2026-09-17 内部查询协调与取消可见性

已按query-session-plan的确认范围实现不透明owner句柄、固定命令摘要/会话绑定的一次grant、实际Return exchange调度和TS候选解析。父管道/信号以后台锁保护latch立即变为可观察，main线程清理保持；无GUI自有子进程验证真实EOF/SIGTERM/SIGINT。既有App正常/固定取消点实证与本批合成/命令行证据分别记录，不互相替代。

此进展不代表生产IPC授权或完整capture资源清理已完成。query结果不可进入physical ready，lease不释放；AXConfirm无fallback，生产采用状态仍未接受。详情见 `../06-verification/physical-memgraph-query-session-plan-6.12.md`。
