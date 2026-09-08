# T6.12 性能采集接线第一单元验证

**日期**：2026-09-08。**状态**：增量实现，性能 G5/G5-SIM 未执行，T6.12 保持 in_progress。

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
