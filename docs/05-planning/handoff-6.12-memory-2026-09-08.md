# T6.12 内存性能能力交接 — 2026-09-08

## 接续增量（2026-09-08，优先于下方历史快照）

- 后续baseline接受计划已获确认并实现（ADR-041、性能报告§26），本次提交前锚点3a01a7e，用户已要求提交推送到现有PR #82；最终SHA由git log -1及交接回复确认。`/baseline accept <run-id>`展示兼容的physical内存新旧值，PermissionEngine逐次确认、报告重读及baseline CAS保护后替换实际指标；startTui退出dispose待处理会话。完整门禁4029 pass / 7 existing skip / 0 fail，12452 assertions（含生产长key临时文件名回归）；真实PTY允许/拒绝/退出使用临时fixture通过；本次提交前重新typecheck/lint通过，全库4029 pass / 7 existing skip / 0 fail，12452 assertions、371文件、98.60s（§28）。
- 用户针对具体替换另行授权后，正常生产CLI/OpenTUI真实接受已通过（§27）：来源已更新为run_01a08345-914d-7000-bae0-bb3394627f9e，峰值48.359901→47.813026MiB、增长38.359398→37.796898MiB。只有1个baseline改变，两次历史run的10份报告哈希未变；创建时间与去重来源历史保留，完整性通过、无锁/临时文件残留。CLI/driver正常exit0且socket移除，未执行新设备工作负载/采集。该次update_baseline授权已消费，不应重复发送accept/allow；零扫描、多轮及其他路线剩余责任不变。

- 本次提交前锚点`7ca4945`；用户已要求将本次接续的代码/文档提交推送到现有PR #82，最终提交SHA通过`git log -1`核对。T6.12仍in_progress，T6.13仍pending。
- 已检查历史公开CLI导出与Instruments AX界面，尚无有效零扫描完成证据；Codex Computer Use访问可用，无需再次索要同一辅助功能授权。detected-only不变，空详情不能判not_detected。证据见性能验证报告§21–22。
- 用户确认的等待职责修复已完成：将确认的性能观察配置和实际capture启动结果传至动作模型，保留原始目标和业务等待。DEF-035扫描路径修复已验证并resolved，保留审计。typecheck/lint/G2通过；全库4006 pass / 7 existing skip / 0 fail。见§23。
- 用户单独授权后的短工作负载真实TUI G5已通过：`run_01a08345-914d-7000-bae0-bb3394627f9e`。仅launch/tap一次/wait20s，无额外70/10s UI wait；49样本跨82.169s、录制100.003s、coverage complete，三项内存指标collected，17个观测泄漏分配/4.25MiB；canonical完整性通过、baseline文件名/哈希不变。详见§24，不把此单次结果泛化为全部T6.12通过。
- 新PTY socket和driver会话已结束，不复用旧授权。driver/CLI/Appium已退出、4723关闭、xctrace为0；测试App退出需本轮显式fixture进程收尾，已核验为0，不声称产品自动终止AUT。新raw证据只在`~/.itestagent/runs/memory-waits-tui-1788908546/artifacts/`，只能输出确定性脱敏投影。
- 后续优先明确有效零扫描可验证通道、已确认资产的多轮语义，以及Simulator/XCUITest和剩余性能出口；TUI接受baseline已在§26–27实现并完成真实替换验收。下方§6第3项与DEF-035已经完成本次增量，勿重复实现或重跑旧阳性验收。新的真机录制和高风险动作需要新的具体授权。

## 1. 接续目标与状态

本文件是本轮提交的交接快照，不替代规格、ADR和task-status。新session先核对Git及最新文档，保留用户后续修改。

- 仓库：iTestAgent；当前分支 `docs/def034-physical-cancellation-evidence`。
- 现有PR：[PR #82](https://github.com/logan-suu/iTestAgent/pull/82)，base `dev-1.0`；交接前核实为OPEN、非draft。不要新建重复PR，不自动合并。
- 上一提交锚点：`cdd3f92262b8b0849c7532f6cdde8fface713f7b`（自动内存增长与阳性泄漏诊断）。本次提交增量是无引号断言、采样余量、baseline策略隔离及§15–19实证；最终提交SHA由交接回复给出，可用 `git log -1` 再核对。
- T6.12 `in_progress`；T6.11已done；T6.13仍pending，不抢先启动。DEF-034已有真机取消清理证据并resolved；DEF-035仍open。
- 用户的目标是让通用itestagent具备**全自动**测试App内存增长和泄漏等性能指标的能力，不是证明某个App没有泄漏，也不接受每轮手动使用Instruments/Xcode导出文件的半自动方案。

## 2. 新session必读与约束

先读 `AGENTS.md`、`docs/INDEX.md`、`docs/05-planning/task-status.json` 和 `deferred-items.json`，使用 `retry-task-itest` 从已验证点继续。相关文档：

1. `docs/01-spec/全量用户故事与验收标准规格书.md`：US-11.1、US-12.1/12.2/12.3。
2. `docs/decisions/ADR-039-performance-capture-lifecycle-and-evidence-status.md`。
3. `docs/decisions/ADR-040-memory-growth-and-leak-diagnostics.md`；先读顶部最新实证，正文包含保留的历史调查结论。
4. `docs/06-verification/performance-capture-wiring-6.12.md`：§10泄漏证据通道、§13正常TUI阳性、§15断言、§16覆盖失败、§17修复、§18首次baseline、§19第二次比较。
5. `docs/decisions/ADR-032-local-raw-evidence-and-semantic-ui-risk.md`、ADR-036和ADR-037；后续涉及backend/采集时再按INDEX读技术选型§11、避坑§6与对应架构/数据流。

原文约束：

> AC3 后续 run 与 baseline 对比输出变化趋势

> AC4 泄漏结论必须来自真实诊断证据，区分检测到、本次检测未发现与无法检测；内存增长不能直接判为泄漏，未发现不承诺不存在所有泄漏。

> AC7 真机与 Simulator 能力分别实测，不能以独立后端 probe 或 fixture 单测替代生产链路验收。

> High-risk allow decisions cannot persist across sessions, and persistent deny rules must be revocable.

本轮及此前各轮构建/替换安装/准备WDA的授权**均已消耗**。本文件不是新授权；开始新一轮前需明确目标App和逐动作授权。不能自动重签WDA、卸载其他App、修改Keychain、覆盖baseline或重复有副作用的工作负载。新实现先Explore/Plan，再等用户确认；不要把“交接继续”解释为批准尚未提出的实现方案。

## 3. 已完成的产品链路

- 正常生产CLI/TUI→候选确认→设备选择→计划审核→PermissionEngine→物理DeviceBackend→性能采集→canonical三件套已经真实跑通，无模型/设备/采集替身。
- 显式请求 `memory_peak`、`memory_growth`、`memory_leaks`，计划显示观察/settling参数、成功条件、采样余量；执行期间有持续activity和倒计时。
- 中文/英文边界清楚的无引号可见性条件可编译为用户断言，带引号条件保持；按顺序合并去重，敏感目标和多case歧义仍阻断。否定/复合/条件语句不猜测。没有确定性条件不冒称passed或建立成功baseline，TUI给出缺失提示。
- 公开Activity Monitor采样提供带时间戳footprint，报告真实首尾、峰值、增长、样本数、覆盖；MiB明确，不能用录制墙钟替代有效样本跨度。
- 公开Leaks详情逐分配解析已接入阳性检测；仅聚合count/bytes进入结果。空node、未知格式、未证实扫描仍not_exportable，**没有实现有效not_detected语义**。
- `MEMORY_CAPTURE_POLICY` 为 `memory-observation-v2`，同一trace预留30秒有界采样余量：`max(readyAt + minimumDurationMs + 30000, actionsFinishedAt + settleDurationMs)`。不重复动作、不开第二条trace；长动作不额外重复加余量；工具600秒上限保持。
- 导出后严格覆盖门禁不放宽，不足仍inconclusive、不建baseline。新旧策略baseline隔离；首个合格run自动建立，后续只比较、不覆盖。

主要实现入口：

- `packages/itestagent-engine/src/test-plan-compiler.ts`
- `packages/itestagent-tui/src/plan-review.ts`
- `packages/itestagent-contracts/src/memory-analysis.ts`
- `packages/itestagent-backends/performance-xctrace-analyzer/src/production-capture.ts`
- 同目录 `activity-monitor-memory.ts`、`memory-growth.ts`、`leaks-detail.ts`、`capture-process.ts`
- `packages/itestagent-engine/src/baseline/production-memory-baseline.ts`
- `packages/itestagent-engine/src/confirmed-run-bundle.ts`、`production-run-executor.ts`

## 4. 最新真机证据（不要重复验证已通过点）

报告根是本机 `~/.itestagent/runs/<runId>/`，不是仓库目录。使用生产 `createDefaultRunStore().loadRunBundle()` 校验schema、引用与artifact完整性，读取聚合字段；不要把原始trace/XML/UI tree/截图导入模型上下文。

| 项目 | 首次baseline | 第二次比较 |
| --- | --- | --- |
| runId | `run_01a082ed-5ee5-7000-be47-00b41954a634` | `run_01a082fd-4353-7000-be2a-84cb022096a7` |
| case/run | passed / passed | passed / passed |
| 三项内存指标 | 全部collected | 全部collected |
| 样本数/有效跨度 | 89 / 227793.130ms | 96 / 226309.330ms |
| 录制时长 | 229791.503ms | 231016.274ms |
| 峰值MiB | 48.359901428222656 | 48.35992431640625 |
| 增长MiB | 38.359397888183594 | 38.921897888183594 |
| Leaks | 19条 / 4980736 bytes | 20条 / 5242880 bytes |

第二轮产品生成baselineDelta：growth **+0.5625MiB**、peak **+0.00002288818359375MiB**。逐项重算与报告相符；两轮execution、observation、appSource、projectProfileRef相同。首轮baseline文件数始终1、updatedFromRun不变，SHA256始终 `a0238dbcf9a92402dd3f42bea8f733b1559def771d75903da4b9763121ae0cfe`。可从第二轮result.baselineDelta.baselineId定位 `~/.itestagent/baselines/physical/<baselineId>.json`，不要重写它。

两个run均只tap一次，但模型另生成约20/70/10秒三次wait；因此约230秒长录制证明链路成功，**不构成30秒余量在短动作边界的独立因果验证**。当前regressed只是数值增加标签，峰值差约24 bytes，不代表统计显著退化。5MiB泄漏与38.92MiB总footprint变化不是同一指标。

历史失败 `run_01a082cc-99a3-7000-a96c-76d566174635`：功能passed，但约70秒录制仅59.85秒有效样本，正确inconclusive、不建baseline。不要改写历史结果。

## 5. 本机环境和复测入口（可能过期，先核查）

- 版本控制中独立样例：`fixtures/ios-memory-control/`，bundle `com.itestagent.spike.MemoryProbe`，不能覆盖device-lane或其他App。
- 本机临时项目：`/private/tmp/itestagent-memory-tui.s5FS7h`；可能被系统清理。包含个人签名配置，**不可整目录提交或输出**。失效时从fixture按批准范围重新准备，不从文档猜Team ID。
- 可见标题 `iTest Memory Probe`；按钮 `Run Leak Workload` / `Run Released Workload`，完成状态 `Workload complete`。四批0/5/10/15秒工作负载；每进程仅一次。工作负载receipt只证明App动作，不证明Leaks扫描成功。
- 已有API key在本地Keychain。不要打印或要求用户贴密钥，不重新初始化或删除已存凭证。当前真机/WDA/签名可用性必须重新只读核查，旧成功不保证下次仍可用。
- 从测试项目目录运行 `bun <repo>/packages/itestagent-cli/src/cli.ts`。不要从测试项目执行不存在的 `bun run itestagent` 或仓库相对源码路径。
- 本地 `baseline-drive.py` 只是正常TUI的PTY输入适配器和专用Appium owner，不是产品性能替身。最新socket `baseline-compare.sock` 是已结束会话的残留，不要向它复用旧授权；如需新driver先读代码并使用新的socket/唯一证据目录。
- 本轮TUI、专用Appium、xcodebuild/iproxy/xctrace及MemoryProbe应用进程已退出；应用安装、baseline和报告保留。新session不要按旧PID杀进程或广泛pkill。
- raw日志仅在 `~/.itestagent/runs/memory-baseline-tui-1788902920/artifacts/` 和 `memory-baseline-tui-1788903946/artifacts/`。仅提取白名单状态/计数/聚合，不能cat原始日志。更早probe的历史原始XML边界偏差见验证报告§10，不能宣称整个历史G7无例外。

两轮精确原prompt（用于理解已验证配置；不是自动复测指令）：

```text
用这台真机测试 MemoryProbe：启动后确认 iTest Memory Probe 可见，点击“Run Leak Workload”一次，等待20秒，确认 Workload complete 可见，并采集截图。采集内存峰值、内存增长和泄漏，观察70秒，操作后等待10秒。
```

## 6. 推荐下一步（尚待提出具体计划并批准）

1. **先补有效零扫描语义**：读已落盘释放对照的脱敏结构、公开工具状态与生产parser，列出至少3个按证据排序的假设。明确如何区分“有效扫描未发现”与“未扫描/导出失败/不支持/空node”。只有证据足够才设计not_detected接线，先提文件/契约/回归计划给用户确认；需要新真机录制时另外逐动作授权。不得把空XML/exit0直接填0或判健康。
2. **可复现多轮能力**：用已确认Flow/测试资产与轮次定义工作负载、间隔、每轮采样/增长证据及取消。不能暗中重复探索tap。两次独立baseline比较不等于已经实现多轮自动测试。
3. **观察时长职责与短窗口验证**：评估模型把性能70/10秒重复生成动作wait的问题；保持用户20秒业务等待。涉及目标提示/动作约束修改需先批准。设计不会靠长模型等待掩盖采样缺口的真实验证，但不注入假的采集/设备结果。
4. **Simulator/XCUITest和其他性能范围**：新增采集当前仅physical DeviceBackend路线；按US-12.1/12.3及ADR-039逐项列缺口，不能拿真机替代G5-SIM，不能把本轮说成hitches/hangs/launch/crash等全指标已通过。
5. **TUI接受新baseline及阶段收尾**：显式一次性高风险确认；竞争/环境指纹等已知边界见ADR-040。处理DEF-035并完成当前PR审查及任务出口，才考虑T6.12关闭与T6.13签名向导。

DEF-035：全库literal CLI把绝对路径传给相对scenario排除规则，误报feed-memory；changed/index范围不受影响。修复需独立批准的共享门禁代码/测试计划，不能绕过扫描或声称全库CLI已绿。现有记录保持open，不重复登记。

## 7. 检查、提交与接续提示

本次提交前检查结果见性能验证报告§20及Git目录中的T6_12 gate receipt；原始自动测试日志在 `/private/tmp/itestagent-handoff-*.log`。不要用更早3990或3966的数量覆盖本轮记录，也不要把新增22项沙箱skip隐去。

新session可从以下请求开始：

> 读取本handoff、AGENTS、INDEX、task-status和ADR-040，继续Task 6.12全自动内存/泄漏能力。先核对当前分支和PR，基于现有证据提出“有效零扫描/未发现泄漏”的最小实现与验收计划；不要重复已通过的阳性baseline验收，不把空导出当零，不沿用旧真机授权，等我确认计划及本轮高风险动作后再执行。
