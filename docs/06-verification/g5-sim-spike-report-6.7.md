# Task 6.7 G5 / G5-SIM 验证报告

**日期**：2026-09-02

**任务**：6.7 Flow 双目标生产重放
**当前结论**：G5-SIM 与真机 G5 均通过；任务按代码类状态机保持 `in_progress`，等待提交 PR 与人类合并。

## 1. 验证范围

- `itestagent run flow <flowId>` 默认进入生产重放，`--validate-only` 不启动 backend 或设备 session。
- Flow 查找采用项目优先、全局 fallback，并输出实际来源。
- `targetKind + deviceId` 显式输入；不从 Flow 数组顺序推断。
- confirmed/draft/deprecated 状态门禁。
- BackendSelector 根据 canonical `requiredCapabilities`、targetKind 与实时 healthcheck 选择生产 backend，禁止 mock/dry-run fallback。
- replay step 保留稳定 `stepId`、递增 `sequence`、`targetKind` 与可选 `caseId`。
- evidence 使用 `success | not_requested | not_applicable | unsupported | failed` 五态；仅真实非空文件生成 ArtifactRef，原始 screenshot/UI tree 为 `raw-local-only`。
- 重放不改写原 Flow；T6.8 仍负责 RunStore、`steps.json` 与报告三件套持久化。

## 2. 静态与自动化验证

| 检查 | 结果 |
|---|---|
| `bun run typecheck` | PASS |
| `bun run lint` | PASS |
| `bun run build` | PASS |
| `git diff --check` | PASS |
| `bun test` | PASS：3535 pass / 13 skip / 0 fail（330 files） |
| `bun run gate:g7` | PASS：7 pass / 0 fail |
| T6.7 changed-scope suite | PASS：原实现 278 pass / 0 fail；PR review 修复后相关回归 153 pass / 0 fail |
| Linux CI portability regression | PASS：Appium backend 100 pass / 4 platform skip / 0 fail；物理发现使用 injectable seam，生产默认仍为 devicectl |

全仓测试在完整本机权限下执行；沙箱内首次运行的 Keychain/CoreDevice/doctor 超时不作为代码失败，完整权限复跑为全绿。

## 3. G5-SIM

环境：

- Simulator：iPhone 16 Pro，iOS 18.2，UDID `F3BF1718-247D-4CB2-AAAF-F7738514B14D`
- App：Settings（`com.apple.Preferences`）
- Appium：本机 `127.0.0.1:4723`
- Flow：临时 project-local confirmed Flow `t6-7-settings-smoke`

生产 CLI 先以 `--validate-only` 验证，明确输出 `Location: project`，且未启动设备 session。随后使用同一命令的默认生产重放路径执行。

执行结果：PASS。

- Appium/CoreSimulator session 创建成功。
- 显式 simulator target 与 device ID 生效。
- 两个 Flow step 全部通过：`launchApp`、`screenshot`。
- replay summary：2 passed / 0 failed / 0 skipped / 0 blocked。
- PR review 后复验的真实截图文件为 215,678 bytes。
- 真实 UI tree 文件为 38,780 bytes。
- replay run/evidence 目录权限为 `0700`，截图、UI tree 与 manifest 文件权限为 `0600`；ArtifactRef 仅接受当前 run 内的非空普通文件。
- 结果携带 step/case/target 关联；session 在命令结束后由同 owner 清理。
- 临时 Flow 未被回写，`lastValidatedTargets` 保持不变。

## 4. G5 真机

环境探测：

- iPhone 14 Plus，iOS 18.2.1，paired/available。
- Developer Mode 已启用。
- 已安装 `com.logansu.WebDriverAgentRunner.xctrunner`。
- Appium 3.6.0 / XCUITest Driver 11.17.7。

首次生产 CLI 验证发现 Xcode 26 输出兼容缺陷：已配对设备可能以 `transportType=localNetwork`、`pairingState=paired`、`tunnelState=disconnected` 出现，旧过滤器仅接受 wired 或 active tunnel，错误返回“devicectl unavailable”。实现已调整为将 paired 作为 discovery 证据，同时继续由后续 active WDA probe 决定可执行 readiness；CoreDevice 冷启动的有界超时也由 3 秒调整为 15 秒。新增单测覆盖该 Xcode 26 结构，全仓测试复跑通过。

修复后生产链路进入真实 Appium session 创建，但设备当时仅通过 local network 暴露，首次结果正确 BLOCKED：

- Appium 报告 `Unknown device or simulator UDID`。
- Appium 日志明确指出 RemoteXPC tunnel registry `127.0.0.1:42314` 不可达，fallback 的 usbmux 设备列表为空。
- 使用 pymobiledevice3 启动的 macOS native tunnel 本身成功，但它不提供 Appium XCUITest Driver 所需的 42314 registry，不能证明 Appium production route ready。
- Appium 自带 tunnel-creation 脚本依赖 USB/usbmux；设备当时只以 local network 暴露，无法建立该路线。
- 临时 pymobiledevice3 tunnel 已终止，无遗留 tunnel 进程。

用户随后将 iPhone 通过 USB 连接并保持解锁/信任。复验确认 `transportType=wired`、`pairingState=paired`、`tunnelState=connected`、`ddiServicesAvailable=true`，且 usbmux 能识别目标 UDID。第二次生产执行发现默认 8100 被既有 Simulator WDA 占用；实现因此补充 `--wda-local-port` 与 `--mjpeg-server-port`，校验端口范围并透传到 production composition。复验使用独立 8200/9200，没有终止或接管既有 Simulator 进程。设备最初仍返回 XCTest Code 41（未授权 UI testing）；用户开启 Enable UI Automation 并重启设备后，旧 WDA 自然退出，未进行跨 owner 强杀，最终主动 readiness 与 session 创建成功。

最终执行结果：PASS。

- Appium 在目标 iPhone 上建立真实 managed-xcodebuild WDA session，active readiness 通过。
- 显式 physical target 与 UDID 生效；未发生跨 target fallback。
- 两个 Flow step 全部通过：`launchApp`、`screenshot`。
- replay summary：2 passed / 0 failed / 0 skipped / 0 blocked；PR review 后最终复验执行阶段 2,709 ms。
- 两个真实 screenshot 分别为 306,300 bytes 与 310,227 bytes。
- 真实 UI tree 为 45,455 bytes，并处于 `raw-local-only` 边界。
- replay run/evidence 目录权限为 `0700`，截图、UI tree 与 manifest 文件权限为 `0600`；文件均位于本次 run 目录内，非符号链接、目录或空文件。
- Appium session 删除成功，8200/9200 forwarding/listener 已释放。
- Appium 按默认 `useNewWDA=false` 保留其自己管理的 xcodebuild/WDA cache；iTestAgent 未跨 owner 强杀该进程。DEF-029/DEF-033 的全链路子进程收口仍归 T6.10，本报告不将其冒充为 T6.7 已解决。
- 临时 Flow 未被回写；复验证据保留在本机临时 run 目录用于本次审查核验，不进入模型、报告嵌入或外部传输。

## 5. PR review 规格复审与处置

PR #76 的自动审查意见没有直接按现有文档机械实施，而是先复审规格并同步修订 ADR-033、规格、架构、数据流和避坑手册。确认后的边界如下：

- paired discovery、轻量 selector healthcheck 与被选 backend 的 active WDA/session readiness 是三个阶段；discovery 不把暂时 disconnected tunnel 误判为设备不存在，但执行前必须主动 fail-closed。
- 原始 screenshot/video/UI tree 继续遵循 ADR-032，以 `raw-local-only` 形式保存在本地 run artifacts；不因步骤含 secret 引用而静默抑制原始证据，模型上下文、报告嵌入与外传仍必须使用脱敏派生内容。
- 空 `typeText` 是无效果输入，显式 blocked；清空字段应由未来独立语义动作表达，不能把空字符串隐式解释为 clear。
- cleanup 失败返回结构化 infrastructure failure，同时保留已经发生的 replay steps、evidence 与原始失败事实。
- evidence 强制 per-run 隔离、路径 containment、普通非空文件、无 symlink，并采用目录 `0700` / 文件 `0600` 权限。
- 首次远端复验暴露一个既有单元测试直接调用宿主 `devicectl`，Linux runner 在 5 秒测试截止前未返回；现已为 Appium backend 增加可注入的物理发现 seam，使单测使用确定性 fake，生产默认路径不变。随后新 review thread 又确认另一个生产入口可能使用共享临时 artifacts 目录，现已把未显式配置目录的 fallback 改为每 backend 实例独立目录；显式 per-run 目录仍优先。完整权限全仓复跑为 3535 pass / 13 skip / 0 fail。

11 条 inline review thread 已逐条验证：9 条实现缺陷完成修复，2 条与确认后的 ADR-032 / readiness 分层冲突的建议以文档和真机证据说明后拒绝；CodeRabbit review body 的 6 条建议也逐条覆盖或说明。

## 6. 当前结论

- G1-G7 与 G5-SIM 均通过；真机和 Simulator 都走相同 production CLI / replay engine，没有 mock/dry-run 降级。
- G5 过程中发现并修复 Xcode 26 paired-device discovery、CoreDevice 冷启动超时和独立 WDA/MJPEG 端口透传三个真实问题。
- T6.7 的实现与验证已完成。任务作为代码类任务保持 `in_progress`；只有 PR 被人类合并后才能通过 `$pr-merge-itest` 标记 `done`。
