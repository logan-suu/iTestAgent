# T6.12 B：独立 Xcode 自动捕获实现计划

## B 首个可验证单元（2026-09-09）

用户已确认 B 计划。已实现 backend 内部 `xcode-memory-session.ts`：严格版本/会话/序号/阶段协议、确认目标匹配、进程世代一致性门禁、取消后仅收口、全局 helpers-root lease、清理未确认保留锁及防误删 owner。新增 `xcode-memory-export.ts`：仅接受已确认 exported 阶段，校验独占私有目录、文件路径/链接/属主、捕获时间、文件稳定性和摘要，输出不包含原始字节；协议取消及 AbortSignal 均拒绝导出结果。

这些接口尚未连接原生 helper，不代表实际会话或捕获已实现。真实 metadata 身份入口固定 unknown，不生成伪世代。现有固定 helper、AX 权限、Xcode 和设备均未修改；没有 commit/push。

验证：新增 9 tests/46 assertions 通过；性能包正常宿主回归 235 pass/0 fail/1410 assertions（随后增加协议取消导出断言，定向回归通过）；typecheck 与 lint 924 文件通过。沙箱中的已有 notifyutil 用例失败，未修改该用例，宿主含六项无设备原生 fixture 的回归通过。

### 尚待解决的身份提供方

本机 `devicectl device info processes --help` 及既有工具证据没有已验证的进程启动/世代字段。宿主独立 LLDB 文档查询确认 `SBProcess.GetUniqueID()` 存在；[LLDB 官方说明](https://lldb.llvm.org/cpp_reference/classlldb_1_1SBProcess.html)描述它区分调试器中的进程实例。这是候选，不能从另一个 LLDB 实例查询 PID 后冒充 Xcode 所属实例，也不能将调试器对象 ID 当系统启动时间。

接下来必须验证通过独立 helper 的公开 Xcode 调试控制台读取固定、只读 LLDB 查询，并绑定本次 Xcode owner、目标设备/构建、所选 process 与连续会话；不可接受任意脚本输入或修改用户 lldbinit/scheme。尚未实现或执行该路径，也未宣称它可行。若公开访问无法提供充分证明，按 ADR-044 保持 target_identity_unverifiable；不能为继续捕获而降成仅 PID 比对。

剩余 B：真实身份提供方、公开 AX 动作适配、prepare/capture/export/close 的原生 transport 和取消收口；随后才是候选构建审阅、固定升级、具体真实动作验证及 C/D/E 接线。此处记录实际完成的第一单元，不把缺失实现改记为测试限制或完成。


状态：已确认；首个协议/产物校验单元完成，原生捕获未完成。2026-09-09。关联 ADR-044、US-12.3。

## 恢复点与验收约束

A4 固定 0.2.0 helper 已升级、保留旧版本备份并重新添加辅助功能权限。独立 App transport 复检为 eligible/xcode_not_running、targetVerified=false、Xcode 26.5、cleanupVerified=true。已通过性能包 226 tests/1365 assertions、typecheck 和 lint；这些结果仅覆盖既有实现。B 尚未实现。

AC6 原文：“复用公开工具，不逆向 trace；原始 trace/XML 不进入模型上下文。取消贯穿录制、等待、导出及所属进程清理。”

ADR-044 原文：“无法独立排除 PID 重用/目标漂移则不发布诊断，不能只看标题或摘要 PID。”

既有工具对照的进程记录仅含 executable、processIdentifier，没有启动标识。同路径、同 PID、请求 UUID 或连续轮询均不能单独证明进程世代。本计划不放宽该门禁；公开工具无法提供充分证据时返回 target_identity_unverifiable，生产接线继续保持未完成。

## 拟实现文件及职责

路径均相对 `packages/itestagent-backends/performance-xctrace-analyzer/`。

| 文件 | 变更 |
| --- | --- |
| `src/xcode-memory-session.ts`（新增） | 内部 prepare/capture/close 会话接口；全局 Xcode lease、严格序号协议、期限和 AbortSignal；注入目标身份读取接口，不互调 DeviceBackend |
| `native/itestagent-xcode-memory-helper.swift` 及按职责拆分的新 Swift 文件 | 保留只读 preflight；增加明确 session 模式、公开 AX 查询和有界动作、独立会话状态机、导出审计；只返回白名单阶段和错误码 |
| `native/itestagent-memory-launcher.swift`、`src/xcode-memory-app-launch.ts` | 扩展 session 生命周期，先请求 helper 收口 Xcode，再验证 helper 退出；不能沿用只适合预检的超时后直接终止策略来宣称资源已清理 |
| `src/xcode-memory-helper-install.ts`、`native/README.md` | 将新增源码纳入构建与完整性清单；仅构建临时候选，不自动覆盖已授信固定版本 |
| `test/xcode-memory-session.test.ts`、原生 fixture 测试 | 协议、动作前置、身份缺失、用户干预、导出路径、取消和 owner 退出负例；真实无设备 fixture 检验原生生命周期 |

接口输入绑定已确认的 project/workspace、scheme/configuration、物理设备 ID、bundle、构建引用与独占 artifacts 目录。单次动作许可绑定会话和操作，不接收任意命令、任意 AX 路径或永久 allow。此单元保持 backend 内部接口，C/D 再接 contracts、PermissionEngine 和正常 TUI。

## 会话与动作规则

1. `preflight → preparing → prepared → capturing → exported → closing → closed`；失败和取消进入 closing，不能回到 prepared 重试已执行动作。prepared 只在独立目标绑定通过后发出，不从 helper 启动成功推导。
2. lease 位于 helper 安装版本之外的同一本地 helpers 根，覆盖本机 Xcode UI，而非单个设备/候选安装目录。未知或清理未确认的 lease 阻断，不按时间自动接管。
3. 初始存在任何 Xcode 实例则阻断。公开 NSWorkspace 启动只归属本会话的新实例；验证无恢复的用户窗口后才打开明确项目。控件使用当前 AX 元素、角色和标识定位，歧义/窗口漂移/用户介入均停止；不猜坐标、不保存节点序号。
4. 调试启动必须在业务动作前；首个候选仅允许已确认且存在的调试构建走 Run Without Building。若需要构建、重新部署或改配置而缺少对应单次许可，停止并返回明确前置。禁止启动失败后自动 Run 或更改 scheme/签名；动作后不能重启 App 补捕获。
5. 公开来源的身份读取作为显式 proof/unknown 结果，验证设备、构建、bundle、PID 及进程连续性证据。实现阶段先核对现有公开工具/SDK能否取得所需证明；fixture 只能覆盖协议，不能使真实目标默认 verified。无法证明时禁止业务放行或诊断发布，并记录阻断点。
6. capture 仅对准备好的同一调试会话执行 Memory Graph 和 Export。每阶段有截止时间，取消后不再派发新动作。导出到本轮新建目录内的新文件；存在、链接、路径逃逸、错目标、过期、不稳定或未完成文件均拒绝。保留捕获时间、大小、摘要和导出动作审计，原始内容仅 raw-local-only。
7. TypeScript 失联通过 launcher/helper 生命周期通道触发收口；helper 先处理所属调试会话和文档。出现未知窗口/保存对话框/所有权不明时不强退共享 Xcode，不按进程名杀 AUT。超时或强制终止不能算 cleanupVerified；保留冲突 lease 和本地证据，禁止自动新开会话。

## 检验与交付门禁

- 先实现一个可测试单元再推进下一单元：协议/全局 lease → 原生动作适配和状态机 → 导出与清理。
- 覆盖重复/乱序/越权命令、旧请求结果、结果已写但尚未退出、身份缺失/PID复用、窗口冲突、迟到启动、父进程失联、各阶段取消/超时、导出覆盖/链接及取消后无继续动作。
- 运行新增定向测试、性能包回归、typecheck、lint、diff 检查。无设备原生 fixture 可执行；不申请额外 AX 权限或操作真实 Xcode/设备。
- 同步 ADR-044、生产计划、交接和任务 notes，保持 T6.12 in_progress。身份来源和真实 AX 控件兼容性如未解决，逐项记录，不能宣称 capture ready。

确认本计划授权 B 代码实现、文档同步、临时构建及无设备验证。实现完成后提供具体候选版本和测试结果，再审阅固定升级与真实设备动作。原有阳性/释放对照授权已经执行，不重复使用；本计划不包含 commit/push。C/D 接线与 E 生产 G5 继续独立追踪。

## 提交前 PTY 回归修复（2026-09-09）

全库检查发现 Simulator 原生内存 PTY 的 Test Plan 标题等待依赖完整文本，而 OpenTUI 增量绘制复用上页标题单元，实际已进入计划页仍超时。测试改为等待新呈现的 baseline=skip 编辑提示；不更改产品代码、不放宽 canonical 结果、许可次数与清理断言。该修复随本次提交，最终门禁结果记录于任务 notes。

完整复跑时既有组合 PTY/CLI/字符帧测试触发外层 15 秒或默认 5 秒时限，未发现残留 fixture。五个渲染进程串行的组合测试总预算调整为 60 秒，内部交互/退出 deadline 和结果断言保持；最终全库使用 `bun test --timeout 30000`，提高默认测试执行预算而不改变产品超时。首次标题检查失败、随后宿主超时与最终结果分别保留，不把失败运行标为通过。

最终提交门禁：`bun test --timeout 30000` 4127 pass / 13 skip / 0 fail，12958 assertions，384 文件，104.02 秒；typecheck、lint（924 文件）、generic/all/changed-index 禁用字面量与 staged gitleaks 均通过。13 skip 为 7 项既有 skip 与 6 项 opt-in 原生 helper 用例；后者已有独立宿主通过记录，不宣称本次全库执行了跳过项。
