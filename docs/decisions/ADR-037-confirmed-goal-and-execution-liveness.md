# ADR-037：确认目标、执行断言与前台活性反馈

**状态**：Accepted

**日期**：2026-09-07

**决策者**：Logan Su + Codex（T6.12 真机验收确认）

**关联任务**：T6.12

## 背景

T6.12 真机验收发现，自然语言中的具体操作和“确认某文本可见”在 S3 编译时被压缩为通用 `exploration`，已确认 TestPlan 只保留 feature 名称和 `explore_only`。生产动作模型因此只看到 `CASE: Validation`、UI tree 与历史步骤，不知道要点击 `Tap Me` 或以 `Taps: 1` 为成功条件；当模型重复 wait/screenshot 等动作时，执行循环只能依赖十二步上限。与此同时，OpenTUI 的 Activity 文本是静态的，长耗时操作无法向用户证明事件循环仍在工作。

这违反 TestPlan 作为 S3-S9 单一事实源、用户明确断言优先以及 US-4.2 AC2 流式展示执行进度的约束。

## 决策

1. `TestPlan.execution` 增加向后兼容的可选字段：
   - `goal`：经敏感信息脱敏、在 Plan Review 中展示并确认的用户执行目标；
   - `assertions`：从用户明确成功条件编译出的结构化 `UserAssertion[]`。
2. 新 writer 必须写入去除首尾空白后非空的 `goal`；DeviceBackend 执行旧计划时若缺少该字段或仅含空白，必须要求重新规划并确认，不得以 feature 名称猜测目标。
3. 中文“确认/验证/检查‘…’可见”和对应英文表达编译为 `source=user` 的 `element_visible` 条件，并把断言策略提升为 `user_goal_then_profile_then_agent_confirmed`。无法可靠结构化的文本保留在 `goal`，不得伪造断言。
   - 2026-09-08 经用户批准扩展：无引号形式只在独立句子或明确分隔符边界解析，支持中文“确认/验证/检查…可见/已显示”及英文“confirm/verify/check [that] … [is] visible”。目标长度上限120字符，否定、条件或复合目标保留为原 goal，不猜测目标；复杂标签仍可使用既有带引号形式。混合格式按原文顺序合并、去重，沿用敏感目标阻断和多 case 歧义保护。该有限语法不宣称理解任意自然语言。
   - Plan Review 的 Success Criteria 始终可见：存在显式条件则展示；DeviceBackend 没有显式条件时提示探索本身不能判 passed 或建立成功 baseline，并提供修改示例；XCUITest 明示结果来自所选原生测试，不误称只能探索。不会仅凭解析到条件就把执行标为成功，仍须真实观测满足条件。
   - 编译出的条件目标若命中现有确定性敏感信息规则，阻断编译并返回不含原文的错误；不得将脱敏占位符伪装成可执行条件。模型提示继续独立脱敏，不依赖 writer 已经处理。
   - 当前可见性 parser 没有可靠的多 case 归属能力；同时选择多个 feature 且存在显式可见性条件时，返回 `assertion_case_ambiguous`，引导按单个 feature 重新规划确认，不能把所有条件归到第一个 feature。无结构化条件的多 feature 探索仍保留原语义。
4. DeviceBackend 动作模型必须同时接收已确认 goal、当前 case 的成功条件、模型安全 UI tree 与历史步骤；原始设备证据仍遵循 ADR-032，不进入模型上下文。
5. 动态探索检测“UI 投影不变且同一建议动作重复”。连续两次无进展后在下一次动作前停止，产生 `no_progress`；达到步数上限产生 `step_limit`。无可判定断言时结果为 `inconclusive`，并在 TUI 与报告中显式说明，禁止静默循环。
6. OpenTUI 在存在 activity 时显示持续更新的单列宽 spinner；activity 完成、失败、取消或 renderer 销毁时必须清理 timer。spinner 只表达前台事件循环活性，不得被描述为底层设备动作成功。
7. 物理真机的 DeviceBackend 生产入口不得从权限确认直接跳到探索循环。进入第一次 UI tree 读取前，必须按 S5 顺序完成 AppSource 解析（用户指定 > 已有合法产物 > 目标显式的 `xcodebuild build`，仅缺少可用产物时构建）、真机 `.app` 的 bundleId/platform/arm64/签名校验、`devicectl` 安装与启动，以及所选 backend 的 readiness；选择 Appium 时必须完成 WDA 活跃会话探测。XCUITest 不适用此 Appium/WDA 前置。
8. `execute_project_build`、`replace_device_app` 与 `prepare_wda` 的一次性授权必须绑定同一份已确认 TestPlan、bundleId 与 UDID，并在相应副作用之前取得；生产组合缺少 physical preflight 时必须失败关闭，不能把测试替身或空实现当作成功。
9. AUT 首次 `launchApp` 失败是执行终止条件。失败步骤可以进入本地审计结果，但执行器不得继续读取界面或向动作模型请求建议；模型动作中的 `target`、`accessibilityId`、`label` 可作为等价的安全定位别名，三者均缺失的 tap/input 仍失败关闭。
10. 动作建议使用按 action 区分的严格 Zod 契约，并从同一契约生成模型提示中的 JSON schema。定位别名只能是顶层非空字符串；多个别名冲突、嵌套对象、额外字段或多个 JSON 对象均不得执行。格式不合法时最多请求一次纠正，只复用脱敏后的确认上下文与固定错误码，不回传被拒绝的模型正文，不猜测目标；纠正后仍需经过原有敏感动作授权。未知动作、provider 错误和取消不触发格式纠正。TUI 在纠正期间显示 activity，耗尽后清除 activity 并提示重新 `/plan` 确认。
11. 探索中途抛错或取消时，执行器携带已经记录的步骤与已经生成的 ArtifactRef 返回受控失败；dispatcher、cleanup 和 canonical bundle writer 不得把这些事实替换为零步骤结果。只保存既有证据，不为恢复异常额外操作设备，不为无效建议伪造动作步骤或成功断言。原始截图/UI checkpoint 仍为 `raw-local-only`；持久化前继续验证文件与 case/step 双向引用。基础设施错误为 `infra_failed`，取消为 `cancelled`；未完成的断言不能判 passed。

`itestagent.test-plan.v3` 不升版本：新增字段为可选，已有 v3 文件仍可读取；只有 DeviceBackend 的生产执行入口对缺少 goal 的旧计划失败关闭。该策略保留读取兼容性，同时阻止旧计划继续盲目探索。

## 后果

- Plan Review 能在执行前暴露真正的目标和成功条件，执行模型与断言评估使用同一确认事实。
- 重复无进展不再消耗完整步数预算，用户得到明确终止原因。
- OpenTUI 在后台等待模型、设备或证据处理时有持续可见反馈。
- 真机上可观察到构建、安装、启动和操作的实际顺序；某一步失败时，Activity 与终态停留在真实失败阶段，不再显示虚假的界面读取进度。
- 当前结构化解析只覆盖明确的可见性表达；其他自然语言断言仍需后续 parser 扩展或人工确认，不能静默推断。

## 验证要求

1. 使用 T6.12 原始中文 prompt 验证 goal、两条 user assertion 与 tiered policy。
2. 验证动作模型 prompt 包含 goal 和 success criteria，且敏感文本已脱敏。
3. 固定 UI tree 与重复动作验证 `no_progress`、`inconclusive` 和用户可见终止消息。
4. OpenTUI 字符帧在 activity 存续期间至少捕获两个不同 spinner 帧，activity 文本与设备标识脱敏边界保持不变。
5. 通过 typecheck、lint、全量测试；真机最终结果仍需 G5 人工验收，不以 mock 代替。
6. 生产组合测试验证 `build/resolve -> validate -> install -> launch -> WDA ready -> UI tree -> tap -> screenshot` 顺序，并验证 build、preflight 或 AUT launch 失败后不会触发 UI tree 读取。
7. 确定性模型替身覆盖合法/非法目标、一次纠正成功/耗尽、敏感动作拒绝与取消；真实临时 ArtifactStore 验证后续格式/provider/界面读取失败仍保留已有截图和 UI checkpoint。跨包组合验证正常 cleanup、failed cleanup 与抛错 cleanup 都不会丢失部分事实。自动化证据见 `docs/06-verification/exploration-action-recovery-report-6.12.md`，不替代双目标实测。

## 关联文档

- ADR-032：本地原始证据与模型安全投影
- ADR-036：生产 TUI、权限与终止语义
- `docs/02-architecture/数据流全链路技术说明文档.md` §6
- `docs/03-implementation/开发避坑与关键注意点手册.md` §4
