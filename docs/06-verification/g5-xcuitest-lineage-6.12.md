# T6.12 正常 TUI XCUITest 与 failed-only 真机验收

日期：2026-09-17（本地）。状态：本批执行与重跑隔离通过；T6.12 仍 in_progress。

## 授权与入口

用户明确授权新一批构建、fixture/Runner 安装或替换、一次正常 TUI 父运行、CLI explain、一次 failed-only 子运行及所属进程清理。此前签名名额失败保留为失败证据，不重复使用旧授权。用户指定卸载 com.logansu.echo.wp2bench 后核验仅该 bundle 消失，WDA 与 Runner 保留。

本批使用既有临时 T612ExitFixture 工程、现有本地签名及同一 ready iPhone。正常无子命令 CLI/OpenTUI 经源码候选、设备选择和 TestPlan 审阅，明确 physical/xcuitest、scheme T612ExitFixture、target T612ExitFixtureUITests、metrics=[]、baseline=skip。父子运行分别经生产 execute_project_build 与 replace_device_app 一次授权。PTY 仅发送终端输入，未替换生产依赖或构造结果。

## 实际结果

| 项目 | 事实 |
| --- | --- |
| 父运行 | run_01a0b272-454d-7000-ac38-8155c35656e2，failed，16157ms |
| 父失败用例 | T612ExitFixtureUITests/ExitTests/testExpectedFailure，failed |
| 父控制用例 | T612ExitFixtureUITests/ExitTests/testUnselectedControl，passed |
| 失败依据 | 公开 xcresulttool summary 精确包含 fixture 固定 Intentional T6.12 acceptance failure 信息；签名名额错误已消除 |
| CLI explain | 正常退出，inconclusive/low；两个真实 step 证据引用。未匹配规则且无模型 fallback，不能声称根因归因成功 |
| 子运行 | run_01a0b274-6a95-7000-900e-ec7f8f8e9224，failed，9974ms |
| 子选择 | selectedCaseIds 仅 testExpectedFailure 的完整 Target/Class/Method；测试配置 target 保持不变 |
| 子实际执行 | 真实 xcresult 重解析只有一个指定失败用例，无控制用例；重复失败不标 flaky |
| 血缘与完整性 | 两份 production loadRunBundle 校验通过；plan/result parentRunId 一致；父 result.json SHA256 在 explain/子运行之后未变 |
| 清理 | 父子 CLI exit0；所属 xcodebuild 和设备 fixture/Runner 进程均0；安装及证据保留 |
| 时限 | 整批含核验约260秒，无超时取消或自动重试 |

## AC 与边界

US-7.1 当前正常入口到真实 xcresult/report 的真机证据已补齐；US-16.1 当前 failed-only 的权威标识、实际用例隔离与 canonical 血缘 G5 已补齐。故意失败是验收输入，不表示产品将失败误报为通过。CLI explain 的真实消费及不确定性表达已验证，US-14.1 的有效根因归类未由本批证明。原始设备证据仅保留在本地 run artifacts，审查输出为结构化状态/计数及固定消息匹配布尔值。

本批未请求性能采集，因此不能证明 XCUITest 新增内存、launch、crash、hitches/hangs。Simulator 多轮/baseline 仍受现有实现边界限制；physical 零扫描/memgraph 按 ADR-050 归 T7.8/DEF-037。本批不把 T6.12 标 done，不推进 T6.13，不 commit/push。

## 本地复核入口

- 默认 ~/.itestagent/runs 下上述两份完整 canonical bundle 与 raw-local-only xcresult。
- /private/tmp/itestagent-t612-xcuitest-batch-next/lineage-verification.json：完整性、实际用例及血缘断言。
- 同目录 parent-proof.json、review-confirmed.json、cleanup.json：固定失败匹配、计划和清理结果。
- /private/tmp/itestagent-t612-xcuitest-batch-child/screen.txt、exit2.json：脱敏 CLI 输入/结果与正常退出。
- /private/tmp/itestagent-t612-lineage-verify.ts：只读生产 loader 与真实 parser 校验程序。
