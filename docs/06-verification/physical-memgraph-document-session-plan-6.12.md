# T6.12 文档会话连续性与关闭观察计划

日期：2026-09-17。状态：用户确认的整批离线实现与验证通过。沿用ADR-044/046/047；本批不增加Apple Events执行通道，不扩大lease释放规则。

## 证据与边界

原约束：“closed必须来自对应owner的观测，关联本次实例/资源身份”；“任何pending/unknown阻止释放全局lease。”当前MemoryLocalDocumentBinding保留目录描述符和inode，但locateMemoryAXConsole在每次调用内创建新binding；独立定位测试通过不等于完整session持续绑定同一目录/窗口。

本机公开SDK `AXNotificationConstants.h` 对AXUIElementDestroyed的说明仅保证该UIElement在目标应用中不再有效，仍能用CFEqual比较本地引用；不能继续对其调用AX API。该通知不是NSDocument销毁证明。窗口消失、AX读取失败、窗口列表为空和目录仍存在均不能单独证明document closed。

只读检查`/Applications/Xcode.app/Contents/Resources/Xcode.sdef`发现公开document/file/modified、window.document和workspace document接口；其中open文档明确说明有时无法返回打开对象，建议从documents查找。字典没有为workspace document给出可直接采用的永久实例标识。该信息只证明接口定义存在，不证明本机授权、稳定引用或关闭行为。未执行脚本、Apple Events或Xcode；其cocoa实现名不作为可调用私有API。

## 已确定的实现选择

保留原目录binding、原窗口AX引用及所属Xcode启动句柄，观察结果固定区分：observed_open、window_unavailable、owner_exited、unknown。**window_unavailable不等于document closed。** 若原Xcode实例确证退出，只能报告“所属进程结束，文档会话随之不可存续”；不据此倒推debugger/AUT已退出，也不授权主动退出Xcode。该来源不解决safeToTerminate的全部前置条件，不新增自动关窗或退出动作。

先实现这一可验证的连续性来源，防止后续provider把被替换目录/新窗口当原会话；若之后需要在Xcode存活时证明NSDocument独立关闭，必须另行验证公开文档对象接口及授权边界，不能把AX窗口消失升级为证明。

## 请求确认的整批实现

1. 新增`native/itestagent-memory-document-session.swift`：绑定在会话开始时创建并持续保留的MemoryLocalDocumentBinding；接收由原owner提供的句柄及唯一已核验窗口，禁止按PID重新发现、按路径重新获取owner或自动重绑新窗口。每次读取前后复核所属实例、原目录身份、完整有界窗口集合、原窗口及document URL。取消、期限、owner冲突、目录替换、模态或不完整枚举返回unknown并禁止后续恢复为已核验。
2. 明确窗口消失与AX销毁事件的处理：只比较已失效引用，不再查询其属性；返回window_unavailable，不能生成cleanup proof。窗口重新出现即使URL相同也不继承原会话。原启动对象isTerminated才允许owner_exited观察；真实回调/对象身份为来源，外部JSON/布尔值不是释放锁授权。
3. 新增公开AX/AppKit只读适配器和可注入无GUI环境；适配器只编译。保持旧定位模块、旧签名候选和v4固定源码清单不变，不接入生产resource provider或增加协议scope。
4. 新增Swift fixture及Bun测试：相同URL/不同inode、原目录被移走后替换、同一路径的新窗口、窗口消失/销毁、读取错误、不完整枚举、重复/迟到事件、原owner退出与替代owner、取消/超时。测试中的owner_exited只是假环境证据，不声称真实Xcode验证通过。
5. 运行Swift warnings-as-errors、定向测试、性能包默认回归、typecheck/lint/diff，更新矩阵与交接。所有真实App/LLDB opt-in保持关闭，不重用此前额度。

## 授权范围与交付限制

确认后连续完成上述离线代码与测试，不逐文件询问。本批不运行Xcode/iPhone/Simulator/真实App/LLDB，不发AX写入、Return或Apple Events，不修改权限、签名或安装，不commit/push。新增模块不进入已签名v4候选清单；未来接入时再审阅新候选。

完成后仍需document真实来源验证、Xcode provider完整接线与独立关闭前置、所选设备/构建/进程身份交叉核验、capture/export及生产TUI G5。此计划只补连续性及准确关闭观察边界；T6.12保持in_progress，不将window_unavailable或宿主退出当作完整capture清理通过。

## 实现记录

MemoryDocumentSession在初始化时保留原目录描述符/inode、原owner句柄和唯一窗口；读取前后核验原实例/目录/期限/取消，首尾复查窗口集合。不存在窗口时锁定window_unavailable，不因同URL新窗口恢复observed_open；owner替换、目录替换、读错或期限/取消后锁定unknown。原实例确证退出才可报告owner_exited，且不能回退live。

PublicMemoryDocumentEnvironment复用公开AX读取，完整窗口/子树有界（最多512节点、16层），检查workspace window、模态状态、sheet/dialog和文档URL；缺失/不完整数据失败关闭。MemoryDocumentDestructionWatch注册原窗口销毁通知，仅比较本地引用，通知后失效标记阻止后续AX属性读取；主线程移除run-loop source后释放观察器，不对已销毁窗口调用移除通知或属性查询。此适配器仅编译，未向真实Xcode注册观察器。

无GUI fixture覆盖21种会话情形，包括目录移动/替换、不同窗口同路径、窗口消失/重复销毁/外来和迟到事件、owner替代/退出/unknown、读取期间取消/销毁/窗口变化及初始上下文失败。fixture中的owner状态为假环境，不能作为真实Xcode证据；文件目录替换为临时目录中的实际操作。首次编译发现AX通知常量需显式CFString转换，修正后warnings-as-errors和定向运行通过。

旧源码及签名v4候选未改变，固定27项清单与源码profile只读复核通过。新增模块没有加入candidate sources或生产provider，也没有cleanupVerified、lease proof或关闭动作接口。没有运行真实App/LLDB/Xcode/设备，没有权限/签名/安装变更或commit/push。

最终性能包默认回归325 pass / 9 opt-in skip / 0 fail（2381 assertions、53文件），包含21种新文档会话情形及既有v3/v4/owner/LLDB离线回归。Swift warnings-as-errors、typecheck、lint（966文件）、git diff --check通过。未跑全仓库测试或真实G5。日志：`/private/tmp/itestagent-document-session-package.log`、`/private/tmp/itestagent-document-session-tests.log`、`/private/tmp/itestagent-document-session-typecheck.log`、`/private/tmp/itestagent-document-session-lint.log`。

公开AX适配器继承既有reader的active-app检查，后台或未知上下文会失败关闭；本批未证明真实Xcode销毁通知必然送达或在owner存活时可独立证明NSDocument关闭。下一步需在完整provider设计中明确这些真实来源与退出前置，不得把仅编译的适配器当实测完成。T6.12仍in_progress。
