# T6.12 真机闭环验收收尾记录

**归档日期：2026-09-08。任务状态：in_progress，UI 已通过，性能仍待补充；本报告不触发重复真机测试。**

## 1. 结论与确认来源

后续澄清优先：用户明确说明“UI跑通了，但是比如说检测内存增长和泄漏情况等等的性能指标的的还没有”。因此下文 G5 成功确认仅代表其实际测试的 UI 闭环，不代表完整性能验收；五份既有记录不能证明内存增长、泄漏或 baseline，所复核的最新 run `metrics` 为 `{}`。T6.12 不能据此直接标 done。已批准性能生产接线，实施边界见 [ADR-039](../decisions/ADR-039-performance-capture-lifecycle-and-evidence-status.md)。本轮新增自动化只验证软件链路与测试子进程，不是新的真机性能证据。

用户已明确说明“G5已经验收成功了”，随后再次确认“我前面已经用真实 iPhone 跑通流程了”，并授权收尾。该确认作为真实人工验收记录保留，不能因先前缺少汇总报告而将已通过的流程重新视为未测试。

本次仅整理现有运行与文档，未启动模型、构建、安装、WDA、设备操作或新测试运行。生产修复已随 PR #81 合并；DEF-034 的新增取消验证及关闭证据位于 PR #82。截至本次只读核查，PR #82 仍为 OPEN，目标为 dev-1.0，CI check 与 gitleaks 均 SUCCESS，尚无 merge commit。

## 2. 原验收范围与证据边界

开发计划原文：

> T6.12 G5 真机双路径验收：真实 iPhone 跑通两条执行路径并留档当前证据，人工确认后完成本任务，继续 T6.13

阶段出口原文：

> 出口标准：一句话 -> 计划确认 -> 真机执行 -> Flow/证据 -> 三件套报告 -> 解释 -> 真实重跑，全程使用生产组合并由当前 G5 证据证明

本报告将用户确认、可重查的当前 run、历史专项证据和自动化证据分别列出，不将它们混称为本轮重新执行的双路径 G5。用户确认的 DeviceBackend 真机流程已完成；现有默认 store 中可核对的本阶段成功 run 全部为 DeviceBackend，没有据此推断 XCUITest/Flow/failed-only rerun 也在同一会话完成。

## 3. 已完成真机流程：现有 bundle 只读复核

用户的原始目标是：启动后确认 `T6.12 Device Lane` 可见，点击 `Tap Me`，确认 `Taps: 1` 可见，并采集截图。前序对话包含真实设备安装/打开的用户观察、逐动作 allow，以及最终成功和报告目录的截图。

本次以生产 `createRunStore(...).loadRunBundle(runId)` 只读重新加载下列五份成功记录。数据库访问以抛错 guard 封锁，实际只读取本地 bundle 并校验；未打开或外传截图原文。生产 loader 校验 plan/steps/result/artifact-index 的 schema 和跨文件关联、summary 存在性，以及每个 artifact 的限定路径、大小与 SHA-256。

| Run ID | 路径/目标 | 状态与步骤 | 截图字节数 | Bundle 复核 |
| --- | --- | --- | --- | --- |
| run_01a07e28-6c19-7000-9f33-9ca564770626 | device_backend / physical | passed，3/3 | 100447、100453 | 通过 |
| run_01a07e35-6e04-7000-8bec-693aff01c7a0 | device_backend / physical | passed，3/3 | 100474、100362 | 通过 |
| run_01a07ec2-d360-7000-ae62-3163e3759f01 | device_backend / physical | passed，3/3 | 103105、103105 | 通过 |
| run_01a07ed0-2220-7000-a5c7-1260dbb2eab4 | device_backend / physical | passed，3/3 | 100461、100473 | 通过 |
| run_01a07ee4-39e8-7000-a55c-da1a96cdfbee | device_backend / physical | passed，3/3 | 100172、100241 | 通过 |

原始文件保留在本机默认 `~/.itestagent/runs/<runId>/`。每份均含两份 `raw-local-only` screenshot；不将原始截图、设备标识、Team 或凭证复制到仓库。本次是持久化结果/完整性复核，不重新解释截图，不将两份截图当成两个额外执行步骤。

## 4. 汇总矩阵

| 验收部分 | 依据 | 结论/限制 |
| --- | --- | --- |
| 生产 TUI 输入、计划确认、权限和 DeviceBackend 真机操作 | 用户已确认成功、前序截图、上表五份实际 run | 已完成，不要求重复执行 |
| 报告三件套、steps 和截图索引完整性 | 本次生产 loader 只读复核 | 五份全部通过，原始截图保留本地 |
| AUT build/settings/artifact-validation 取消、owner 进程与 staging 清理 | [DEF-034 专项报告](g5-def034-physical-cancellation-6.12.md) | 三轮真实物理目标验证通过，DEF-034 resolved；不替代 TUI/WDA lifecycle 验收 |
| XCUITest 真机及 Simulator 调度 | [T6.5](g5-sim-spike-report-6.5.md)、[T6.9](g5-sim-spike-report-6.9.md) | 历史专项证据；本次未找到可归属于 T6.12 当前 TUI 会话的 XCUITest run，不能冒称新双路径验收 |
| Flow 生产重放 | [T6.7](g5-sim-spike-report-6.7.md) | 历史双目标专项证据，不冒充当前用户会话的 Flow 重放 |
| explain、权威 XCUITest failed-only 与 parent/child lineage | [T6.9](g5-sim-spike-report-6.9.md)、[T6.11](phase6-production-closed-loop-report-6.11.md) | 历史真机/Simulator 与生产组合自动化分别覆盖；不将 DeviceBackend 再探索称为可复现 rerun |
| TUI/探索恢复/布局/权限等验收修复 | [修复报告](exploration-action-recovery-report-6.12.md)、[PR #81 审查修复](pr81-review-remediation-6.12.md) | 已有自动化/PTY 证据；不伪造新增设备验证 |

## 5. 提交检查与剩余收尾

- PR #82 提交前两轮全库测试均为 3926 pass / 7 skip / 0 fail / 11293 assertions，分别 92.35s 和 91.76s；类型检查、lint、构建、文档复现脚本 strict typecheck、G7、架构回归、暂存 gitleaks 和 changed/index 字面量扫描通过。此处复用明确注明来源的提交记录，不宣称本次文档整理重跑这些门禁。
- DEF-035 保持 open：无参数全库字面量扫描对 scenario 排除路径处理存在已确认误报。它不否定上表真实 App 执行结果，也不能被报告整理静默关闭。建议另行批准最小脚本修复及 generic/all/changed CLI 回归；按现有 Phase 6 出口流程在 T6.13 最终复核前完成处置。本次不修改门禁代码、不转移或缩减原验收要求。
- PR #82 须由人类合并；本次不自动合并，也不自动提交/推送新的文档整理。
- T6.12 是非代码验收任务，最终须由用户审阅本报告并明确批准交付后，才能通过 pr-merge-itest 更新 done。原范围中的当前双路径证据关联尚需确认：若用户已有相应 XCUITest/重跑记录，应补入其已有 run/报告来源，不要求重跑已通过的 DeviceBackend 流程，也不能用历史专项报告静默代替当前出口条件。
- T6.13 保持 pending，Phase 6 保持 in_progress。T6.12 完成后才级联 T6.13 为 ready；整个 Phase 6 还需签名向导及最终出口复核。
