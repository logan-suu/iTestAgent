# T6.12 / PR #81 审查修复验证

## 范围与基线

- 审查基线：PR #81，远端 HEAD `d00d9a2c92fd7374cea9bda94bb1bc22e48f17ea`，base `dev-1.0`。
- 用户批准修复已核验意见；本轮保留此前未提交的动作纠正、报告入口、Logo、设备选择、方向键与滚动区改动，不重置或覆盖。
- 本文记录本地修复和验证，不代表已提交、已推送或已解决远端评审线程。T6.12 保持 `in_progress`；T6.13 不提前开始。
- 不操作真实设备、Apple Team、签名、Keychain 或 provider API。测试中的密钥、OTP、邮箱均为虚构值。

## 已修复的 14 项已核验意见

| 问题 | 修复与证据 |
| --- | --- |
| 断言原文绕过 goal 脱敏 | `test-plan-compiler` 阻断命中确定性敏感规则或已脱敏占位符的目标，不回显原文、不生成虚假占位符断言；动作模型继续独立脱敏。编译测试覆盖虚构 Key、OTP、邮箱和占位符，已有 action-suggestion 测试覆盖首轮/纠正模型上下文 |
| 多 case 条件归到首 case | 存在显式条件且有多个 feature 时返回 `assertion_case_ambiguous`，要求按单个 feature 重新规划确认；不猜测自然语言归属，无显式条件的多 feature 探索仍可编译 |
| AUT 准备取消信号缺口（DEF-034） | 同一 signal 绑定 build、build-settings、产物校验的命令入口；每步前后检查，取消不转换成普通产物错误，不进入安装/WDA；命令 owner SIGTERM 后 1 秒升级 SIGKILL，等待退出并释放 timer/listener |
| 权限请求发送失败遗留 rejection | 取消 pending ask 后消费其 rejection，再传播原始事件发送异常；单测捕获原始异常且无 Bun unhandled rejection |
| 密钥方向键污染 | 键盘输入拒绝 ESC/CSI 控制序列，与 paste 路径区分；真实 PTY 粘贴虚构中文密钥后按六个导航键，最终提交值完全相同且始终不回显 |
| 空白 goal | runtime 和 published TestPlan schema 使用非空白模式；执行入口独立检查 trim 后非空，拒绝时不申请权限或创建 run |
| 矛盾权限结果 | 独立及联合事件 schema 均拒绝失败 reason 与 allow/ask 的组合，兼容无 reason 的旧事件 |
| S5 的 WDA 前置路径描述过宽 | 数据流文档限定 DeviceBackend/Appium 路径；XCUITest 不要求 WDA |
| ADR-037 无条件要求构建 | 明确用户指定 > 已有合法产物 > 缺少产物时构建，保持 AppSource 既有优先级 |
| Route C 缺失身份误称 mismatch | 身份未观测到时返回 `wda_status_failed` 和不可验证说明；已观测身份确实不同才是 `wda_identity_mismatch`；均失败关闭 |
| PTY helper 提前异常未清理 | 父进程读取、解析、交互均在 finally 资源边界内，回收本 scenario child、fd、事件文件；故障注入覆盖两个 scenario 入口且保留原异常 |
| 权限提示测试遗漏首字母 | 改为完整 `Permissionrequired` 匹配，真实 device-to-plan PTY 连续帧通过 |
| frame harness 异常未 destroy | flush、capture、输入及输出统一置于 try/finally，finally 销毁 renderer；原生字符帧回归通过 |
| 生命周期顺序断言缺少存在性 | build/preflight 后关键步骤先断言存在，再比较顺序，避免 `indexOf=-1` 假通过 |

## 未采纳或保留的意见

- CLI 探索入口的较早设备就绪检查属于已有路径问题，不作为本 PR 新增回归处理；本轮没有扩展 CLI 设备行为，不能据本报告声称 CLI readiness 缺口已经关闭。
- 不把 WDA 测试时限直接从 2 秒放宽至 15 秒；没有足够证据证明应放宽，也不弱化及时错误上报门禁。
- T6.12 是非代码真机出口验收任务，保留 `test_file: null`，在 notes 中引用实际回归与验证报告，不伪造唯一验收测试入口。
- Keychain 读/删通过 argv 调用，既有意见未证明命令注入；不强加只为 stdin 写命令设计的字符语法，不改变凭证行为。

## 自动化结果

- 修复初轮相关单测：149 pass / 0 fail / 400 assertions（后续追加了占位符和取消报告回归，以最终全量结果为准）。
- physical preflight 与 Appium backend：119 pass / 0 fail / 267 assertions，包含忽略 SIGTERM 的真实 Bun 子进程终止验证，不启动 Xcode 或设备。
- TestPlan published parity、报告状态与 PTY 故障清理：33 pass / 0 fail / 108 assertions；后续 production executor 回归 19 pass / 0 fail / 58 assertions，验证 AUT 准备取消最终落盘为 `cancelled` 且 backend 只关闭一次。
- 原生 OpenTUI 字符帧与 Phase 6 组合：29 pass / 0 fail / 470 assertions。
- 首次配置真实 PTY：6 项结果全部 true；候选/设备/计划/device-to-plan/聊天真实 PTY：5 个 scenario 全部通过，完整权限文案断言通过。
- G7：7 pass / 0 fail / 15 assertions。
- 初次全量：3902 pass / 29 existing skip / 1 fail；失败来自原设备类型切换夹具在单个登录目标下确认所有 feature，触发新多 case 归属门禁。将其改为仅确认 Login，保留全部双向目标切换检查，另加多 feature 拒绝后可重新确认单 feature 的回归（PlanningSession 22 pass / 0 fail / 75 assertions）。未放宽生产校验、超时或增加 skip。
- 最终全量：**3904 pass / 29 existing skip / 0 fail / 11242 assertions / 361 files / 84.28s**。
- 最终 `bun run typecheck`、`bun run lint`（872 files）、G7 与 `git diff --check` 通过。
- 本机日志：`/tmp/itestagent-pr81-remediation-full-final.log`、`/tmp/itestagent-pr81-typecheck-final.log`、`/tmp/itestagent-pr81-lint-final.log`、`/tmp/itestagent-pr81-g7.log`、`/tmp/itestagent-pr81-setup-pty.log`、`/tmp/itestagent-pr81-review-pty.log`。日志为临时本地检查记录，不替代本报告或 G5 证据。

## 未关闭的验收边界

### 2026-09-08 提交前复核

- 用户明确要求先提交推送到既有 PR #81；本次提交包括前述修复及此前批准的 T6.12 累积改动，不合并 PR。
- 重新执行全量 `bun test`：**3926 pass / 7 skip / 0 fail / 11293 assertions / 361 files / 92.78s**。本轮允许测试绑定本地端口，上轮因端口限制跳过的 22 项 Server 测试全部执行并通过；未修改 skip 条件。
- typecheck、lint、build、G7、schema/dependency 架构门禁（25 pass）、forbidden-literal scan、固定版本 gitleaks 二进制完整性与暂存密钥扫描均通过；未发现密钥泄漏。清理验证文档两处行尾空格，暂存 diff-check 通过。
- 本轮日志：`/tmp/itestagent-pr81-commit-tests.log`、`/tmp/itestagent-pr81-commit-typecheck.log`、`/tmp/itestagent-pr81-commit-lint.log`、`/tmp/itestagent-pr81-commit-build.log`、`/tmp/itestagent-pr81-commit-g7.log`。

### 仍需完成的验收

> 后续更新（2026-09-08）：以下为提交时的边界记录。DEF-034 已在独立授权后完成真实物理目标 build/settings/codesign 取消、进程树及 staging 清理验证并关闭，详见 [专项验证报告](g5-def034-physical-cancellation-6.12.md)。保留以下历史，不将此专项证据扩张为全部 T6.12/TUI/G5-SIM 重验。

- DEF-034 的代码与进程边界回归已补齐，但真实 iPhone 上构建/取消/子进程与暂存目录清理仍须单独授权后 G5 复验；保持 open，不把普通 Bun child 测试说成真实 xcodebuild 进程树验证。
- 受影响路径仍需按 T6.12 的双路径 G5 与共享路径 G5-SIM 责任补齐验收；本轮不声称这些门禁完成。
- 本轮未产生新的 CodeRabbit CLI 审查；前次登录失败 `Failed to start server. Is port 0 in use?` 不因本地测试通过而视为解决。
