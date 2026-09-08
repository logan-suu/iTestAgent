# T6.12 动作格式纠正与失败证据保留回归

**日期**：2026-09-07

**任务状态**：in_progress
**性质**：经人类确认的阻塞修复与自动化验证；不是 G5/G5-SIM 通过报告。

## 现象与边界

用户确认计划并通过构建、App 替换与 WDA 授权后，出现 `exploration_suggestion_invalid`，提示 Validation 缺少有效定位目标。已确认 TestPlan 中的用户 goal 与可见性条件并未丢失。旧解析器在 tap/input 无有效顶层字符串 target/accessibilityId/label 时产生此错误；由于未保留模型原始响应，无法认定现场是哪一种非法 JSON 形状。

本次修复强化既有动作契约与异常事实保留，不更改 TestPlan schema 版本、不推断目标、不放宽断言或敏感动作授权、不修改 API key 或签名设置，不切换执行路径。

## 约束对齐

ADR-037 原文：

> 三者均缺失的 tap/input 仍失败关闭。

该约束保持不变：无效建议不能执行，仅允许模型基于同一脱敏上下文纠正一次。UI 原文与拒绝响应不重新进入模型；已记录步骤和既有 raw-local-only 文件经原有 canonical writer 校验与导入，不能因为后续异常被清空，也不能伪造无效步骤。

## 自动化证据

| 场景 | 测试与结果 |
|---|---|
| 严格动作 schema、合法顶层别名、对象型/缺失/冲突 target、多个 JSON 对象、非法字段 | `packages/itestagent-engine/test/exploration/action-suggestion.test.ts`，57 项通过、321 assertions；覆盖一次纠正成功与耗尽、取消/provider/未知动作不误重试、固定错误反馈与敏感上下文脱敏 |
| 已有 screenshot/UI checkpoint 后发生格式/provider/下一次 UI 读取异常 | `packages/itestagent-engine/test/exploration/real-run.test.ts`，21 项通过、139 assertions；使用真实临时 ArtifactStore 和合成数据，保留已记录步骤、实际文件、双向关联与 raw-local-only，快照不含原始 UI 内容 |
| 生产执行器、dispatcher、cleanup、RunWriter/报告闭环 | `tests/integration/phase6/phase6-exploration-suggestion-recovery.test.ts`，6 项通过、124 assertions；覆盖部分失败、一次纠正后仅执行一次 tap、cleanup 返回失败/抛异常、敏感动作拒绝、纠正时取消 |
| TUI 纠正进度及失败恢复提示 | `packages/itestagent-tui/test/agent-session.test.ts` 通过；检查进度发布、终态清除 activity、提交 run 提示与 `/plan` 重试指引 |
| 既有真实 PTY 与字符帧 | 全库回归中的首配、Review 确认、连续输入、权限与 Activity 场景通过；未新增设备运行时结论 |

全库门禁：

- `bun run typecheck`：通过。
- `bun run lint`：859 个文件检查通过。
- `bun test`：**3778 pass / 29 skip / 0 fail**，10196 assertions，353 个文件。
- `bun run gate:g7`：7 项脱敏契约测试通过；`git diff --check` 通过。
- 29 项跳过涉及现有本地 server/socket、Keychain 或特定权限环境用例；跳过不计为通过，也不替代环境验证。
- 首次全库复跑发现原成功路径的 artifact-index 测试仍只期待显式传入的一份引用；现在正确保留显式引用与实际采集引用共两份，已改为精确校验两者 ID，随后全库复跑通过。

本轮测试仅用确定性模型/设备传输替身与临时合成证据，没有向模型 API 发请求或操作真机/Simulator。

## 待实测

重启加载修复代码的 TUI，以原始目标创建并确认新计划，逐项处理权限。真机验收需直接证明：`T6.12 Device Lane` 可见、实际点击 `Tap Me`、`Taps: 1` 可见、截图落入本次 run，且报告与设备事实一致。共享探索路径的 Simulator 端到端验证同样仍待进行，不能由 mock 推定。

格式错误若连续两次出现，应显示明确失败和新计划入口；前面已经完成的动作与已有证据必须仍可查阅，不自动重新执行。Task 6.12 保持 in_progress，原有 DEF-034 AUT 准备阶段取消缺口保持 open；本次不实现已排期的 Task 6.13 签名向导。

## 追加修复：运行终态显示报告位置

2026-09-07 用户复测获得 passed 报告后，指出终端只有 `Execution completed` 和 run ID，没有报告位置。经确认，本次只补齐交付提示，不更改设备执行、断言或报告写入流程。

- 完成与错误出口共用位置提示，显示 `Report directory`、`Summary`、`Evidence directory` 三行，来自本次执行器返回的真实 `runDir`。失败、取消但已保存的报告同样可找到。
- 自定义路径中的中文、空格保留；相对 `ITESTAGENT_HOME` 可能导致 writer 返回相对路径，因此按同一进程工作目录转换为绝对路径，不以默认根目录猜测，也不误报未保存。
- 缺失/空/纯空白 runDir 不产生位置提示；下一次执行前清除旧引用，未保存时明确说明。没有提交结果的停滞分支不再声称 `Run result committed`。
- 原错误原因与重试指引保留，Activity 结束后清除；不自动打开报告、不上传证据、不把原始截图读入模型，也不把“执行结束”升级为“断言通过”。

自动化证据：

- `bun test packages/itestagent-tui/test/agent-session.test.ts`：39 pass / 0 fail，160 assertions，约 0.48 秒；其中新增 8 项覆盖三种已保存终态、自定义绝对/相对路径、缺失/空白路径与跨执行隔离。
- `bun test tests/integration/phase6/opentui-review-layout-frame.test.ts`：8 pass / 0 fail，71 assertions；新增 100×36 字符帧证明中文/空格路径、summary.md 与 artifacts 分行完整可见，完成后及 120ms 后均无陈旧 Activity，输入框可见。此结论仅覆盖测试视口，不承诺任意终端宽度都不换行。
- `bun run gate:g7`：7 pass / 0 fail，15 assertions，约 0.28 秒。
- 最终全库：typecheck、lint（859 文件）与 diff-check 通过；`bun test` 为 **3787 pass / 29 skip / 0 fail**，10259 assertions，353 文件，67.61 秒。跳过项仍为既有环境限制，不计入通过。

规格新增 US-15.1 AC8，S9 数据流与疑难排查同步说明位置交付行为；这是小范围交互补齐，没有新增架构决策或存储 schema。Task 6.12 保持 in_progress，DEF-034 仍 open。本轮未新增真机/Simulator 操作，也未提交或推送。

## 追加交互：启动 Logo 与可信 SUCCESS 标识

2026-09-07 经用户确认，补齐 US-4.1 AC7 与 US-15.1 AC9：

- 启动欢迎区采用五行终端 ASCII Logo，并保留精确大小写 `iTestAgent` 标题；首次配置也适用。窄屏或剩余高度不足时改为紧凑标题，OpenTUI 将紧凑标题合并到现有页头，不额外占据垂直空间；任务开始后收起欢迎区，不阻塞输入，不引入图片或依赖。
- OpenTUI/Ink/ANSI 共用展示规则，仅已提交报告的 `runStatus=passed` 系统消息显示绿色粗体 `SUCCESS`，位置在报告目录之前。错误、取消、未保存、未知状态、`flaky` 及其他非 passed 不显示；用户或模型文本中的同名单词不触发成功样式。
- 状态从 `persistConfirmedRun` 成功完成 canonical writer 提交后返回，读取最终 `report.status`，涵盖 cleanup、取消和 rerun/flaky 归类。两条执行路径及提前阻断出口均透传状态；不更改保存协议或落盘 schema。TUI 还校验执行输出为 completed 且当前操作未取消，防御矛盾或迟到的 passed 响应，completed 自身不代表 passed。
- 目视检查发现 30 行首次配置界面中，较长 Keychain 说明会挤压静态标题。最小布局修复为文案、输入框及退出提示设置不可压缩，并将紧凑 Logo 移到页头；不改变隐藏输入、凭证校验或存储授权流程。回归增加标题/副标题相邻且完整、输入与退出提示可见的断言。

验证覆盖：

- `packages/itestagent-engine/test/committed-run-status.test.ts`：17 项 / 43 assertions，使用真实临时 RunStore/RunWriter 校验返回状态与 `result.json` 一致；覆盖 DeviceBackend 与 XCUITest、失败、取消、cleanup、flaky、保存失败和提前阻断。
- `packages/itestagent-tui/test/agent-session.test.ts` 与 `run-outcome-presentation.test.ts`：67 项 / 217 assertions，覆盖九种 canonical 状态、缺失/非法状态、矛盾执行状态、取消、无报告与跨运行隔离，普通用户/模型文字不能生成可信标识。
- OpenTUI 字符帧覆盖 100×40 → 60×24 → 100×40 的欢迎区 resize、输入后隐藏、首配 100×40 → 100×30、30 行 Keychain 说明；成功帧校验实际字符颜色属性与报告目录前后关系，非成功帧不标绿。Ink 实际渲染覆盖颜色、报告顺序、非可信文本及 resize listener 清理；ANSI 与共享品牌规则有单元回归。

该变化仅涉及终端交互与已提交结果的返回元数据。没有重新执行真机/Simulator 测试或向模型 API 发请求，没有修改 API key、Team、签名或权限策略。Task 6.12 继续 in_progress；既有 G5/G5-SIM 出口与 DEF-034 仍按原范围追踪。

验证过程还发现既有 PTY 脚本在固定读取 1.5 秒后直接发送按键，环境启动延迟时首帧尚未到达；Ink 也可能已绘制文字但尚未启用输入。两份脚本改为最多 5 秒等待 renderer 标记、实际首帧和 raw/non-echo 输入模式同时就绪，并输出启动耗时用于诊断。OpenTUI 仍要求超过 1000 字节的实际首帧；既有精确输入、resize、缓冲区保留、确认次数和 clean-exit 断言均保留，外层测试截止时间未增加。修正后两项真实 PTY 门禁单独复跑为 2 pass / 37 assertions / 0 fail。

最终串行全库回归：**3841 pass / 29 skip / 0 fail**，10446 assertions，356 个文件，62.22 秒；包括修复后的短屏配置、真实 PTY 与三种 renderer 展示回归。29 项为既有本地 server/socket、Keychain 等环境限制，未新增跳过，不计入通过。typecheck、lint（863 文件）、G7（7 pass / 15 assertions）及 diff-check 通过。初次回归的 3 项失败分别对应已修复的短屏文案重叠和上述 2 项 PTY 输入时序，不以重试掩盖未修复失败。

## 追加样式修订：统一块状字标

用户在上一版展示后确认新的外观要求：参考开源终端工具的紧凑块状字标语言，`T` 与 `A` 比小写主体高一行，移除下方重复的小号 `iTestAgent`，并让 `SUCCESS` 使用相同风格。该修订替代上节的五行 ASCII 加小标题方案，不改变成功判定或执行流程。

- 共用四行固定单元宽度的 `█`、`▀`、`▄` 字形，启动字标保留 `iTestAgent` 大小写层次与共同基线；OpenTUI/Ink/ANSI 大字标使用同一淡青色。没有引入图片、字体下载或第三方依赖。
- 大字标不附加小标题；Ink/ANSI 的已有页头在大字标显示期间只保留版本与 workspace。紧凑态仍能识别产品名称，不影响原来的首次配置和任务开始后收起行为。
- 可信 passed 系统消息在报告路径前显示绿色四行 `SUCCESS`，宽度不足、终端少于 28 行或扣除当前聊天内容后空间不足时切为单行 `SUCCESS`，窗口恢复后重新显示大字标。预算使用实际终端字符宽度，计入长路径/中文换行及同一画面所有成功字标，优先保留输入与报告内容。未知、失败、取消及非系统消息均不产生成功字标；判断仍完全沿用已提交 canonical 状态。
- 本轮仅改展示 helper、三种 renderer、对应回归与文档。没有调用模型 API、操作设备、修改凭证/Team/签名或变更落盘 schema；不替代 T6.12 原有 G5/G5-SIM 验收，DEF-034 与 T6.13 状态不变。

增量验证发现 100×28 终端中的长报告路径会因四行字标而延伸到输入框边框；加入全会话内容高度预算后，新增原生 OpenTUI 帧证明该视口自动采用单行成功提示，全部路径（包括末尾 `/artifacts`）位于输入框上边框之前，100×50 恢复大字标。共享 helper 覆盖历史消息、中文字符宽度及多份已保存报告；Ink/ANSI 的 100×36 压力回归确保三种 renderer 均传入完整会话，而非只计算当前消息。聚焦结果：共享 helper 10 pass / 52 assertions，OpenTUI 字符帧 13 pass / 348 assertions，Ink/ANSI 42 pass / 168 assertions。

最终串行全库回归：**3854 pass / 29 既有 skip / 0 fail**，10781 assertions，356 文件，64.14 秒；typecheck、lint（863 文件）、G7（7 pass / 15 assertions）与 diff-check 通过。首轮全库有一项既有 Review PTY 测试在 15 秒聚合截止时间触发超时，没有具体场景断言失败；代码核对确认其五个场景串行执行且首帧等待不依赖 Logo 内容。未放宽该测试的断言或截止时间，最终串行运行该项在 8.98 秒通过。首次超时的具体耗时阶段无足够日志确认，不把合理的负载解释当作已证实根因。本轮检查未新增跳过项、提交或推送。

## 追加验证：同页分组与显式设备类型切换（ADR-038）

- 修复范围：三个 renderer 使用同一 physical/simulator 分组顺序；OpenTUI 固定区显示数量、当前类型及独立切换提示，长列表选中项滚入视口。按 Enter 选择其他类型只请求确认，`y` 同意、`n` 保留原草案。
- 生产 facade 的一次性确认绑定精确目标、规划实例和草案快照，确认后经串行 discovery 重查 ready，再由 PlanningSession 重编译目标相关配置。原 goal/sourceText、显式 assertions、已确认候选和 run identity 保留，baselineDomain 与执行路由重新计算；返回 TestPlan 审阅，未直接执行。
- 自动化覆盖：双向切换、拒绝、token 重放/刷新失效、新规划、并发刷新、设备失踪/未启动、无效转换原子性、confirmed/cancelled 终态；共享顺序/reducer/keymap/ANSI 输出；原生 OpenTUI 分组/确认/长列表与 Ink 分组字符帧。聚焦最初 87 pass / 324 assertions，OpenTUI 15 pass / 357 assertions；随后增加的原子性/终态与 Ink 断言包含在最终全库结果。
- 本机只读生产 discovery：两通道 status=ok，无 issues；physical 1 条、ready 0；simulator 35 条、ready 2。沙箱内系统服务调用受限，改用获准的沙箱外只读查询后成功。未输出 UDID、未 boot/安装/重签/执行测试。该证据只覆盖发现与分组输入，不替代 G5/G5-SIM 执行验收。
- 首轮全库为 3865 pass / 29 skip / 1 fail：既有 `opentui-first-run-setup-pty.test.ts` 的假密钥 `secretNotRendered` 检查为 false；单独复跑同一测试通过，最终全库也通过。检查发现该 harness 固定等待 1.5 秒后粘贴，但此次无足够时序证据确认是否为初始化竞争；根因标记 inconclusive，不将其视为已修复或删减安全断言。
- 最终全库：**3867 pass / 29 既有 skip / 0 fail**，10862 assertions，357 文件，70.38 秒。日志：`/tmp/itestagent-target-switch-full-final.log`；首轮和单独复核分别为 `/tmp/itestagent-target-switch-full.log`、`/tmp/itestagent-target-switch-setup-recheck.log`。没有新增 skip 或放宽截止时间。
- 文档已同步到规格、架构、数据流、避坑、开发计划、task-status 与 ADR-038；T6.12 仍 in_progress，T6.13 和 DEF-034 状态不变。未提交、推送或合并 PR。
- 最终 typecheck、lint（864 文件）、G7（7 pass / 15 assertions）与 diff-check 全部通过；任务依赖扫描未发现需要级联更新的 pending 项。

## 追加验证：统一列表方向键（US-4.1 AC8）

- 用户确认后统一设备、候选链路、TestPlan、断言建议四类选择列表的 ↑/↓ 与 Enter，并保留 j/k。候选 Space 切换勾选；断言 Space 采纳当前项、n 拒绝，Enter 结束审阅不自动采纳剩余项；Esc 使用原有取消/返回语义。录制步骤是只读历史，不新增可选择的执行动作。
- 三个 renderer 共用既有事件映射；OpenTUI 原生按键消费后阻止输入框重复提交，候选/计划高亮改为响应式，四类列表自动滚入选中项。ANSI 复用 Node 按键解码处理分片 CSI/SS3，避免方向键尾部 A 误触发全选；Ink/ANSI 文本列表视窗跟随高亮。编辑期间光标键不触发列表导航，跨类型切换待确认时重复 Enter 不授权，Esc 拒绝此次切换。
- 聚焦验证：TUI 包 **596 pass / 1552 assertions**；OpenTUI 原生字符帧 **20 pass / 383 assertions**，含 20 项长列表、实际按键事件计数和名称中间插入字符；三个 renderer 真实 PTY **3 pass / 33 assertions**，各验证设备/候选/计划的上下导航及单次 Enter。日志分别为 `/tmp/itestagent-arrow-unit.log`、`/tmp/itestagent-arrow-native.log`、`/tmp/itestagent-arrow-pty.log`。
- 首轮全库：3879 pass / 29 skip / 6 fail / 4 errors，359 文件、168.29 秒。五项终端检查超时（其中一项为新增断言方向键帧），四项后续 errors 来自超时后被测试框架终止的字符帧子进程；另有既有首配假密钥不回显检查失败。原样单独复跑三个相关文件为 21 pass / 1 fail，剩余首配失败可复现；其他终端超时的具体原因未确认，不把负载推测当作根因，也未放宽超时或断言。
- 首配诊断记录证明：固定等待 1.5 秒结束时 `initialBytes=0`、`echoAtPaste=true`、`canonicalAtPaste=true`，粘贴后才进入 raw/no-echo，且提交前假密钥已被终端回显。该复现定位到测试脚本过早粘贴，而非遮罩输入提交后的回显。脚本改为复用现有有界首帧/原始输入就绪探测，未就绪不粘贴；保留不回显、精确输入、提交和 clean-exit 断言及外层截止时间。修正后单独复跑 1 pass / 2 assertions，见 `/tmp/itestagent-arrow-setup-fixed.log`。这定位了本轮可复现失败，不反推此前缺少时序证据的失败一定同因。
- 同步规格、架构、开发计划和 task-status；不调用模型 API、操作设备、修改凭证/Team/签名，也不改变 G5/G5-SIM、DEF-034 或 T6.13 范围。未提交、推送或合并。
- 最终完整回归：**3885 pass / 29 既有 skip / 0 fail**，10961 assertions，359 文件、116.45 秒，日志 `/tmp/itestagent-arrow-full-final.log`。本轮未增加跳过项或放宽测试截止时间；首轮与复查失败记录分别保留在 `/tmp/itestagent-arrow-full.log`、`/tmp/itestagent-arrow-recheck.log`。typecheck、lint（869 文件）、G7（7 pass / 15 assertions）与 diff-check 通过；依赖扫描无待级联更新任务。新测试文件为 `packages/itestagent-tui/test/review-keyboard.test.ts` 和 `tests/integration/phase6/review-arrow-pty.test.ts`，扩展原生帧测试及首配启动就绪回归。

## 追加验证：聊天历史越界与独立滚动（US-4.2 AC5）

- 用户截图显示系统消息、SUCCESS 和报告路径越过消息区域并覆盖输入框。修复前通过原生 OpenTUI 80×24 字符帧最小复现：40 条系统消息仍从第 1 条向下绘制，第 11～13 条进入输入框区域，第 40 条不可见。
- 根因：MessageList 是无滚动视口的普通 Box，内容按自然高度继续绘制，没有与不可压缩输入框隔离的裁剪边界。根布局现在限定终端宽高；聊天历史改为 `flexBasis=0/minHeight=0` 的可收缩 ScrollBox，状态栏与输入框维持固定区域。用户/系统/Agent 消息、SUCCESS 和报告路径都进入同一消息视口；不隐藏历史来掩盖越界。
- 复用 OpenTUI 原生 sticky scroll：底部跟随追加与现有消息流式增长，上翻后不抢回阅读位置，回到底部后恢复跟随。原生滚轮与 PageUp/PageDown 支持翻阅，输入内容/提交事件不受影响；不新增自制滚动定时器或后台任务，不改变消息、权限或报告语义。
- 新增 `tests/integration/phase6/opentui-chat-scroll.test.ts` 及独立原生 renderer harness。覆盖短消息无滚动条、40 条混合/中文换行消息、流式增长、滚轮与翻页、阅读时追加与缩放、恢复底部、活动结束、可信 SUCCESS/完整报告路径、100×36 → 45×24 → 100×36 和输入草稿保留。逐帧验证消息不进入状态栏或输入区域，滚动范围/滚动条由实际 ScrollBox 状态读取。聚焦 **1 pass / 82 assertions**，日志 `/tmp/itestagent-chat-scroll-focused.log`。
- 现有 OpenTUI 选择页、Logo、首配、状态与报告帧联合初检 **21 pass / 444 assertions**（新增阅读中 resize 断言之前），TUI 包 **596 pass / 1552 assertions**；日志 `/tmp/itestagent-chat-scroll-frames.log`、`/tmp/itestagent-chat-scroll-unit.log`。真实终端交互与其他累计回归纳入最终全库检查。
- 规格 US-4.2、架构交互层和 T6.12 开发计划同步。范围仅为 OpenTUI 展示，未调用模型 API、操作真机/Simulator、改动凭证或签名；不代替 G5/G5-SIM，DEF-034 与 T6.13 保持原状。没有提交、推送或合并。
- 最终完整回归：**3886 pass / 29 既有 skip / 0 fail**，11043 assertions，360 文件、115.81 秒，日志 `/tmp/itestagent-chat-scroll-full.log`。没有新增 skip 或放宽截止时间。typecheck、lint（871 文件）、G7（7 pass / 15 assertions）与 diff-check 通过。Task 6.12 保持 in_progress，未发现需要级联更新的 pending 任务。

## 追加验证：成功字标顺序与滚动视口尺寸（US-15.1 AC9）

- 用户确认调整为 Execution completed → SUCCESS → 报告/证据目录。根因是 renderer 原先把成功字标放在整条完成消息之前，而尺寸助手仍按完整聊天历史计算高度；独立滚动区加入后，历史增长仍会错误地把大字标压成单行。
- 三个 renderer 共用可信成功消息的首行/详情拆分，普通多行消息保持原样，结构化 passed 门禁不变。OpenTUI 从实际 ScrollBox viewport 宽高选择已有四行绿色块状字标，上下各留一行空白；不以累计历史或长路径作为缩小理由。窄/矮视口保留单行模式，路径较长时通过原生滚动查看；Ink/ANSI 只同步顺序，保留非滚动布局的历史高度预算。
- 原生布局复查发现直接设置 viewport 的 onSizeChange 会覆盖 ScrollBox 的内置滚动条更新；最终改为订阅实际布局 `resize` 事件并在组件退出时解除，不替换底座回调。测试继续要求短消息无滚动条、底部跟随、手动阅读位置保持和输入草稿隔离。
- 增补可信消息拆分、窄/矮尺寸边界、长聊天仍显示大字标、完成提示/字标/路径顺序与空白、长路径滚动可读、resize 恢复及非通过状态回归。TUI 单元 **598 pass / 1566 assertions**，串行原生 OpenTUI/Ink **22 pass / 608 assertions**；typecheck、lint（871 文件）、G7（7 pass / 15 assertions）通过。日志：`/tmp/itestagent-success-unit.log`、`/tmp/itestagent-success-frames-serial.log`、`/tmp/itestagent-success-typecheck-final.log`、`/tmp/itestagent-success-lint.log`、`/tmp/itestagent-success-g7.log`。
- 首轮最终原生组合检查有 3 个既有场景触发原 5 秒进程超时（target-switch、device-scroll、activity）；静态检查结束后的串行复跑全部通过。具体超时根因未确认，未据此修改产品行为或放宽断言/截止时间；失败日志保留于 `/tmp/itestagent-success-frames-final.log`。
- 同步规格、架构、S9 数据流说明和开发计划；只改变展示，不修改消息 schema、报告状态、权限或设备执行。未调用模型 API、操作真机/Simulator、修改凭证或签名；未提交、推送或合并。T6.12 保持 in_progress，T6.13 与 DEF-034 保持原状，不替代 G5/G5-SIM。
- 最终完整回归：**3888 pass / 29 既有 skip / 0 fail**，11142 assertions，360 文件、86.22 秒，日志 `/tmp/itestagent-success-full.log`。无新增 skip，无放宽超时或断言；Task 6.12 保持 in_progress，依赖扫描无待级联更新任务。
