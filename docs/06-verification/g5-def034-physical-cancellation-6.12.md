# DEF-034：真实物理目标 AUT 准备取消与 owner 清理验证

## 结论与范围

**日期：2026-09-08。结论：DEF-034 的剩余物理目标验证通过，可关闭该延期项。**

基线为已合入 PR #81 的 `4e611465df65c50c1dc5115fb4aafa1911116857`。本轮没有修改生产代码；验证该提交已有的 run signal 绑定、生产命令终止、canonical cancelled 报告与 staging owner 清理。

用户先确认此前 G5 验收成功，再明确批准本轮验证计划及真实构建（包括生产参数 `-allowProvisioningUpdates`）。此前整体 G5 成功是用户确认，本报告仅提供 DEF-034 的新增证据，不将其扩张为重新执行全部 T6.12/TUI/双路线验收，也不单凭此报告将 T6.12 标记 done。

## 验收约束原文

US-17.2 AC5：

> 用户取消必须同时取消 pending ask 与运行中 tool，并把同一 AbortSignal 贯穿 AgentRuntime、ToolDispatcher、所选执行路径、backend/parser 与其拥有的子进程

US-17.2 AC6：

> abort 幂等；每个 owner 必须在宽限期内回收其子进程，超时升级终止；session 结束后无 pending tool 或 orphan child，已生成证据仍可索引；用户 abort 后 run 主状态最终标记 cancelled，清理不完整通过独立 cleanupOutcome 结构记录且不得覆盖 cancelled 与既有执行事实；非 abort 路径的清理不完整才将 run 标记 infra_failed

ADR-023：

> Each backend or pre-selection discovery provider owns the child processes it spawns; there is no cross-owner process handoff.

本轮验证上述协议中 DEF-034 新增的 AUT build/build-settings/artifact-validation 到 owner subprocess、报告与 staging 清理这一段；上游 TUI、权限及 WDA lifecycle 不被本夹具替代验收。

## 环境与方法

- Xcode 26.5 / build 17F42；Bun 1.3.14；iPhone 14 Plus（iPhone14,8），iOS 18.2.1。生产 discovery 确认恰好一个 `physical / ready` 目标，并将实际 UDID 绑定到构建 destination；本文和派生审计不公开设备、Team、账号或签名标识。
- 使用原 T6.12 `device-lane` 的 SpikeApp fixture，bundle 为 `com.itestagent.spike.SpikeApp`；沿用其现有签名配置，不改 Team，不重签/覆盖安装 WDA，不安装、启动或卸载设备 App。
- 使用 TUI 共享的 `executeProductionTestPlan`、production dual dispatcher、`createProductionPhysicalPreflight`、`buildForPhysical`、`normalizePhysicalAppArtifact`、`runProductionPhysicalCommand`、真实 Appium backend 的未启动实例及 close、真实 RunStore/schema/canonical report persistence。没有替换 build/settings/plutil/lipo/codesign 的执行结果。
- 每轮创建独立临时 store/run/staging，实际构建产物位于本轮 staging/DerivedData。验证入口直接注入取消 signal，不经过 TUI，也不调用模型或读取 API key。
- 安全限定：生产执行器提前询问 `replace_device_app`，本夹具使用仅测试范围的 confirmation adapter，同时在 `createDevicectlOps` 入口设置会抛错的安全封锁；设备写入不可到达。该 adapter **不是**产品权限通过的证据。三轮封锁命中数均为 0；若命中则失败，不安装以完成测试。
- 本地观察器只包装并转发原 `Bun.spawn`，记录真实命令 PID，不替代生产 signal/kill/await。约每 100 ms 读取 PID/PPID/start-time/state，递归记录 root 的后代，结合启动前 baseline 防止跨 owner/PID 重用误认。取消时要求观察到目标进程为非 zombie；构建轮额外观察到活跃 compiler 后代。
- 生产清理返回后继续观察 3 秒，再于 **13:59:25 UTC** 延迟复查，核对已观察的全部 owned PID/start-time 与 staging。没有使用人工 rescue kill。只声称本次采样观察到的进程树无残留，不声称证明所有 Xcode 版本、所有可能的系统共享 daemon 行为。

## 真实执行结果

| 取消阶段 | 取消时事实 | 已跟踪进程数 | 取消至生产返回 | 结果 |
| --- | --- | ---: | ---: | --- |
| AUT build | xcodebuild 为 S；SWBBuildService 为 S；swift-driver 为 R、clang 为 U | 4 | 180 ms | cancelled；无残留；staging 已清理 |
| build-settings | 真实 build exit 0 后，`xcodebuild -showBuildSettings` 为 R | 56 | 143 ms | cancelled；无残留；staging 已清理 |
| artifact validation | build/settings/plutil/lipo 均 exit 0；`codesign --verify` 为 R 时取消 | 60 | 169 ms | cancelled；无残留；staging 已清理 |

每轮均满足：

1. 所有被调用的生产准备命令收到同一个 run signal；取消后没有下一阶段安装、launch、WDA 或模型调用。
2. dispatcher status、返回的 canonical runStatus、重新加载的 result.status 均为 `cancelled`；没有 SUCCESS/passed/普通产品失败的替代分类。
3. `store.loadRunBundle` 成功，验证 plan、steps、result、artifact-index 及跨文件约束；summary.md、result.json、artifact-index.json 和 steps.json 均保留。
4. 取消前确实已存在 staging/DerivedData 内容；生产 finally 清理 staging，3 秒及延迟复查均未重新出现。旁边的保护文件保持原值，project.pbxproj 和 SpikeApp.swift 的 SHA-256 前后相同。
5. backend close 恰好调用一次，人工 rescue 0 次，最终已跟踪 owned PID/start-time 匹配数为 0。三轮没有活跃 device session，因而不虚构 WDA tunnel/session teardown 证据。

这些取消都发生在 AUT 准备阶段，尚未采集 UI 截图或 RunStep，故真实 bundle 的 artifact 数为 0，cleanupOutcome 为 null（未发现清理失败）。编译缓存属于临时 staging，不是伪造的用户测试证据；没有声称本轮保存过设备截图。此前步骤/证据在后续取消时仍可保留的边界，由下述跨包回归另行覆盖。

## 证据与复现

- 脱敏派生审计：[physical-cancellation-results.json](evidence/def034/physical-cancellation-results.json)，包含命令顺序/退出码、signal identity、取消时进程状态、owned process identity、schema 结果及目录检查。
- 复现夹具：[physical-cancellation.ts](evidence/def034/physical-cancellation.ts)。归档版只将已执行的本地脚本的仓库绝对 import 改为相对 import、workspace 改为必填参数，并增加 `--approved` 保护；不是新的生产实现。
- 每次复验须重新确认准确 fixture/设备和真实构建授权。命令形式：`bun docs/06-verification/evidence/def034/physical-cancellation.ts <build|settings|validation> <approved-device-lane-directory> --approved`。固定 SpikeApp fixture 语义，不应直接用于任意用户项目；它会执行真实构建、在临时 store 落盘报告，并由生产 owner 删除本轮 staging。
- 本次实际执行脚本：`/private/tmp/itestagent-def034-verify.ts`，SHA-256 `b1e0f2b14dcaf99d336b78f478241bb162d6fb1426bbdb4648cc36dd38e556e3`。
- 三轮本地 store：`/private/tmp/itestagent-def034-7fg83q`、`/private/tmp/itestagent-def034-hqIutq`、`/private/tmp/itestagent-def034-T8TAwn`；对应 run ID、原始 verification.json SHA-256 见派生审计。完整本地 run bundle 保留，不复制可能包含运行时目标标识的 plan/result 到仓库。
- 前两次观察器初测分别返回 cancelled，但未明确记录 process state；不计入上表正式验收。随后修正观察器对带空格 executable 路径的显示解析并补充非 zombie 判据，重跑正式三轮；生产代码未变化。

## 回归与判定边界

- 本轮定向回归：`production-physical-preflight.test.ts`、`committed-run-status.test.ts`、`phase6-exploration-suggestion-recovery.test.ts`：**31 pass / 0 fail / 201 assertions / 5.38s**。包含真实 Bun 子进程忽略 SIGTERM 后升级终止、各准备阶段同 signal、取消报告、以及之前已产生步骤/证据的保留。
- `bun run typecheck`、`bun run lint`（872 files）和 `git diff --check` 通过。仓库默认 typecheck/lint 不覆盖 docs 中的复现脚本，故另以 `tsc --noEmit --strict --skipLibCheck --module esnext --moduleResolution bundler --target esnext --jsx preserve --allowImportingTsExtensions` 显式检查该脚本，通过。本轮没有重跑完整 `bun test`，不复用历史全量数字作为本次结果。
- 本次实际 Xcode/codesign 正常响应终止，未制造其忽略 SIGTERM；升级 SIGKILL 的分支由上述真实 Bun child 回归验证，不冒充该分支的真机观察。
- G7 脱敏契约回归：7 pass / 0 fail / 15 assertions。追踪 JSON、三轮证据和延迟复查一致性校验通过；本次文档变更未提交或推送。
- 无生产行为或配置 schema 变更，因此不新增 ADR；DEF-034 保留历史 detail/notes，追加证据后改为 resolved。T6.12 仍 in_progress，待单独完成确认；不提前推进 T6.13 或 Phase 7。
- 本轮没有 Simulator 执行、TUI 取消交互、权限系统验收、App 安装、WDA 重签或 GitHub 评论/线程变更；不得据此宣称这些范围重新通过。

## 提交前补充检查（2026-09-08）

用户随后授权提交推送。新一轮 `bun run typecheck`、`bun run lint`、`bun run build` 通过；完整 `bun test` 为 **3926 pass / 7 skip / 0 fail / 11293 assertions / 92.35s**。独立复现脚本 strict typecheck 通过；G7 为 7 pass，架构/依赖/字面量测试为 19 pass。没有重新执行真机操作。

额外执行无参数 `gate:g2` 时发现已存在的全库扫描误报：generic 模式将绝对路径交给只识别仓库相对路径的 scenario 排除函数，错误报告四个场景文件的 `feed-memory` 字面量。扫描脚本与 `origin/dev-1.0` 字节相同，本提交不修改生产或门禁代码；该独立问题记为 DEF-035，后续修复需增加 CLI 全库模式回归。本次提交范围使用脚本提供的 `--base origin/dev-1.0 --index --scope changed` 模式核验，不声称全库 CLI 扫描通过。
