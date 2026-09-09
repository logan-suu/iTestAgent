# T6.12 真机 memgraph 生产接线计划

## 最新：B 已确认，协议单元完成（2026-09-09）

已实现内部会话/身份门禁、全局 lease 与导出文件校验，尚未接原生 UI。9 项新测试及宿主性能包 235 项回归通过；真实 Xcode 调试会话身份提供方仍缺失。LLDB GetUniqueID 仅为公开接口候选，未执行设备查询或放宽 PID 复用门禁。详见 `docs/06-verification/physical-memgraph-capture-plan-6.12.md`。固定 helper 与权限不变，T6.12 保持 in_progress。

## 最新恢复点：B 计划待审阅（2026-09-09）

A4 固定新版已完成升级和重新授信，独立 App transport 返回 eligible/xcode_not_running、targetVerified=false、cleanupVerified=true。下面 A1 的权限阻塞为历史记录。下一步具体实现范围见 [B 自动捕获计划](physical-memgraph-capture-plan-6.12.md)，尚未进入 B 编码或新设备操作。

## 独立 memgraph 预检第一单元实施（2026-09-09）

用户已确认第一单元。已新增 Swift 公开 AX 只读 helper、TypeScript 有界协议、编译说明和 8 项测试；不启动 Xcode、不请求授权、不读取窗口内容、不操作设备。宿主 eligible 仅表示前置候选，targetVerified 始终 false；任何现有 Xcode 实例一律阻断，不接管。

公开 SDK 核对与 swiftc 编译通过。独立宿主运行识别 Xcode 26.5，返回 blocked/accessibility_unavailable；错误 bundle 返回 xcode_invalid。没有借助 CUA。获授权后的 AX/实例查询分支尚未实测，不宣称捕获可用。临时二进制不作为要求用户授信的固定身份，后续先拟定稳定 helper 安装/签名与权限引导，再批准 B 的实际 UI 操作计划。

新增 8 tests/35 assertions 通过，含真实自有子进程取消/超时及退出等待；全库 typecheck、lint（915 文件）通过；全包正常宿主 207 tests/1281 assertions 通过。沙箱内 206 pass/1 fail 为已有 notifyutil 通知用例，同代码宿主重跑通过。没有生产默认来源变更、新设备 G5、commit/push。

状态：第一单元已确认并实现；后续 B–E 仍需具体计划与确认。依据：ADR-044 提案及已完成的真机阳性/释放工具对照。T6.11 done、T6.12 in_progress、T6.13 pending；当前 deferred-items 无 open 项。既有门禁结果不代表本方案已实现或验收。

## 已确认的第一单元

同意 ADR-044 的验证方向后，先实现**独立公开 Accessibility 适配器的只读预检与协议**，不立即改生产默认来源。使用系统 Swift 编译必要原生 helper，无第三方依赖；本单元不启动/重装/调试设备 App，不重跑两组对照、不更改系统授权或用户项目。

拟增量文件（实现时根据现有包布局保持职责）：

- `packages/itestagent-backends/performance-xctrace-analyzer/src/xcode-memory-preflight.ts`：TypeScript 子进程适配、显式目标输入、有界等待、abort、固定错误码；没有权限时返回状态，不自动弹请求。
- 同包 `native/itestagent-xcode-memory-helper.swift`：版本、AX 可用性与会话冲突的确定性查询；仅返回白名单结构。原始数据不进 stdout，不获取设备图像/内存内容。初期不包含点击、Run、导出动作。
- 同包 `test/xcode-memory-preflight.test.ts`：拒绝错误/多条/截断协议、超时、取消、子进程提前退出、身份/能力缺失；不把进程启动等同 ready。
- 同步 ADR-044、技术选型、验证报告与任务 notes；新接口仅 backend 内部，先不修改 result schema 或 TUI 默认行为。

检验：typecheck、lint、定向负例/生命周期测试；真实宿主只读预检须不依赖 Codex 会话。未获 helper 的 AX 访问不采用绕过方式；记录准确前置，系统权限需要用户单独授权。先核对已选 Xcode 的公开 SDK 可支持所需查询；不可行时停在证据，不输出假 ready。

## 后续单元与明确门禁

| 单元 | 主要文件/职责 | 完成依据 |
| --- | --- | --- |
| B 自动化 capture 生命周期 | helper、backend `xcode-memory-session.ts`，公开控件定位、独占 lease、prepare/capture/export/close；engine 只调接口 | 单独批准带 UI 动作的计划后实施；真实适配器具备超时/取消/用户会话冲突收口，不能复用旧动作授权 |
| C 来源与产物契约 | contracts `memory-analysis.ts`、`performance-capture.ts`、`run-result-contracts.ts`、JSON Schema 跨字段校验与导出、backend parser | 独立 `xcode-memgraph-leaks`、capture/analysis 区间、原始证据引用；0/0/正数/损坏/过期/多摘要/错目标/取消负例 |
| D 正常编排与展示 | engine `production-run-executor.ts`、TUI `agent-session.ts` 与计划审阅、权限入口、report、baseline 门禁 | 调试准备在动作前、同 PID、请求来源显式、泄漏快照初期 baseline=skip、失败阻止动作或保留已执行事实 |
| E 真机 G5 | `tests/integration/phase6/` 新集成用例与验证记录 | 正常生产 TUI 阳性/释放各一次，以及捕获/导出取消验证；全部使用新具体动作授权；报告 schema 与 owner/baseline 核验 |

B 前须把 helper 命令、权限和退出状态做成具体计划；C/D 前须依据 B 实测明确启动/身份绑定接口，不能靠 fixture 特例固定 scheme 或路径。每个单元可独立 Check；并非一次批准后隐式实施所有后续设备动作。

## 尚未被证据解决的问题

- Codex CUA 与可发布 Swift AX helper 不是同一运行时；后者的控件可见性、环境权限和恢复能力未知。
- 已验证是动作前 Xcode 启动；未证明可以附加任意既有进程。installed-only、非调试构建需明确能力限制。
- Xcode 调试与连续 xctrace 采样共存尚未验证；首个产品快照单元不改旧增长路径，联合指标不得显示全项支持。
- UI 会话在用户介入、窗口丢失或取消后能否可靠收口仍需实测；不能默认强退 Xcode。
- 多轮、XCUITest、其它性能指标与全部 T6.12 出口继续独立追踪。

本计划不要求用户逐次手动导出，亦不把两组已完成工具证据升级为生产 G5。当前具体待批范围只有第一单元的实现和只读宿主检查。
