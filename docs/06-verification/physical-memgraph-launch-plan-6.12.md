# T6.12 App 启动与权限归属修复计划

## A4 已实现并完成宿主验证（2026-09-09）

用户确认后已实现公开 NSWorkspace launcher、私有请求目录/绑定结果文件、TypeScript App transport 和 schemaVersion=2 暂存 candidate 构建。父 stdin 生命周期管道、SIGTERM/超时清理仅针对本次返回的 App 实例；取消早于回调仍等待晚回调收口。无退出证明则保留 lease 并阻断，不把文件存在或启动成功当就绪。旧固定安装与原授权未改变。

实测发现 Foundation 会将 /private/tmp 标准化为 /tmp，改用实际 realpath 校验；短 App 在回调前退出时 PID 可能失效，改为显式 terminatedAtCallback，不复用失效 PID。App 生命周期登记补齐后，6 项真实无权限宿主测试通过：正常退出、结果写入后取消、超时、已有实例冲突、父管道 EOF/晚回调、结果不可覆盖/不跟随链接。测试退出检查无本次 fixture 残留。

最终 typecheck、lint（920 文件）通过；性能包启用宿主用例 226 tests/1365 assertions 全过。暂存新版 0.2.0 已构建、签名及清单校验；helper SHA256=d751dcce8c54883df364c9dac016fcf791738017a10f8be8c3743e1c2b7b7e1d，launcher SHA256=a858a79951da0e5751c1d603613ec0fddc642859f4ebe5fd4c24afd6b04c4d19。原固定 helper 哈希未变。

下一步待审阅 physical-memgraph-helper-upgrade-plan-6.12.md：一次固定升级、保留旧版备份、必要时对确切新版重新启用 AX、只读复检。未执行升级/新授权，没有 Xcode 或设备动作、生产捕获 G5、commit/push。新代码 resolver 不兼容旧源码清单时会明确阻断，不自动替换旧安装。

状态：A4 已获确认并实现，宿主测试通过；固定包升级仍待单独确认。2026-09-09。

## 最小诊断结果

同一固定 helper、同一哈希、同一辅助功能开关：直接 spawn 二进制此前返回 accessibility_unavailable；本次通过公开 open -n -g -W -a 固定 app bundle，stdout/stderr 指向唯一临时目录，仅传既有 Xcode 参数，返回 eligible/xcode_not_running、targetVerified=false、Xcode 26.5。launch exit 0、stderr 空、helperRemaining=0、二进制未变。没有重签、重装、改权限、启动 Xcode 或操作设备。

这支持启动方式影响权限归属，排除了“开关开启即可证明直接子进程已获授权”的假设；未读取系统 TCC 内部状态，因此不声称已经证明系统内部归属链。权限传播时间仍可能是影响因素，不需要为此反复操作开关。产品应验证 App 启动路径，并保留直接启动的历史失败。

## 为何不只将 spawn 改为 open -W

open 返回的进程不是 helper 自身，取消 open 不等于 helper 退出；不能破坏 ADR-023/036 的 owner 与取消要求。本机公开 AppKit SDK 的 NSWorkspace.openApplication 返回 NSRunningApplication，包含 processIdentifier、isTerminated 和 terminate/forceTerminate；它可作为记录自己新实例的候选，不可按名称批量杀进程。此 API 没有本计划已验证的 stdout 重定向接口，因此还需显式结果通道，不能凭空假定同 open 参数兼容。

## 建议下一单元 A4（待确认）

仅实现启动适配与可验证生命周期，不加入 Xcode 控件点击/调试/设备捕获。

- 新增 native/itestagent-memory-launcher.swift：公开 NSWorkspace 创建精确 app URL 的新实例，关闭前台激活和最近项目写入；检查现有实例冲突；记录本次返回的实例身份。取消和超时只终止本次实例并等待实际退出；取消先于异步启动回调时，仍须在回调收到后清理，不能提前宣称收口。启动回调超时/归属未知则明确未收口，不按名称接管。launcher 自身不请求 AX。
- helper 保留只读功能，新增严格的 request ID 与结果文件模式（原 stdout 模式兼容）：结果只包含既有白名单，唯一文件仅可写入调用者预留的私有请求目录，不覆盖、不跟随链接。记录完成协议与请求绑定；目标原始标识仍不传给 helper。
- TypeScript 新增 App 启动 transport：预留本地请求目录、校验固定 bundle、完整协议、超时和 abort；拒绝陈旧/多条/缺失/超大/错 request 输出。不得以 launcher exit 0、应用启动回调或结果文件存在替代有效 preflight 和 owner 退出。SIGTERM/父进程断连须触发 launcher 自有实例清理；无法保证的 SIGKILL/系统崩溃明确为恢复检查场景。
- installer 在暂存中构建待审新版 app 与 launcher，保持现有已授权固定包不变。本单元先测试暂存包与专用本地无 AX fixture 的生命周期；不自动安装覆盖 A2 产物，也不改变其哈希或系统授权。
- 新增协议/正常退出/启动失败/实例冲突/取消早于回调/超时/假结果/退出前不得成功测试；公开 App 启动的真实宿主测试只操作专用无权限 fixture，不打开 Xcode、不操作设备。

修改范围：performance-xctrace-analyzer 的 native helper/launcher、src/xcode-memory-helper-install.ts、src/xcode-memory-preflight.ts、新 transport 与相关 test；同步 ADR-044、安装计划及证据记录。实现需先确认公开接口可传递所需参数/结果路径，不能引入私有 API。

通过 typecheck、lint、包级宿主回归及新 launcher 生命周期实证后，提供新版签名/哈希、升级与回退方案，届时再单独请求替换固定版本及可能重新授予权限。当前原包已授予的 AX 访问不自动等于新包升级授权。

## 范围

A4 不代表自动捕获 B，更不是正常 TUI G5。既有工具阳性/释放不重跑。无需再次启用相同 helper 的系统开关。当前授权仅用于已经完成的最小只读诊断，A4 代码与专用无设备宿主 fixture 测试等待实现计划确认。
