# T6.12 性能采集与内存产品能力增量验证

**日期**：2026-09-08。**状态**：正常生产 TUI 真机链路已自动采集单区间内存增长及阳性泄漏诊断并发布 canonical 报告；完整性能 G5、G5-SIM、有效零泄漏语义、多轮增长和 baseline 验收仍未完成，T6.12 保持 in_progress。§1–12 保留阶段性历史，最新事实与剩余项见 §13。

**后续纠正**：用户已拒绝 §7.3 中待确认的人工导出方案，要求全自动。对导出通道的补充检查见 §8；原先仅检查 data/table schema 而排除导出入口的结论不完整。

## 1. 已批准范围与原始问题

用户确认修复性能生产接线，但明确此前真机仅跑通 UI。检查发现生产 DeviceBackend 执行没有使用 PerformanceBackend，已复核 run 的 `metrics` 为空；空 XML 还会被旧解析器解释为无 crash、零 hang。本轮不重复 UI 验收、不操作真机、不构建/安装/签名、不提交或推送。

规格约束：US-12.1 “memory peak 标注为近似值”；R5 “不静默降级/臆造指标”。设计决策与后续范围见 [ADR-039](../decisions/ADR-039-performance-capture-lifecycle-and-evidence-status.md)。

## 2. 实现与证据

| 验证点 | 实现 / 自动化证据 | 结论 |
| --- | --- | --- |
| 采集生命周期 | contracts 的可注入工厂与幂等 finish；production-capture.test.ts 验证停止后才导出、finish 两次只收尾一次 | 自动化通过，不替代真实 xctrace 就绪验证 |
| 取消/超时/输出处理 | capture-process.ts 同 signal、有界输出、超时、优雅停止与强杀后等待退出；测试启动本机无设备操作的 Bun 子进程 | 本机测试子进程验证通过，不冒充真机取消 |
| 非敏感进度与失败 | 固定 Activity 文案和原因码，导出原始 stderr 不进入结果；进度 observer 异常不打断进程收尾 | 回归覆盖 |
| 生产顺序 | committed-run-status.test.ts 物理 fixture：preflight → recording → finalized → backend close → publish；采集收尾中取消仍为 cancelled，staging 清理 | 自动化通过；未运行物理设备命令 |
| 指标诚信 | 缺失 crash/hang 为 undefined；显式单位的内存换算，拒绝 unitless 数值；unknown schema 不填零 | parser 与报告回归覆盖 |
| 报告与证据落盘 | metrics.collection + testDurationMs；UI passed 但请求指标缺失则 run inconclusive；原始 trace 经 RunWriter 导入和 canonical loader 重新校验 | runtime/JSON Schema parity、完整性与报告测试通过 |
| 分层与安全 | 工厂从 TUI/CLI 注入，engine 不导入具体性能实现；raw-local-only trace，不将 trace/XML 输入模型 | 架构门禁与 G7 通过 |

## 3. 执行记录

- 初轮定向回归：69 pass / 0 fail。
- 完整回归先识别两处旧测试仍期待无数据的 false/0，修正其 R5 语义后，全库 3935 pass / 7 skip / 0 fail，11341 assertions，94.96s。
- 进一步补充进度 observer 异常保护、transport rejection 与导出失败/取消保留已完成 trace 测试后，最终全库 **3938 pass / 7 skip / 0 fail，11351 assertions，362 files，94.18s**；`bun run typecheck`、`bun run lint`、`bun run build` 和 `git diff --check` 均通过。最终采集生命周期专项为 7 pass / 0 fail。
- `bun run gate:g4b`：19 pass；`bun run gate:g7`：7 pass；changed/worktree 字面量扫描通过。
- 无参数全库 G2 的既有 DEF-035 未在本轮修改或关闭，不宣称其通过。本次没有把自动化 fixture 当作性能 G5/G5-SIM。

2026-09-08 提交补充：用户另行明确授权直接提交推送到现有 PR #82。提交前重新执行 typecheck、lint 和全库测试，结果为 3938 pass / 7 skip / 0 fail，11351 assertions，362 files，96.06s。本次仅提交已批准增量及文档，不新增设备操作、不合并 PR，也不推进任务为 done。

## 4. 尚未完成的性能验收

1. 物理 iPhone 实测 VM Tracker/Animation Hitches 录制就绪、结束和 TOC/XPath 的真实输出；不支持的 schema 应在报告中明确 not_exportable，并能在 Instruments 人工打开原始 trace。
2. 内存字段必须确认单位、目标进程和采样窗口；现有有限 XML 格式回归不能证明任意 Xcode 版本均可读出真实 footprint。内存峰值与多轮内存增长趋势分别验收。
3. 当前 attach 时机不能测冷启动；Simulator/XCUITest 并行性能采集尚未接入，未采集请求需保持显式缺失。按各路线补生命周期与 G5/G5-SIM，不静默改路线或重启应用。
4. 生产 baseline 建立/读取/比较/逐次授权接受尚待接线；没有 baseline 不生成假 delta。内存增长不等于泄漏，自动泄漏诊断不在本单元中宣称完成。

已完成的 UI 证据继续有效，后续按专项增量测试，不重复要求用户证明原有 UI 流程。T6.12 在上述真实性能缺口处置前不能标 done。

## 5. 真机验收启动与模板修复（2026-09-08）

用户已连接/解锁手机并批准修复及性能、增长、泄漏验收计划；新增样例安装、构建/重签仍需具体操作授权。只读探测发现 Xcode 26.5 的 `xctrace list templates` 没有 VM Tracker，而 `list instruments` 含 VM Tracker。原实现误用 `--template 'VM Tracker'`，现改为 `--template 'Activity Monitor' --instrument 'VM Tracker'`；非内存请求保留 Animation Hitches。

新增参数断言先得到 6 pass / 1 fail，证明旧参数错误；修复后原 7 项全部通过，另补非内存分支回归，最终 8 pass / 0 fail / 29 assertions。typecheck 通过，修正格式后 lint 与 diff-check 通过。未使用替身冒充真机：本次 Instruments 仍将目标列为 Offline，devicectl 同时显示 paired、developer mode enabled、wired 但 tunnel disconnected。等待物理连接恢复，不执行录制、安装或签名。此时无新 trace、真实内存样本或泄漏结论。

## 6. 连接恢复后的 scoped 真机性能证据

用户重新插拔后，USB 枚举已识别 iPhone；列表仍为 Offline，但针对设备的 `devicectl device info details` 查询返回 connected/booted/developer mode enabled。随后确认既有 SpikeApp 已安装，启动一次，不重新安装或签名。全部原始 trace/XML/命令输出保留本机 `~/.itestagent/runs/<probe-id>/artifacts/`，仅派生的非敏感结构/数值用于诊断。

| Probe | 实际结果 | 解释 |
| --- | --- | --- |
| performance-probe-1788887143707 | 名称 attach 返回 exit 19，未录制 | 刚启动后无法匹配进程名；后续只读查询证实进程存在，不据此断言 App crash |
| performance-probe-1788887248162 | 已验证 PID attach 后，旧 readiness 等待 30 秒并取消 | 真实提示没有旧正则要求的 `Hit`；不是手机停住或内存无变化 |
| performance-probe-1788887331336 | 修正提示后，PID 诊断录制/停止/TOC exit 0，最初内存 not_exportable | 公开内存表名为 activity-monitor-process-live，旧过滤未选中；不以空值冒充零 |
| performance-probe-1788887648225 | 生产工厂按名称 attach，静置 20 秒，record/TOC/XPath 均 exit 0，memory_peak collected | 新增定向 schema reader 后，近似峰值 8.344161987304688 MiB；raw-local-only trace 存在 |

第三轮公开 XML 的脱敏派生校验：目标 PID 匹配，footprint 列的 engineering-type 为 size-in-bytes，6 条观测，首值 7963056 B、末值 7979440 B、峰值 8028592 B（7.6566619873046875 MiB）。新增 TypeScript reader 对同一真实 XML 按名称和核实的 PID 均得到相同峰值/样本数。首末差值不是多轮增长趋势，不据此判断泄漏；两次录制峰值不同也不自动等于回归。

第四轮通过同一生产 capture factory/owned transport/parser 获得指标，未替换 xctrace。只读检查该 probe 根目录：94 个文件、10155278 字节、0 symlink、0 group/other 可访问条目；收尾时系统观察到 0 个 xctrace 进程。原始 probe-audit.json 不是 canonical result.json，不把 backend probe 冒称生产 TUI→正式报告闭环。

额外诊断 `sysmon-process` 导出返回 exit 139，即使已输出部分 XML，也不采信该次导出为成功；生产选择的是成功导出的 activity-monitor-process-live，未引入 sysmon fallback。

回归包含：实际就绪文本跨 chunk、模板/instrument 参数、真实表结构的生产工厂接线、进程过滤、typed id/ref、未知单位/损坏引用/截断失败关闭。后续仍需正式 Run bundle 性能验证、多轮稳定工作负载、可释放/持续保留/已知泄漏的对照样例，以及受影响路线 G5/G5-SIM；独立样例的构建/签名和安装必须逐项授权。

最终自动化检查：typecheck、lint（878 files）、diff-check 通过；全库 3941 pass / 7 skip / 0 fail，11364 assertions，363 files，90.74s。此次无 commit/push，DEF-035 保持 open，T6.12 保持 in_progress。

## 7. 内存增长/泄漏产品能力增量（2026-09-08）

### 7.1 批准范围和落地

用户澄清目标是让通用 iTestAgent 检测 App 性能，而不是证明样例无增长/泄漏，并确认产品实现计划。已新增 US-12.3 和 ADR-040；本节不重复声称已完成 UI 验收，不新增构建、签名、安装或卸载操作。

| 已实现项 | 代码/自动化证据 | 当前限制 |
| --- | --- | --- |
| 显式请求到确认计划 | performance-intent / intent-parser / test-plan-compiler；新增 memory_growth、memory_leaks 与 memoryObservation；YAML 与 runtime/JSON Schema 一致 | 常用中英文指标和时长解析；不是任意自然语言理解已验收 |
| 观察与反馈 | production-capture + observation-wait；最小观察及操作后等待在 Plan Review 可见；等待倒计时，AbortSignal 贯穿，finish 幂等 | 不自动重放探索动作，不生成多轮实验 |
| 真正时间序列分析 | Activity Monitor start-time ns 与 size-in-bytes footprint；严格目标、id/ref、时间递增检查；memory-growth 输出首尾、峰值、区间与端点增长速率 | 近似 MiB；拒绝缺失/重复/倒序时间，不以 allocated bytes 冒充占用 |
| 覆盖与结果诚信 | recordingDurationMs 与样本 durationMs 分离；partial 不能被非空值覆盖为 collected；缺失→inconclusive，保留 UI case passed | 当前真实样本未覆盖确认的 30 秒，不宣称完整窗口 G5 |
| 报告与 baseline | result.json 保留样本，summary.md 显示范围/限制，trace 为 raw-local-only；canonical 发布后才首次建立合格 physical baseline，后续只比较 | 多轮趋势、TUI 接受新 baseline、跨进程创建竞争和完整环境指纹仍未补齐 |
| 泄漏请求 | Leaks 模板 + Activity Monitor instrument、明确 collection 原因、保留完成的 trace 并提示 Instruments 人工检查 | 当前没有自动 detected/not_detected 输出，**自动泄漏诊断未完成** |

### 7.2 真实后端采集证据

对已运行的既有 App 做 scoped attach；由真实生产 capture factory、owned transport 与 parser 执行，不替换 xctrace。所有原始 trace/XML/命令输出留在本机 `~/.itestagent/runs/<probe-id>/artifacts/`；下表仅记录非敏感派生事实。没有驱动多轮 UI 工作负载，也不是 TUI→canonical 入口验收。

| Probe | 观测结果 | 可得结论 |
| --- | --- | --- |
| performance-probe-1788888402966 | 诊断包装选择 Leaks + Activity Monitor，record/TOC/XPath exit 0，近似峰值 10.438 MiB；TOC 无可验证泄漏诊断表 | Leaks 录制可成功，不表示自动诊断或零泄漏；该轮声明指标仍为 memory_peak |
| performance-probe-1788888940500 | 生产 growth+leaks 请求在 readiness 30 秒内未就绪，取消后 record exit 137 | 本轮采集失败，不推断 App crash 或泄漏，无伪造指标 |
| performance-probe-1788889087256 | 生产 peak+growth 请求，确认观察 30 秒/操作后等待 5 秒，record/TOC/XPath exit 0；7 条真实样本 | 峰值 9.000434875488281 MiB，样本跨度 7274.4315 ms，首尾差 -0.109375 MiB；只描述局部区间，不表示 App 健康 |

第三轮录制约 30 秒，但导出跨度只有约 7.27 秒。该 probe 发生在覆盖保护补丁之前，其原始 audit 的 collected 记录保留不改写；发现后增加 `coverage: partial` 与 `xctrace.memory_window_incomplete`，并补 canonical 报告/不建 baseline 回归。只读重放该真实 XML 得到相同 7 个样本、跨度与差值，按当前覆盖判定为 partial；没有把重放当作一次新真机运行。

收尾只读进程检查：0 个 xctrace 进程。三次 probe 分别含 158、3、94 个文件，递归检查均为 0 个 group/other 可访问项和 0 symlink。未终止或接管其他 owner 的服务。probe-audit.json 不是正式 result.json，不用于关闭 G5。

### 7.3 泄漏诊断阻塞与剩余责任

本机公开 `xctrace export` 只有 TOC/XPath/HAR 等导出入口；本次成功 Leaks trace 没有可验证的泄漏诊断表，因此不能凭 parser 补丁产生真实诊断。已复核既有候选 [memorydetective](https://github.com/carloshpdoc/memorydetective) 的公开说明：自动捕获 memgraph 面向 Mac/Simulator，真机仍需 Xcode Memory Graph 导出。这不是“真机诊断永远不可能”的结论，只说明当前已验证通道及该候选不能直接提供无人操作的真机采集。

下一步需要确认产品证据获取方案，例如引导 Xcode 导出并导入 memgraph 后自动分析；这仍包含人工步骤，不能宣传为全自动真机泄漏检测。未安装新依赖、未引入 App 内 SDK/测试 hook，也不以 Simulator leak 工具替代真机证明。

US-12.3 AC3 的多轮可复现资产接线、AC4 的真实泄漏诊断结果、AC7 的新性能 G5/G5-SIM 均尚未满足；完整观察窗口、两次真实 canonical baseline 对比、TUI 接受新 baseline 与新增 Simulator/XCUITest 采集也待补齐。已实现部分不能替代整个 T6.12 完成条件。样例对照只可验证能力，不能取代通用产品实现。

### 7.4 自动化门禁

- 最终 `bun run typecheck`、`bun run lint`（886 files）通过。
- 全库 **3954 pass / 7 skip / 0 fail，11420 assertions，366 files，93.59s**；日志 `/private/tmp/itestagent-memory-capability-final-tests.log`。未新增 skip。
- 初轮全库发现两处旧预期：明确 FPS 请求仍要求通用指标包，以及固定旧指标枚举。按新契约修改并补通用性能请求覆盖，没有删除测试或放宽断言。
- 定向覆盖：真实表时间列/单位/引用、采样完整性、观察取消、Leaks 模板无诊断不填零、首 run baseline/后续差值/不覆盖、部分证据不建 baseline、报告与 canonical 再加载。
- 文档收尾检查进一步修正 MB/MiB 展示：新采集显式写 memoryPeakUnit，保留旧字段兼容性，报告与 baseline 差值按单位展示，baseline key 隔离单位；补充真实表 capture 及 canonical 单位断言。上述完整回归为单位修复前记录，修复后结果另行追加。
- 文档同步后专项门禁：schema registry 6 pass、架构 G4b 19 pass、脱敏 G7 7 pass；diff-check 通过。
- 单位修复后最终检查：typecheck、lint 通过；全库 **3954 pass / 7 skip / 0 fail，11424 assertions，366 files，93.40s**，日志 `/private/tmp/itestagent-memory-capability-units-final-tests.log`。峰值采集、canonical 再加载及 baseline 报告单位断言通过；旧无单位报告兼容测试保留。
- 当前记录不是新 TUI 真机验收；DEF-035 全库 CLI literal 扫描问题保持 open，不宣称该门禁通过。未 commit/push，T6.12 保持 in_progress、T6.13 保持 pending。

## 8. 全自动要求与 Leaks 导出调查纠正

2026-09-08 用户明确拒绝半自动提议，要求全自动；不再把人工打开 Xcode/Instruments 或导出 memgraph 作为用户每次测试的必经步骤。必要环境初始化、安全授权与设备信任仍遵守现有边界，不等于无限制自动授权。

只读重查 `performance-probe-1788888402966/artifacts/command-1.txt`：TOC 除 24 个 data/table 节点外，还包含 tracks，以及 Allocations（Statistics、Allocations List）和 Leaks（Leaks）详情。此前 schema 列表没有 leak table，**不代表 TOC 没有官方泄漏导出入口**。旧调查不能用来宣称全自动不可行。

通过既有 owned/bounded transport 对该 trace 执行公开命令 `xcrun xctrace export --xpath '/trace-toc/run[@number="1"]/tracks/track[@name="Leaks"]/details/detail[@name="Leaks"]'`，结果 exit 0、stderr 0 bytes、stdout 148 bytes、完整 trace-query-result 内只有一个空 node，无诊断行。仅输出元素计数等脱敏结构，不把原始诊断内容传入模型；未连接手机或新增构建/安装/签名，不操作 Xcode GUI。

按现有证据排序的待验证假设：

1. 生产导出发现只遍历 data/table，遗漏 tracks/details（TOC 已证实遗漏；尚未实现修复）。
2. 此次录制没有完成可导出的有效 Leaks 扫描（空 node 与成功退出不能证明扫描成功，需进一步检查记录配置/扫描状态）。
3. 目标未产生该工具可识别的阳性诊断，或查询/视图所需条件未满足（需已知泄漏与修复后对照验证，不能把空 node 直接解释为零泄漏）。

继续目标是全自动公开采集→诊断→canonical 报告，不逆向 trace、不用内存曲线替代泄漏诊断。当前只有只读调查和要求同步，无新增生产代码变更、无全量回归重跑，不扩张上一轮已通过测试或 G5 的证明范围。

## 9. 官方详情导出与纯 Leaks 模板对照

2026-09-08 继续已批准的全自动调查，复用现有有界、可取消、owner-owned xctrace transport，无新依赖、无构建/安装/签名或 GUI 操作。

| 验证 | 结果 | 可支持的结论 |
| --- | --- | --- |
| 旧 probe `1788888402966`，相同官方 XPath 加 `--output` | Leaks exit 0，148 bytes，只有空 node；Allocations Statistics 55 行、Allocations List 14,449 行 | 该 trace 的详情导出接口可工作；切换 stdout/文件不能使其产生泄漏证据 |
| 新 probe `performance-probe-1788891840825`，对现有运行中的 SpikeApp 使用纯 `--template Leaks`，移除附加 instrument，静置 20 秒 | 录制与 TOC exit 0；Leaks 详情仍是 148 bytes 空 node；Statistics 85 行、Allocations List 15,638 行 | 单独改成纯模板不足以解决空结果；不能判无泄漏或证明扫描已执行 |

原始 XML 保存在对应 run 的 `artifacts/detail-export-check/`，trace 保存在 `artifacts/performance/execution.trace`，均为 raw-local-only；仅将脱敏结构与计数提供给 Agent。该新 probe 使用测试 transport 参数覆盖，故 audit 的工厂进度仍写 Activity Monitor + VM Tracker；实际录制参数为纯 Leaks，**不是生产配置已修改或生产内存峰值通过**。其 memory_peak 为 not_exportable，与纯模板未提供 Activity Monitor 表一致。本轮结束后只读观察 xctrace 进程数为 0。

录制设置可见 Allocations；不能根据可配置 settings 仅列一个 instrument 就断言 Leaks 未启用。现有验收源代码只有标题、点击计数和按钮，没有已知泄漏阳性路径。因此下一步是独立已知阳性/修复后对照：以不同 bundle 的专用验收 App 产生可被工具识别的不可达分配，自动录制并验证公开 Leaks 导出，然后基于真实数据接入生产解析、报告及回归。创建/构建该测试项目、使用既有个人 Team 签名和首次安装须逐项明确授权；不覆盖现有 device-lane，不将用户手工 Instruments 操作作为验收步骤。

当前未新增生产代码、未重跑全库测试、未提交推送；T6.12 保持 in_progress。尚未实现自动泄漏诊断，空结果语义与完整生产 G5 均不冒进宣称完成。

## 10. 已知泄漏对照及生产解析接线（2026-09-08）

用户明确批准创建、构建、使用既有个人 Team 签名并首次安装独立测试 App。实际使用不同 bundle 的 MemoryProbe，未覆盖 device-lane、未安装新依赖。签名配置仅在本机构建时传入；无个人配置的源文件见 `fixtures/ios-memory-control/`。临时项目用现有 XcodeGen 生成，xcodebuild、codesign 验证、首次安装成功，证据根为 `memory-control-1788892559403`。

| 真机 probe | App 执行凭据 | 公开 Leaks 详情 | 结论 |
| --- | --- | --- | --- |
| `memory-control-1788892616156`，纯 Leaks，70 秒 | 4 批、20 次成功分配，每次 262144 bytes、释放 0 次 | 20 行、5242880 bytes | 阳性诊断自动导出成立，无需人工 Instruments 导出 |
| `memory-control-1788892740364`，同一 App 的 --control，70 秒 | 4 批、20 次分配、20 次释放 | 空 node，148 bytes | 释放对照有差异；不足以把任意空 node 定义为扫描成功或全 App 无泄漏 |
| `memory-control-1788893141273`，当前生产工厂 Leaks + Activity Monitor，70 秒 | 4 批、20 次分配、释放 0 次 | 19 行、4980736 bytes；生产 memory_leaks collected、memoryLeaks.status detected | 自动返回 19 条/4.75 MiB；保留实际观测，不补齐为 20 条 |

原始 trace/XML、App 凭据位于各自 `~/.itestagent/runs/<probe>/artifacts/`，仅保留本地；第三轮聚合结果为 `production-capture-result.json`。这不是 canonical TUI Run，不替代正式 G5。录制结束后本轮独立 MemoryProbe 进程已停止以释放测试分配，App 保留安装供复测；不卸载、不操作其他 App。

生产增量：请求 memory_leaks 时自动查询官方 tracks/Leaks/details/Leaks，不再只遍历 data/table。窄格式 parser 仅接受已验证的逐分配 count=1、正整数 size、唯一地址及完整 XML；空、截断、重复、未知聚合 count、溢出、DTD/ENTITY 全部 fail closed。输出仅含来源、observed_allocations 范围、detected、数量和字节，地址/栈/库名不进入结果。runtime/published schema 新增可选 memoryLeaks；canonical 重加载保留该字段，summary 展示诊断及范围，引用 raw-local-only trace。

检查：定向 32 pass / 0 fail / 133 assertions；typecheck、lint（888 files）、diff-check 通过；全库 3958 pass / 7 existing skip / 0 fail，11442 assertions、367 files、96.64s，日志 `/private/tmp/itestagent-leaks-detail-regression.log`。未新增 skip，未提交推送。

边界：仅接入已验证的阳性诊断；空导出仍 not_exportable，不生成零泄漏。有效零结果确认、任意 retain cycle、完整 TUI/canonical 真机和 Simulator 验收仍未完成。T6.12 保持 in_progress，DEF-035 不变。

诊断偏差：一次临时结构摘要命令查找裸 node 未匹配带 xpath 属性的节点，错误输出了受控 fixture 的原始 XML 片段（分配地址、fixture 栈名），违反原始 XML 不进入模型上下文边界。未发现账号/密钥；随后停止该摘要方式，改为只输出 parser 聚合数值。不把本轮宣称为全项 G7 验收通过；生产 parser 不回显原始字段。

## 11. 按钮驱动样例与正常 TUI 复测（2026-09-08）

用户批准独立样例改为按钮驱动，以及一次既有个人 Team 构建签名、覆盖安装 MemoryProbe、WDA 准备。旧临时目录已不存在；从版本化 fixture 在新临时目录重建 XcodeGen 工程，个人 Team 仅写入本机临时工程。新增真实 `MemoryProbeViewController` 声明和可访问性标识，启动为空闲状态；按钮启动 0/5/10/15 秒的四个有界批次，两个按钮随后禁用，每进程最多 20 次分配（5 MiB）。第 10 节的历史 probe 使用旧启动定时版本，不把它们归为此按钮版本的证据。

以真实 PTY 启动正常 CLI `packages/itestagent-cli/src/cli.ts`，未注入 production dependencies、假 backend、profile 或 performance factory。真实分析器发现 MemoryProbe 候选，TUI 完成候选、真实 iPhone、计划确认，分别授权 execute_project_build / replace_device_app / prepare_wda。计划请求 memory_peak / memory_growth / memory_leaks、70 秒观察。发现解析偏差：同一句“等待20秒…操作后等待10秒”取到了前一个等待，计划实际显示 settle=20 秒；尚未修复，不声称精确遵循了后等待参数。

本轮 canonical run：`run_01a0828b-b283-7000-829f-bc80a1cafa76`。实际构建并安装启动了 MemoryProbe，但 `physical_preflight_wda_status` 在 60004ms 后超时；result.status=`infra_failed`，三个请求指标均为 `not_exportable / performance.route_did_not_collect`，无性能采集成功或 UI 点击成功声明。报告三件套与 steps.json 已落盘。辅助 PTY 原始记录及受控工作负载回执仅存本地 `~/.itestagent/runs/memory-tui-1788900000/artifacts/`；此辅助目录不是 canonical run。回执 started=false、batches=0、allocations=0，证明样例没有提前执行工作负载。

只读诊断：WDA 默认工程选中了现有真机 DerivedData 和预构建 Runner；该产物 profile 到期时间为 2026-09-14 22:48:06 UTC，包含目标设备且 get-task-allow=true。超时前 xcodebuild / iproxy 存在，失败后两者均已清理；本次 xcresult 未完整提交，未取得更具体启动原因。候选原因仍为 Runner 未就绪、USB 转发不可达或预构建/启动状态不匹配，不能以超时断言签名过期。未额外重签、未再次安装；本轮 MemoryProbe 进程已停止，安装保留。

检查：typecheck、lint（888 files）、diff-check 通过；定向 173 pass / 0 fail。沙箱全库 3936 pass / 29 skip / 0 fail；开放本地 loopback 后复跑为 3958 pass / 7 existing skip / 0 fail、11442 assertions、367 files、97.91s，未添加跳过项。T6.12 仍 in_progress；正常 TUI 阳性性能报告、空泄漏导出语义及 Simulator 验收仍未完成。未提交推送。

## 12. 后置等待参数修复与一次 WDA 有界诊断（2026-09-08）

用户批准修复等待解析，并复用既有签名进行一次 WDA 有界启动诊断；本轮不构建/重签 WDA，不构建或覆盖安装 MemoryProbe。

代码根因：`parsePerformanceRequest` 对整句执行第一个 wait/等待匹配，没有区分工作负载动作与性能采集的后置观察区间。修复优先匹配明确的后置等待表达（中文操作/动作/测试后，英文 after actions 前后语序），再使用已有通用匹配或默认5秒；明确0秒不丢失，越界仍由 schema 拒绝。新增中英文与顺序反转测试，并验证 Intent→TestPlan→YAML 重加载为70秒观察/10秒后置等待，原 goal 的20秒工作负载等待仍保留。定向53 pass / 0 fail / 118 assertions。

真机诊断使用现有 `WdaManager.launch`、`waitForReady` 与 `IProxyTunnel`：单次 test-without-building、8100 USB转发、最大120秒等待；未替换 production backend，仅为诊断增加独立 xcresult 路径和白名单输出识别。结果：17次 status 请求，在8092ms返回 HTTP200、ready=true，同时识别到 test suite、test case、server announcement；启动早期出现连接拒绝/ECONNRESET，随后正常就绪。证据：`~/.itestagent/runs/wda-start-diagnostic-1788897663562/artifacts/diagnostic.json`；xcresult 保留 raw-local-only，未将原始日志/设备内容发送到模型。

这证明当前既有签名与 WDA 启动链路在本次尝试可用，不能证明上轮60秒超时的根因已确定，也不能据此改长生产超时或声称修好了间歇故障。仍保留第11节的失败事实。本次未启动 MemoryProbe 工作负载、未生成新的 canonical 性能报告，不替代 TUI 性能 G5。

`finally` 执行 manager.stop 与 tunnel.stop，随后只读进程清单未见本轮 xcodebuild/iproxy；不停止其他 MCP 或用户进程。T6.12 继续 in_progress，DEF-035 不变，未提交推送。后续完整 TUI 复测涉及新一轮构建/覆盖安装和 WDA 准备，须另行确认，不能复用本轮一次性授权。

最终检查：typecheck、lint（888 files）、diff-check通过；完整回归3966 pass / 7 existing skip / 0 fail，11453 assertions、367 files、96.13s，包含新增计划序列化回归。日志为 `/private/tmp/itestagent-settle-wda-regression.log`。没有新增 skip 或把独立诊断标为正式性能验收成功。

## 13. 正常 TUI 真机自动内存阳性链路（2026-09-08）

用户另行批准一轮构建、覆盖安装独立 MemoryProbe 和 WDA 准备。复用第11节的按钮样例及现有个人 Team；不改设备后端、不注入模型响应、profile 或采集工厂。通过真实 PTY 启动正常 CLI，在真实候选/设备/计划审核页面确认物理 iPhone，以及 memory_peak / memory_growth / memory_leaks、minimumDuration=70秒、settleDuration=10秒，再为三个具体权限各回复一次 allow。实际页面也确认第12节等待参数修复生效。

Canonical run：`run_01a082a3-9a09-7000-94bc-26e9d6da37bf`，默认目录 `~/.itestagent/runs/<runId>/`。本轮正常完成 AUT 构建、覆盖安装、WDA 准备、生产性能录制、动作探索、导出和报告发布，TUI 显示 Execution completed 与 Report directory。`createDefaultRunStore().loadRunBundle()` 重加载通过 schema、交叉引用及 artifact 完整性验证。

| 验证事实 | 真实结果 |
| --- | --- |
| canonical 动作 | launch、tap、wait、wait、wait、screenshot，6步均 completed；泄漏按钮仅点击一次 |
| 工作负载回执 | started=true、4批、20次分配、0次释放、complete=true |
| 观察配置 | 最低70秒，操作后等待10秒；原20秒动作等待保留 |
| 实际录制与采样 | recordingDurationMs=184888.661083；75个样本，样本跨度178888.217041ms，coverage=complete |
| 内存指标（近似，目标进程本次观测区间） | 首样本9.359878540039062 MiB，末样本48.234901428222656 MiB，峰值48.250526428222656 MiB，变化+38.875022888183594 MiB |
| 独立 Leaks 诊断 | xctrace-leaks-detail、detected、observed_allocations；20条、5242880 bytes（5 MiB） |
| collection 状态 | memory_peak / memory_growth / memory_leaks 三项均 collected / performance.observed_value |
| 原始证据 | canonical artifact-index 包含2张截图和1个trace，全部 raw-local-only；原始图像/trace/XML未输出到模型 |

70秒是最小观察时间而非硬性总时长；模型还执行了70秒和10秒的等待动作，叠加读取/模型与收尾观察，本次实际覆盖约179秒。不得把38.875 MiB footprint增长等同于5 MiB已诊断泄漏，也不将其全部归因于样例分配；二者是不同测量。

状态边界：result.status 与 case.status 均为 `explored`，不是 passed。确认计划 policy=user_goal_then_profile_then_agent_confirmed，但 assertions.length=0；本轮输入的未加引号可见性条件没有成为确定性断言，因此不能以动作模型报告完成替代功能断言通过，也未证明完整成功 baseline。可验收事实是**正常生产 TUI→实际按钮工作负载→自动内存增长/阳性泄漏诊断→canonical报告的真机链路成立**。有效零泄漏语义、完整确定性断言、多轮/baseline与Simulator验收仍未完成，T6.12保持in_progress。

辅助原始PTY日志和工作负载回执保存在 `~/.itestagent/runs/memory-tui-retest-1788898400/artifacts/`，不冒充 canonical run。报告完成后，生产 xcodebuild/iproxy/xctrace 已退出；本轮 TUI、专用 Appium 和已核实的 MemoryProbe 进程均停止，保留安装与报告，未触碰其他应用或进程。

本轮未修改生产代码；沿用第12节3966 pass / 7 existing skip / 0 fail与typecheck/lint结果，不伪称再次全量回归。新增验证为真实TUI、工作负载计数、canonical bundle重加载及diff-check。使用 sync-docs-itest 同步实证边界，DEF-035不变，未提交推送。

## 14. 增量提交前检查（2026-09-08）

用户要求先提交推送到当前 PR #82。重新运行 typecheck、lint（888 files）、build、schema/架构/脱敏专项（32 pass）及完整回归：3966 pass / 7 existing skip / 0 fail，11453 assertions、367 files、92.23s。完整日志 `/private/tmp/itestagent-memory-precommit-tests.log`。本次未新增真机运行，不将自动化检查扩大为尚未完成的验收；第13节阳性实证及 explored 限制保持不变。DEF-035 的历史全库 literal CLI 问题仍 open，提交按 changed/index 范围另行检查，不宣称全库 CLI 门禁已修复。T6.12 保持 in_progress。

## 15. 无引号可见性条件与计划提示（2026-09-08）

用户确认先修复影响成功 baseline 验收的断言缺口，本轮不操作真机。按证据排序核查：解析遗漏、计划确认丢失、执行汇总丢失。直接调用生产 parser，中文 `确认 Workload complete 可见` 与英文 `verify Workload complete is visible` 均返回空数组；带引号则产生用户条件。代码仅匹配引号目标，确定解析阶段已遗漏，不把第13节 explored 改写为 passed。

新增有限无引号语法及原文顺序去重，沿用敏感目标和多 case 阻断；明确否定/条件前缀、复合目标、否定可见性或尾部替代项不生成新条件。复杂/不能可靠解析的表达仍保留 goal。Plan Review 始终显示 Success Criteria，缺失时提示并给出修改示例；XCUITest 原生结果边界独立说明。

先新增回归得到53 pass / 5 fail，验证旧实现缺口；修复后定向119 pass / 0 fail、335 assertions。覆盖中英文、有/无引号混排、T6.12/Taps: 1 标点保留、去重、敏感值不回显、多 case 歧义、候选/目标选择及显式确认、YAML重加载。通过真实 AssertionEvaluator 和 canonical writer/store 的回归：可见观测→passed并建立baseline；不可见→failed、缺观测→inconclusive，两者均不建baseline。该测试使用合成观测和指标，不能替代真机实测。

本轮未构建、重签、安装、录制或改写历史run；零泄漏语义、多轮与baseline真实验收、Simulator仍未完成。DEF-035不变，T6.12保持in_progress。

最终检查：typecheck、lint（888 files）、diff-check和diff敏感信息扫描通过；全库3990 pass / 7 existing skip / 0 fail，11507 assertions、367 files、95.03s。日志 `/private/tmp/itestagent-unquoted-full-tests.log`；包含既有OpenTUI字符帧、滚动与键盘回归，不冒称新真实终端人工验收。本增量未提交推送。

## 16. 明确断言通过，但首次 baseline 被采样覆盖门禁阻断（2026-09-08）

用户重新连接 iPhone 并明确授权本轮 MemoryProbe 构建、替换安装和 WDA 准备，各使用一次。设备最初 tunnelState=disconnected，但交叉复查确认 USB 可见、transportType=wired，生产发现解析为 ready；不把隧道字段单独解释为整体不可用。正常 CLI/PTY、原生产模型/设备/采集/报告组合，未替换依赖或重签 WDA。在候选、物理目标及计划审核中确认两条无引号可见性条件、三项内存指标、70秒观察、10秒操作后等待和 local_auto。

Canonical run：`run_01a082cc-99a3-7000-a96c-76d566174635`。`createDefaultRunStore().loadRunBundle()` 重新加载通过 schema、交叉引用和 artifact 完整性验证。辅助终端/Appium原始日志仅保存在 `~/.itestagent/runs/memory-baseline-tui-1788900781/artifacts/`；canonical截图和trace保持raw-local-only。

| 验证项 | 真实结果 |
| --- | --- |
| 计划成功条件 | iTest Memory Probe 可见；Workload complete 可见，两条条件均保留 |
| 功能结果 | MemoryProbe case passed；launch、tap、wait、screenshot 四步 |
| 内存采集 | 40个目标进程样本；录制70002.649ms，有效样本跨度59847.264ms，coverage=partial |
| 近似观测值 | 首9.281776MiB、末48.219299MiB、峰48.578674MiB、增长38.937523MiB；只代表实际覆盖区间 |
| 独立泄漏诊断 | detected / observed_allocations，13条、3407872 bytes（3.25MiB）；不补齐为样例理论分配数量 |
| 指标状态 | memory_peak与memory_leaks collected；memory_growth not_exportable / xctrace.memory_window_incomplete |
| 总状态与baseline | run inconclusive；physical baseline 文件数为0，未将不完整指标提升为首次成功baseline |

诊断按证据排序：①停止时机按录制墙钟而不是有效采样跨度，最强证据；②Activity Monitor启动/尾端刷新或稀疏采样造成覆盖缺口，可能但未定位底层原因；③parser误算时间或丢失行，尚无证据证明。现有 `production-capture.finish()` 计算 `max(minimumDurationMs - elapsed, settleDurationMs)`，本次在约70秒停止；随后导出的首末样本只有约59.85秒。代码可确认“等待墙钟满足最小时间并不保证样本窗口满足”的设计缺口，但不据此宣称已查明Apple工具内部的延迟原因。

本轮证明第15节明确断言已进入真实生产执行并通过，未证明成功baseline建立或第二次对比。不得放宽覆盖率门禁、伪造缺失样本、手写baseline或自动重复工作负载绕过。下一步需批准采集窗口策略修复及回归，再单独授权新的真机运行；保留零扫描、多轮与Simulator的未完成边界。已有DEF-035不变，T6.12继续in_progress。

收尾：本轮TUI与专用Appium已正常退出；只读进程清单未见xcodebuild、iproxy、xctrace。重新核对进程可执行文件后，定向停止本轮MemoryProbe，复查其进程数为0；应用安装和全部证据保留，不删除旧baseline或历史run。无生产代码变更，沿用第15节自动化门禁，不冒称重跑全库。未提交推送。

## 17. 有界采样余量与baseline策略隔离修复（2026-09-08）

用户批准修复第16节阻断。本增量不重新操作真机，不复用已消耗的构建、替换安装或WDA准备授权。按ADR-040，在同一录制中为有效样本窗口预留30秒工程余量，截止为 `max(readyAt + minimumDurationMs + 30000, actionsFinishedAt + settleDurationMs)`；不重复动作，不追加第二条trace。30秒覆盖既有约10秒/23秒的观测差值，但不是底层工具延迟保证，也不是已证明本轮真机问题解决。

共享MEMORY_CAPTURE_POLICY把余量和baseline策略版本绑定；TUI计划说明“Minimum … of exported samples”、physical额外采样余量和inconclusive限制，后台每秒倒计时说明导出后才验证覆盖。长动作已经超过预算时只保留用户的settling；最大确认窗口300秒对应330秒预算，工具600秒上限保持。finish仍幂等，沿用同一AbortSignal/owned transport；新增单调clock与可取消wait测试边界，不替换生产编排。导出后的严格coverage判断及不完整run禁止baseline逻辑未放宽。v2不与v1 baseline自动混比、不覆盖旧文件。

回归覆盖：模拟70秒目标、20秒动作和延迟采样时录制至100秒；有效样本85秒可通过、59.847秒仍partial/not_exportable；150秒长动作只加10秒settling，零settling不追加；最大窗口上界、余量内取消和提前退出均收尾且不导出，单次record/stop与重复finish一致。canonical测试同时保留v1的999MiB历史baseline并建立v2的10MiB基线，第二次12MiB仅对比v2得到+2MiB，历史值不变。上述数值是受控fixture，不是真机测量。

检查：定向54 pass / 0 fail / 864 assertions；typecheck、lint（888 files）、diff-check和差异gitleaks扫描通过；全库3998 pass / 7 existing skip / 0 fail，12205 assertions、367 files、107.78s。日志 `/private/tmp/itestagent-sampling-allowance-tests.log`。`sync-docs-itest`同步规格窗口说明、数据流、ADR-040、开发安排和任务状态，不修改历史验收结论。

本增量尚无新G5/G5-SIM证据，首次成功baseline/后续比较、有效零扫描、多轮及Simulator仍未完成。DEF-035保持open；T6.12保持in_progress，T6.13不启动。未提交推送。

## 18. 新策略正常TUI真机首次成功baseline（2026-09-08）

用户另行授权复测：MemoryProbe构建、替换安装、复用现有WDA签名准备，各一次。正常CLI/PTY入口、真实候选和物理设备选择、TestPlan审核及三项PermissionEngine许可，无模型/设备/采集替身，不额外重签或自动重复新一轮。TUI审核实际显示两条明确可见性条件、70秒有效导出样本、10秒操作后等待、30秒采样余量；活动中也观察到采样余量提示和导出阶段。

Canonical run：`run_01a082ed-5ee5-7000-be47-00b41954a634`，报告位于默认 `~/.itestagent/runs/<runId>/`。`createDefaultRunStore().loadRunBundle()` 重加载通过schema、交叉引用和artifact完整性校验。

| 验证项 | 真实结果 |
| --- | --- |
| 功能与总状态 | 两条明确可见性条件保留，MemoryProbe case passed，run passed |
| 请求指标 | memory_peak、memory_growth、memory_leaks全部collected |
| 内存有效覆盖 | 89个样本，跨度227793.130ms，录制229791.503ms，coverage=complete |
| 近似footprint | 首9.250504MiB、末47.609901MiB、峰48.359901MiB、变化+38.359398MiB |
| 独立Leaks诊断 | detected / observed_allocations，19条、4980736 bytes（4.75MiB） |
| 首次baseline | 运行前physical文件数0，运行后1；updatedFromRun为本run，峰值48.359901MiB、增长38.359398MiB与canonical报告一致 |
| 策略一致性 | baseline scenario与本plan/execution/observation/appSource/单位和memory-observation-v2计算结果匹配 |
| 原始证据 | 2张截图、1个trace，均raw-local-only；辅助PTY/Appium记录在memory-baseline-tui-1788902920/artifacts，未输出原始设备内容 |

审计动作：launch、tap、wait、screenshot、wait、wait；仅一次tap，三次wait实际约20003/70029/10003ms。模型将70秒观察和10秒后等待也生成了动作等待，加上模型/设备读取耗时及采集收尾，总录制约230秒。这证明**新代码的真实生产链路可成功采集并首次建立baseline**，但不构成30秒余量在短工作负载边界上的独立因果验证；不得把227.8秒样本描述成“只加30秒即修复”。等待时长与性能配置的重复表达仍是后续精确时长控制需评估的边界，本次未修改计划或重跑绕过。

Leaks阳性是诊断结果，不按未确认阈值改为功能失败；4.75MiB已诊断泄漏不等于38.36MiB总footprint增长。首轮无baselineDelta是正常首次建立语义，第二轮生产对比尚未执行；既有单元测试不替代该真机验收。有效零扫描、多轮可复现工作负载、Simulator及其他US-12.3剩余项保持未完成。

本轮TUI与专用Appium正常退出，进程清单未见xcodebuild/iproxy/xctrace；重新验证可执行文件后定向停止本轮MemoryProbe，复查进程数0，安装、baseline及全部报告保留。无生产代码修改，沿用第17节3998 pass/7 existing skip/0 fail门禁，不宣称重跑全库。仅同步验证记录、ADR与任务计划；T6.12继续in_progress、DEF-035不变、T6.13不启动。未提交推送。下一次构建/覆盖安装/WDA准备须新授权。

## 19. 正常TUI第二轮自动baseline对比实证（2026-09-08）

用户确认继续，另行授权MemoryProbe构建、替换安装及现有WDA准备各一次，三项均经生产PermissionEngine提示后单次确认。沿用第18节完全相同的自然语言目标、生产CLI/PTY入口与物理iPhone，不替换模型/设备/采集依赖、不重签WDA、不手写baseline或差值。

Canonical run：`run_01a082fd-4353-7000-be2a-84cb022096a7`；正常报告目录为 `~/.itestagent/runs/<runId>/`。生产RunStore重新加载通过schema、引用与artifact完整性校验。

| 验证项 | 真实结果 |
| --- | --- |
| 功能与指标 | 两条明确可见性条件保留；case/run均passed，memory_peak/growth/leaks均collected |
| 有效覆盖 | 96个样本，跨度226309.330ms，录制231016.274ms，coverage=complete |
| 近似footprint | 首9.344276MiB、末48.266174MiB、峰48.359924MiB、增长38.921898MiB |
| Leaks诊断 | detected / observed_allocations，20条、5242880 bytes（5MiB） |
| 自动差值 | baselineDelta指向首轮baseline；memoryGrowthMiB=+0.5625、memoryPeakMB=+0.00002288818359375（单位MiB），分别与两轮canonical值相减完全相等 |
| 原baseline保护 | physical文件数仍为1；updatedFromRun仍为run_01a082ed-5ee5-7000-be47-00b41954a634；运行前后SHA256均为a0238dbcf9a92402dd3f42bea8f733b1559def771d75903da4b9763121ae0cfe |
| 可比配置 | 两轮projectProfileRef、execution、memoryObservation、appSource逐项相同，baseline key相同；minimum=70000ms、settle=10000ms |
| 原始证据 | 2张截图及1个trace均raw-local-only；辅助PTY/Appium记录仅在memory-baseline-tui-1788903946/artifacts |

本轮审计仍为launch、tap、wait、screenshot、wait、wait，仅一次tap；三次wait实际约20006/70004/10004ms。因此证明真实生产首次baseline→下一次自动比较链路，不代表已接入已确认Flow的多轮自动工作负载，也不单独证明30秒余量在短动作边界的因果有效性。产品baselineDelta.summary为regressed，表示观测值增加，不是统计显著退化证明或功能失败；峰值差只有约24 bytes。内存增长与Leaks诊断仍分开解释，不以5MiB泄漏代替38.92MiB总占用变化。

TUI与专用Appium正常退出，复查本轮xcodebuild/iproxy/xctrace进程已退出。设备进程查询的权限审核首次超时、重试成功；随后重新验证PID与MemoryProbe可执行文件匹配，定向停止应用并复查MemoryProbe进程数为0。原baseline、安装与证据保留。无生产代码修改，沿用第17节3998 pass/7 existing skip/0 fail门禁，不冒称重跑全库。本轮文档diff-check、任务JSON解析与差异gitleaks扫描通过，无可级联转ready的pending任务。有效零扫描、多轮可复现工作负载、Simulator、接受新baseline及其他US-12.3剩余项仍未完成；T6.12保持in_progress、DEF-035不变、T6.13不启动。本轮未提交推送。

## 20. 提交与session交接检查（2026-09-08）

用户要求先提交推送到现有PR，再提供新session交接文档。本次重新运行typecheck、lint（888 files）、build及schema/依赖架构/脱敏专项（32 pass / 0 fail）。沙箱首跑3976 pass / 29 skip / 0 fail，其中22项本地服务测试因loopback受限额外跳过；随后在允许本地loopback/PTY的环境重跑全库：**3998 pass / 7 existing skip / 0 fail，12205 assertions，367 files，104.65s**。日志分别为 `/private/tmp/itestagent-handoff-tests.log` 和 `/private/tmp/itestagent-handoff-tests-full.log`，其他门禁日志同前缀。

本次没有新增真机运行或新生产逻辑，提交范围为§15–19的已批准实现、回归与实证。提交沿用PR #82和当前分支，保持T6.12 in_progress；DEF-035保持open，使用changed/index提交范围扫描，不宣称全库literal CLI已修复。历史各节“未提交”保留为当时状态。本次handoff见 `docs/05-planning/handoff-6.12-memory-2026-09-08.md`，交接包含已验证链路、下一步优先建议、未完成边界及必须重新取得的一次性授权；不传递secret或原始设备证据。


## 21. 有效零扫描证据调查（交接接续，2026-09-08）

用户确认分阶段计划：先寻找可机器读取的真实扫描完成证据，证据充分后才设计并接入 `not_detected`；不把空详情、录制成功、导出 exit 0 或 App 释放回执当作有效零扫描。本轮继续 T6.12，不启动 T6.13。

恢复点核对：工作区起始干净，HEAD `7ca4945`，分支 `docs/def034-physical-cancellation-evidence`；GitHub 只读查询确认 PR #82 OPEN、非 draft、base `dev-1.0`。T6.11 done、T6.12 in_progress、T6.13 pending，无可级联 ready 的任务；DEF-035 保持 open。

### 21.1 既有公开证据的有界复核

复用 §10 的阳性 `memory-control-1788892616156` 和释放对照 `memory-control-1788892740364`。仅调用公开 `xcrun xctrace export`，每条命令超时 30 秒；原始输出仅在本地内存中处理，模型只接收元素/属性名称、大小、退出状态及计数，未打开 trace 二进制内部。没有新设备录制、工作负载、构建、签名、安装、WDA 准备或 baseline 写入。

| 查询/证据 | 阳性 | 释放对照 | 判断 |
| --- | --- | --- | --- |
| App 回执 | 4批、20分配、0释放 | 4批、20分配、20释放 | 仅证明工作负载执行 |
| 公开 TOC | exit0、5616bytes、16种 data/table schema、1个 Leaks detail | 相同结构和计数 | 未暴露独立扫描完成节点；结构存在不证明扫描完成 |
| Leaks detail XPath | exit0、4748bytes、20 row | exit0、148bytes、只有空 node | 仍只证实阳性与空结果的差异 |
| Leaks track 父节点 XPath | exit0、181bytes、1个 message，无 row | 进程被 SIGSEGV 终止（Python returncode=-11），无 stdout/stderr | 不构成零结果，也不将父节点查询接入生产；原详情查询仍成功 |
| os-log table | exit0、1341bytes、0 row | 同左 | 无可用扫描状态证据 |
| os-signpost table | exit0、1692bytes、0 row | 同左 | 无可用扫描状态证据 |

上表 TOC、os-log、os-signpost 在交接恢复调查中完成，父节点/详情对照在用户确认后完成。查询根为 `/trace-toc/run[@number="1"]`，详情为 `/tracks/track[@name="Leaks"]/details/detail[@name="Leaks"]`，父节点为 `/tracks/track[@name="Leaks"]`，日志表为 `/data/table[@schema="os-log"]` 和 `/data/table[@schema="os-signpost"]`。不将可查询父节点等同于官方保证该节点可导出诊断。

初次沙箱内 TOC 导出两次均退出 -6、无 stdout；允许本地工具正常访问后，两份相同 trace 的 TOC 均成功。该环境失败与上述释放对照父节点 SIGSEGV 分开记录；没有修改工具权限、系统安全设置或原有 trace。

### 21.2 工具与生产接线核查

本机 `xcodebuild -version` 为 Xcode26.5 / 17F42；`xctrace version` 为16.0 / 17F42。当前公开 `record` 帮助没有扫描状态或记录选项查询参数；`export` 帮助提供 TOC/XPath。Apple 的 Xcode27 beta 发布说明介绍了新的 `--show-recording-options`，但本机未安装/验证该能力，也不能据此承诺能导出零扫描；本轮未升级 Xcode。

本机 Instruments 的公开 `Instruments.sdef` 只在标准文档接口上声明 name/modified/file，没有 Leaks 扫描结果接口。使用公开 `AXIsProcessTrusted()` 在沙箱内外分别进行只读检查，当前本地检查进程均未获辅助功能访问；没有触发授权 prompt、修改权限或打开 Instruments trace 窗口。该结果不表示其他已授权自动化进程均不可用。

代码核查：`leaks-detail.ts` 只接受验证过的逐分配阳性格式，runtime/published `MemoryLeaks` schema 的 status 均固定 detected，summary 也只格式化阳性。历史 `parseLeaksReport` 虽可解析文本 `0 leaks totaling 0 bytes`，但只是输入文本解析器，没有物理 iOS 自动采集来源，不能拿其单测作为生产零扫描证据。

参考：[Apple Finding Memory Leaks](https://developer.apple.com/library/archive/documentation/Performance/Conceptual/ManagingMemory/Articles/FindingLeaks.html) 描述定期扫描以及在详情中展示发现的泄漏；这是行为背景，不证明本次空详情对应扫描成功。[Xcode27 beta release notes](https://developer.apple.com/documentation/xcode-release-notes/xcode-27-release-notes) 仅作为新公开选项的调查线索，不改变当前工具链。

### 21.3 结论与下一步边界

结论为 **inconclusive：尚无可信零扫描样本**。按证据强弱仍保留三种解释：完成扫描且零发现、未完成有效扫描、公开导出范围未暴露扫描状态；三者尚不能区分。上述失败不能外推为所有自动化通道均不可行，不能补零、放宽 parser 或用内存下降代替泄漏结论。

已批准方案的证据前置条件尚未满足，因此本轮没有修改 parser、契约、生产采集或报告逻辑，不重跑既有3998项全库门禁。新增内容仅为调查留档；文档差异和任务JSON另行校验，不宣称新增 G5/G5-SIM 通过。

下一候选是本地 Instruments UI 自动化读取已保存 trace 的扫描状态：需先确认是否接受该新自动化依赖，并核实实际自动化进程权限；仅允许固定状态/时间/计数的确定性脱敏投影，原始 AX tree/截图不得进入模型。它是待评估通道，不是已证明的产品方案，也不要求用户每次手动导出。若能获得真实扫描完成与零发现证据，再明确可验证格式、目标/时间绑定及取消语义后接入批准的最小实现；否则维持 not_exportable。新录制和其他高风险动作仍需具体的一次性授权。


## 22. 已有 trace 的 Instruments UI 自动化调查（2026-09-08）

用户明确允许为本轮验证配置辅助功能访问。实际调用 Codex Computer Use 后，既有本地工具已能读取 System Settings 和 Instruments；无需新增系统授权。§21 的 AXIsProcessTrusted=false 仅针对独立 Swift 检查进程，不能用来判定 Codex Computer Use 不可用。本轮没有修改辅助功能列表或其他系统安全设置。

使用电脑操作工具自动启动 Instruments、关闭首次 What's New 提示，通过文件选择器分别打开 §10 的 control.trace 和 positive.trace，仅查看既有诊断。选择 Leaks 的 container 可切换详情，单击标题 text 未切换；Snapshots 按钮展开的是采样配置面板，不是历史扫描完成列表。下表为确定性脱敏投影：

| 检查 | 结果 | 证明范围 |
| --- | --- | --- |
| 释放对照 Leaks 详情 | 无分配诊断行，与公开 XML 空节点一致 | 不证明有效零扫描 |
| 释放对照快照配置 | Automatic Snapshotting=1，Snapshot Interval=10 | 仅证明界面配置，不能推断完成7次扫描或其他次数 |
| 阳性 Leaks 详情 | 可通过 AX 读取分配诊断行 | 与已有阳性一致；界面可能只暴露可见行，不拿 AX 行数替代20条完整 XML 结果 |
| 阳性 Snapshots 面板 | Automatic Snapshotting=1，Status=Idle | 当前空闲状态，不能用来证明过去扫描完成 |
| Leaks 详情菜单 | Leaks、Cycles & Roots、Call Tree | 已检查菜单未提供独立历史扫描完成列表 |
| Leak Checks 轨道 | 可访问标签存在；本轮 AX 树未暴露已完成扫描事件/时间/零发现记录 | 未获得可接入生产的零扫描证据，不等于证明图形时间线绝无此信息 |

打开 trace 后所有 AX 观察使用 emit:false，只把预定义标签、控件类型/索引及允许的状态/计数投影给模型；未输出原始诊断树、地址、栈或截图，未点击 Record 或 Snapshot Now。文件选择器只用于定位已知文件。一次快捷键导航未进入文件打开面板，关闭临时面板后改用实际 File > Open 菜单，未据此操作未知录制控件。

结束时放弃本轮未保存的文档/视图改动，关闭两份 trace；工具随后读取 app state 可能重新启动空白 Instruments，因此再次退出，并通过不激活 app 的应用清单核对清理。没有覆盖原始 trace、历史 canonical 结果或 baseline，没有启动手机工作负载、构建、签名、安装或新录制。

结论：**本地 UI 自动化访问可用，但本轮仍未取得机器可验证的历史零扫描证据**。不再把“需要新增辅助功能权限”列为当前阻塞，不要求用户重复授权同一访问。不得因空详情+自动快照配置+Idle拼接出not_detected；生产契约仍为detected-only，证据不足保持not_exportable。UI调查不是已完成的生产采集backend或G5/G5-SIM，不把Codex工具可操作界面等同于itestagent已经具备自动采集能力。

后续零结果接线仍以真实扫描完成证据为前提。当前公开CLI及本次AX可访问表面未满足该前提；若继续评估图形时间线，必须先设计本地确定性脱敏/状态提取与正负/未扫描对照，不能把原始截图传给模型、要求用户每轮手工导出或直接修改检测契约。T6.12保持in_progress，DEF-035保持open，T6.13不启动。本轮仅同步调查文档与任务记录，不运行或宣称新增生产代码全库门禁。


## 23. 性能等待职责与 DEF-035 修复（2026-09-08，用户确认实施）

批准范围：明确已确认性能观察/settling与业务等待的职责，保留用户原始目标和断言；修复全库G2扫描路径误报并证明真实违规仍被检出。原文约束为US-12.3 AC1“确认计划显示指标、观察时间及操作后等待区间”、AC3“不静默重复探索动作”及ADR-040“普通探索只执行确认的操作一次”。本轮不更改上述要求。

### 23.1 实现

- production-run-executor将确认计划中的minimumDurationMs/settleDurationMs和采集启动结果传入动作建议。`captureStatus=started`只表示采集工厂已经返回会话，不表示录制永不中断或导出覆盖必定完整；无工厂/启动失败为unavailable。TUI与engine默认模型适配器均转发该上下文。没有观察配置的旧计划保留原有提示。
- 动作提示说明采集器负责性能观察、settling和采样余量，模型只完成已确认业务操作及成功检查；明确保留业务等待，即使其秒数恰好与性能参数相同。采集不可用时不能用wait或重复操作替代缺失指标。一次格式纠正保留同一上下文。原始goal、TestPlan/result schema、动作契约与PermissionEngine不变，不按时长粗暴删除wait。
- 这是动作模型的职责提示，不是确定性禁止额外wait的保证。现有真实run中的70/10秒额外等待现象尚未由新真机实测复核；30秒采样余量、严格导出覆盖、失败/inconclusive和baseline门禁均保持。
- DEF-035：generic/all扫描先将collectFiles的绝对路径转换为repo-relative，再执行原有scenario排除规则，与changed模式一致。豁免目录未扩大；相邻scenarios-extra仍作为generic surface扫描。

### 23.2 回归与门禁

新增红测23 pass/4 fail：generic/all两项真实CLI误报、started/unavailable两项提示缺失。修复后定向59 pass/0 fail/364 assertions（3文件）：临时Git仓库验证generic/all/worktree/index、豁免目录、相邻目录和真实违规；动作提示验证原目标/20秒业务wait/70秒观察/10秒settling及格式纠正；生产执行器验证启动成功、finish期间取消、启动失败、未配置工厂时的上下文、owner顺序和canonical指标状态。CI设备/采集/模型传输为测试替身，不作G5证明。

真实仓库`bun run gate:g2`与`--scope all`通过，均扫描79文件；`--base HEAD --worktree --scope changed`通过（本批generic生产表面变更数0，违规检测由临时CLI仓库测试另证）。初次typecheck发现新增测试的两个可选字段期望值类型未收窄，已改为与生产接口一致的默认值，不更改业务行为；最终检查结果另附。

本轮未执行真实设备、构建/签名/安装或新采集，未改写历史run/baseline，未提交推送。DEF-035可按已验证修复关闭并保留审计条目；T6.12保持in_progress、T6.13不启动。有效零扫描、短工作负载G5、可复现多轮、Simulator/其他路线采集、TUI接受baseline和其余出口证据仍待完成。

最终门禁：typecheck、lint（889 files）通过；允许本地loopback/PTY的全库回归 **4006 pass / 7 existing skip / 0 fail，12320 assertions，368 files，99.54s**。未新增skip。日志 `/private/tmp/itestagent-t612-waits-{red,targeted,typecheck,lint,full}.log`。G2 generic/all通过（79文件）；任务JSON字段/状态及文档diff-check复核另行通过。

## 24. 等待职责修复后的短工作负载真机 G5（2026-09-08）

用户为本轮明确授权独立MemoryProbe构建、沿用既有Team签名、替换安装、准备WDA及一次阳性工作负载；未授权覆盖baseline或操作其他App。正常生产CLI从临时Xcode项目目录启动，经真实TUI候选确认、ready physical目标选择、TestPlan审阅及三个实际一次性permission checkpoint执行。PTY仅承担正常键盘输入；设备、模型、构建和采集均使用生产实现。目标prompt与§18–19一致：一次Run Leak Workload、20秒业务等待、标题/完成状态检查及截图，70秒观察、10秒settling。

| 核验 | 实际结果 |
| --- | --- |
| canonical run | `run_01a08345-914d-7000-bae0-bb3394627f9e` |
| run / case | passed / passed |
| 完整性 | 生产RunStore.loadRunBundle通过schema、跨文件引用及所有artifact哈希/大小验证 |
| canonical步骤 | launch 99ms；tap一次4327ms；wait一次，waitMs=20000、实际20004ms |
| 额外性能wait | 没有70秒或10秒UI wait，没有重复tap |
| 确认配置 | minimumDurationMs=70000、settleDurationMs=10000 |
| 实际采样 | 49个样本，首末跨度82168.982375ms；录制100003.296167ms；coverage=complete |
| 内存 | peak=47.813026428222656MiB；start=10.016128540039062MiB；end=47.813026428222656MiB；delta=37.796897888183594MiB |
| Leaks | detected，17个观测分配，4456448bytes（4.25MiB）；仅代表observed_allocations，不保证涵盖fixture的全部20个分配 |
| 指标/证据 | memory_peak、memory_growth、memory_leaks均collected；1份截图、1份trace |
| baseline | 自动比较已存在；growth差值-0.5625MiB、peak差值-0.546875MiB；前后均1个文件，文件名和SHA256不变 |

本次短工作负载没有依赖模型额外等待掩盖采样缺口：采集器按70秒+30秒有界余量录制约100秒，导出有效跨度82.169秒满足确认窗口。该单次G5支持§23提示接线和采样余量在此环境有效，不构成模型永不额外等待或30秒余量总能补足覆盖的保证。泄漏阳性数17与历史19/20不同，保留真实观测，不用fixture预设数量补齐。

原始PTY/Appium日志及本轮设备进程核验输出仅存本地`~/.itestagent/runs/memory-waits-tui-1788908546/artifacts/`；未输出原始UI tree、截图、诊断XML、个人签名或设备标识。模型仅收到固定标签、聚合数值和生成的run ID。canonical原始截图/trace保持raw-local-only，未改写历史报告或baseline。

清理：正常Ctrl+C退出TUI后，PTY driver与其专用Appium均exit0；已确认本轮driver/CLI/Appium进程不存在、4723监听关闭、xctrace进程数0，Appium日志显示DELETE session。退出后只读进程核验发现MemoryProbe仍运行，因此本轮验证清理显式终止唯一匹配的fixture进程，再次核验为0；不能把此手工收尾记为产品自动终止AUT的证明。应用安装和证据保留，未卸载或操作其他App。

本轮没有新增生产代码；沿用§23已通过的4006项回归，不重复运行全库测试。文档与任务JSON另行校验。T6.12保持in_progress、T6.13保持pending；DEF-035已在§23解决。有效零扫描、已确认资产多轮执行、Simulator/XCUITest新增采集、TUI接受新baseline及其余性能出口仍待完成，不能据此宣布整个T6.12完成。上述一次性真机授权已消费，后续新录制需具体授权。


## 25. 等待职责/G2与短工作负载证据提交（2026-09-08）

用户要求先提交推送。本次沿用分支docs/def034-physical-cancellation-evidence与OPEN的PR #82（base dev-1.0），提交§21–24的已批准代码、回归与脱敏证据；不创建新PR、不自动合并。DEF-035已修复并resolved，T6.12保持in_progress、T6.13保持pending。

重新运行typecheck、lint（889文件）通过；允许本地loopback/PTY的全库回归 **4006 pass / 7 existing skip / 0 fail，12320 assertions，368文件，112.14s**。G2 generic/all均通过（79文件）；固定版本gitleaks工具完整性校验通过。日志`/private/tmp/itestagent-t612-submit-{typecheck,lint,full}.log`；暂存树的秘密扫描、changed/index扫描与Git hook receipt在提交阶段继续核验并保存在Git目录。未增加skip，未新增真机操作或改变此前证据边界。
