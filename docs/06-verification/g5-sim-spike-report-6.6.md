# Task 6.6 G5 / G5-SIM 验证报告

**日期**：2026-09-01
**任务**：6.6 真机探索执行与 Flow 记录
**结论**：G5-SIM 与真机 G5 均通过；任务按代码类状态机保持 `in_progress`，等待提交 PR 与人类合并。

## 1. 验证范围

- 已确认 TestPlan feature 驱动的动态低风险探索，不再使用固定 `launch + screenshot` 动作。
- canonical RunStep 的 `sequence`、`targetKind`、`caseId`、`status`。
- case 动作 settle 后立即采集 UI tree checkpoint，并关联 `relatedStep` / `relatedCase`。
- 不支持或高风险的 Agent 动作显式 blocked。
- 只有用户确认且实际执行成功的录制步骤可以编译进 Flow。
- `save_flow`、`overwrite_flow`、项目目录写入分别确认。
- PR review 后新增 ADR-032：原始 screenshot/video/UI tree 仅作为本地 `raw-local-only` 证据；进入模型、报告嵌入或导出的派生内容必须先脱敏；敏感 UI 语义必须经 PermissionEngine 确认。

## 2. 静态与自动化验证

| 检查 | 结果 |
|---|---|
| `bun run typecheck` | PASS |
| `bun run lint` | PASS |
| `bun test` | PASS：3496 pass / 13 skip / 0 fail（328 files） |
| `bun run gate:g7` | PASS：7 pass / 0 fail |
| Phase 6 production contract — T6.6 owned assertions | PASS：TestPlan 已流入 run；CLI 不再包含固定探索动作 |

上述全仓门禁与下方 G5-SIM / G5 均在最终代码修正后重新执行；首次全仓测试暴露的 8 个旧 RunStep fixture 已同步到 canonical 契约，复跑为全绿。

## 3. G5-SIM

环境：

- Simulator：iPhone 16 Pro，iOS 18.2，UDID `F3BF1718-247D-4CB2-AAAF-F7738514B14D`
- App：Settings（`com.apple.Preferences`）
- Appium 3.6.0 / XCUITest Driver 11.17.7
- 验证脚本：`docs/06-verification/g5-sim-verify-6.6.ts`

执行结果：PASS。

- 建立真实 Appium/CoreSimulator session。
- `RunStep.sequence` 为 `[1, 2, 3]`（run-level launch + 两个 case action）。
- 两个 case action 均为 `completed`。
- 生成两个独立 UI tree checkpoint。
- 每个 checkpoint 均带对应 `relatedCase` 和 `relatedStep`。
- session 在验证后正常关闭。

PR review 后的首次复验按新的失败关闭规则正确停止在 launch 阶段，并暴露 WebdriverIO `mobile:*` command 参数包装错误；修复为驱动所需的对象参数后重新执行通过。验证脚本现在同时断言两个 case step 均为 `completed`，避免只凭 caseId 数量误判。

## 4. G5 真机

环境探测：

- iPhone 14 Plus，iOS 18.2.1，paired/available。
- Developer Mode 已启用，DDI services available，CoreDevice tunnel connected。
- 已安装的 WDA bundle：`com.logansu.WebDriverAgentRunner.xctrunner`。

初始验证结果为 BLOCKED：已有 WDA provisioning profile 已过期，`test-without-building` 在安装阶段以 `MIInstallerErrorDomain Code 13` 失败。用户随后明确确认 `prepare_wda`，允许刷新签名、重新构建并覆盖同一 WDA Runner。

确认后的执行结果：PASS。

1. 从有效 Apple Development 证书主体解析实际 Team ID，沿用现有 `com.logansu.WebDriverAgentRunner` 基础 bundle ID；没有创建新的设备 App。
2. 生产 `WdaManager` 使用 `-allowProvisioningUpdates` 完成 build-for-testing、重签与覆盖安装，设备 inventory 确认 `com.logansu.WebDriverAgentRunner.xctrunner` 已安装。
3. 真机执行发现 Xcode 26 的 `devicectl device info apps` 不再接受旧 `--json` 输出方式；生产实现改用临时文件 `--json-output`，并保持失败关闭和 best-effort 清理。
4. 本机已有一个 Simulator WDA 占用 8100/9100，未终止或接管该进程；本轮使用独立的 Mac 侧 8200/9200，8200 通过 `iproxy` 映射到设备 8100。真机执行同时发现 physical capability 构造遗漏 `mjpegServerPort`，实现已统一透传并增加回归测试。
5. 最终复验中 WDA `/status` 主动 readiness 在 6,080 ms 后返回 ready；随后 Appium 3.6.0 external-url session 创建成功；验证脚本还实际读取了 MJPEG multipart stream 并确认收到图像字节。
6. `RunStep.sequence` 为 `[1, 2, 3]`；两个 case action 均为 `completed`，每步包含 screenshot 与即时 UI-tree checkpoint 引用。
7. 两个 screenshot 各 306,472 bytes；两个独立 UI tree checkpoint 各 45,456 bytes，并分别携带对应的 `relatedStep` / `relatedCase`。
8. 验证脚本退出码为 0；teardown 后 8200/9200 无监听，本轮 physical WDA xcodebuild 与 iproxy 无残留。既有 Simulator WDA 未被修改。

复验同时覆盖了 launch 失败必须停止后续探索、launch failure 继承 caseId、录制 secret 仅以运行时引用持久化、模型 UI 投影脱敏、敏感 UI 动作确认，以及 `local_connected` 多设备歧义失败关闭。

验证脚本：`docs/06-verification/g5-physical-verify-6.6.ts`。脚本通过环境变量接收设备、签名与 WDA 工程信息，不把本机标识硬编码进仓库。

UI-tree checkpoint 文件与运行时 step/case 关联已在本轮验证。最终 `steps.json`、三件套 artifact-index 合并和 RunStore 持久化仍由 T6.8 负责；本报告不把该后续任务职责冒充为 T6.6 已完成。

## 5. 结论

- DEF-030 的逻辑缺陷已由 changed-scope integration、真实 G5-SIM 和真实 iPhone G5 共同验证修复：case checkpoint 不再在整轮结束后统一读取最终页面。
- Simulator 能力满足 G5-SIM。
- 真机能力满足 G5；WDA 过期 profile 已按确认刷新，Xcode 26 inventory 与 physical MJPEG 端口接线缺陷已修复。
- 规格评审确认“禁止任何原始 UI tree 本地落盘”会破坏本地可审计性，因此以 ADR-032 收敛为双边界：本地原始证据允许保留并标记，模型/导出边界必须脱敏；敏感输入不进入 RunStep、Flow、错误或日志。
- Task 6.6 为代码类任务，仍保持 `in_progress`；只有 PR 被人类合并后才能通过 `$pr-merge-itest` 标记 `done`。
