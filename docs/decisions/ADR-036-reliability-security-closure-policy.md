# ADR-036：生产 TUI、权限记忆、真机路线与终止语义收口

**状态**：Accepted

**日期**：2026-09-04

**决策者**：Logan Su + Codex（T6.10 规格评审确认）

**关联任务**：T6.10

**关联条目**：DEF-025、DEF-029、DEF-033

## 背景

T6.10 启动评审发现现有文档存在四组不一致：

1. US-4.1 把产品验收绑定为 OpenTUI，但生产入口硬编码 ANSI；仓库已实现 Ink 与 renderer selector，ADR-008 仍写成 Ink 未实现，并保留基于 OpenTUI 0.4.3 的旧结论。
2. US-17.2 允许持久化 `always allow`，US-18.3 又要求所有高风险操作二次确认，两者无法同时成立。
3. ADR-010 定义了取消链，但用户故事没有锁定跨 XCUITest、DeviceBackend、parser 与子进程的可验收结果。
4. Route B 已通过正常与 abort 清理验证，Route C 仍遗留 Appium-owned `xcodebuild`；继续等待两条路线达到同等可靠性才选生产默认，会把 MVP 绑定到第三方进程所有权限制。

另有两个实现事实必须进入规范：Appium session 删除超时后原 Promise 仍可继续运行；Keychain 保存只有实际写入并验证访问控制后才能向用户报告成功。

## 方案比较

### 方案 A：保留框架、持久化 allow 与双路线同等门禁

优点：文档改动小。

缺点：产品 AC 依赖具体框架；持久化 allow 绕过 R7；Route C 的第三方 child ownership 阻塞 MVP；取消与清理仍不可测。

### 方案 B：固定 ANSI 或 Ink，删除 OpenTUI 方向

优点：可立即使用当前稳定实现。

缺点：在未复验当前 OpenTUI 版本前永久放弃目标主线，缺少证据；也无法解决权限、abort 与 teardown 契约。

### 方案 C：行为门禁、逐次高风险确认、Route B 默认与 terminal teardown（决策）

把产品 AC 改为真实 PTY 行为；OpenTUI 继续作为目标候选，只有通过当前版本门禁后才能成为生产默认。高风险 allow 不跨 session；Route B 成为 production default，Route C 只保留显式诊断；取消、清理和 Keychain 结果形成可测试契约。

## 决策

### 1. TUI 以行为而非框架名称验收

生产 renderer 必须在真实 PTY 中同时证明：

- 首帧显示 workspace、设备状态和输入区域；
- 键盘输入与提交可用；
- Agent/server 的异步流式更新可持续刷新；
- resize 后布局与输入仍可用；
- Ctrl-C、正常退出与错误退出均释放 raw mode、signal listener 和 renderer 资源。

用户显式配置优先，但显式 renderer 不可用时必须 fail-closed 并给出修复建议。自动选择只能选择已在当前 Bun/平台组合通过上述门禁的 renderer，并显示实际选择与原因。不得从显式 OpenTUI 静默切换到 Ink/ANSI。

T6.10 必须先在隔离 spike 中复验当前稳定 OpenTUI 版本，再决定其是否满足生产门禁。失败时 Ink 作为生产交互 renderer，ANSI 只用于 dumb terminal、非交互输出或明确配置；OpenTUI 保留为实验候选，等待后续版本复验。该结果写回 ADR-008 与验证报告，不能用 mocked renderer 测试替代真实 PTY 证据。

2026-09-06 的 T6.12 入口验收进一步确认：首次配置同样必须服从上述 selector，不得以“安全配置”为由把整个进程强制固定到 ANSI。当前 OpenTUI 首次配置路径必须在真实 PTY 中证明 UTF-8 输入/粘贴、API key 不回显和 clean exit；配置完成后继续沿用同一 renderer。安全性由专用掩码输入路径保证，而不是通过降低 renderer 获得；显式选择尚无安全首次配置路径的 renderer 必须 fail-closed。

同次验收还确认，候选链路与 TestPlan 审阅属于生产 renderer 门禁的一部分：多行标题、状态和命令区必须使用显式纵向布局，并禁止固定 header/footer 被滚动内容压缩，不能依赖 renderer 的默认方向与默认 shrink；Enter 必须分别产生候选确认与计划确认事件，`q` 必须明确表示取消，不能显示为完成。该行为必须通过真实 PTY 与字符帧覆盖，避免单元级 keymap 正确但输入组件未连接提交事件，也避免“有首帧字节”掩盖同一行覆盖。

T6.12 的 USB 接入复测进一步确认：Agent 自动设备探测与用户按 `r` 触发的探测必须串行提交，显式刷新在目标尚未 ready 时执行有界稳定性复查，避免 CoreDevice 的瞬态旧状态或较早请求覆盖较新结果。header 只绑定已选择且 ready 的当前 `targetKind`，新规划周期清除选择时必须撤销 connected。tool lifecycle 只允许以独立、短生命周期的 allowlist activity 展示；原始 tool result、ProjectProfile、设备 JSON 和 UDID 不得进入聊天 transcript，模型侧设备事实也必须使用目标范围内的脱敏摘要。

后续同轮复测确认，人机检查点与模型工具循环必须互斥：候选确认、设备选择、执行路线选择或 TestPlan 确认等待期间不得继续启动 AI SDK turn。设备确认必须刷新后针对具体 UDID 原子重验，失败时留在选择页；TestPlan 确认后必须直接续接 `executeTestPlan`，而不是返回聊天等待模型猜测下一步。内存内 TestPlan 编译不映射到 US-20 的 `generate_draft_test` 权限；执行阶段既有逐动作 R7 权限边界保持不变。真实 PTY 门禁还必须证明一次 Enter 只产生一次当前面板事件，面板切换后不能复用该按键确认下一页。

TestPlan 确认后的执行生命周期也属于生产门禁：确认后必须立即显示可见 activity，权限等待、执行、成功、失败和超时事件必须持续驱动消息区与状态区刷新，不能因聊天视图缓存旧消息数组而只留下“Starting execution”。pending ask 必须先注册再发布权限事件；异步消息与直接执行各自持有 operation-scoped event queue owner，迟到 cleanup 不得清除当前执行事件。权限正文可显示明确 action 与脱敏后的目标，但不得把设备 UDID 写入聊天 transcript。真实 PTY 回归必须覆盖“计划确认 → activity → 权限提示”的连续帧。

### 2. 高风险 allow 不持久化

- 高风险操作每次都以明确 `action/resource` 二次确认。
- `allow` 只对当前请求生效，不跨 session，也不通过 wildcard 绕过后续高风险确认。
- 用户可以明确持久化 `deny`；规则只写入全局 `~/.itestagent/config/itestagent.jsonc` 的 `permissions.deniedRules`，项目级配置不得声明 allow/deny 权限规则，TUI/CLI 必须提供查看和撤销入口。
- 已确认 TestPlan 内普通导航与非敏感输入继续允许，不因底层动词逐项询问。
- PermissionEngine 的 `remembered` 只有在持久化写入实际成功后才能为 true；纯内存规则不得描述为跨 session 持久化。
- 权限等待必须显示输入并回车的操作方式和实际等待时限；等待期间明确执行已暂停。`permission.requested.timeoutMs` 与 `permission.resolved.reason` 为向后兼容的可选事件字段。超时、取消与内部错误继续以 `effect=deny` 失败关闭，但不得展示为用户主动拒绝；这些终态必须清除等待 activity。权限失败的工具结果不携带原始 resource，避免 UDID 流入聊天或模型上下文；内部授权仍绑定精确 action/resource。直接执行因权限超时结束后，TUI 引导用户以 `/plan <test goal>` 重新规划并逐项授权，不自动重试或复用旧 allow。

权限事件契约必须拒绝 `reason=timeout/cancelled/error` 与 `effect=allow/ask` 的组合。发送权限请求事件失败时，必须消费已取消的 pending Promise 后再传播原始发送错误，避免未处理的 rejection 遗留。

### 3. Keychain 保存必须真实且可撤销

保存 secret 前必须单独披露 device-local 范围、service、account 和撤销命令，并获得一次性确认。secret 只能经 stdin 或等价非 argv 通道交给 Keychain。只有写入和访问控制验证成功后，UI 才能显示“已保存”；失败时 secret 保持 session-only 并显示失败原因，不得虚报 remembered。

T6.12 首次配置验收还发现，仅检查 API key 字符长度会让无效 credential 显示“配置完成”，直到第一条自然语言请求才暴露 provider 401。配置完成或 Keychain 写入前必须以当前 endpoint、credential 和 model 执行有界的最小 OpenAI-compatible 验证；401 清除 session credential 并返回掩码输入，其他错误按 model、余额、限流、provider 与网络分类。已有配置缺少对应 Keychain credential 时也进入同一恢复流程。provider 错误展示前必须移除其返回的明文或掩码 credential 片段。DeepSeek 新配置默认值更新为当前官方 `https://api.deepseek.com` 与 `deepseek-v4-flash`；已有显式 provider 配置仍按凭证绑定边界保留，不静默迁移。

同次永久保存复测证明，`security add-generic-password ... -w` 的裸 `-w` 会等待交互 prompt，并不从 pipe stdin 读取 password；把 secret 直接写入该子进程 stdin 会等待至超时。Keychain 写入因此改用 macOS `security -i` 的官方 stdin 批处理模式：argv 只有 `-i`，stdin 中只有一条 `add-generic-password ... -X <UTF-8 hex>` 命令，service/account 先限制为单命令安全标识。credential 原文和编码形式均不得进入可见输出、日志或结构化错误。独立写后属性验证仍是 remembered 的必要条件，任何命令失败、超时或验证失败均保持 session-only。

### 4. Abort 是端到端协议

物理 AUT 的 build、build-settings 查询与归一化校验同样属于此协议。每次命令前后检查同一 run signal，校验捕获异常时优先保留取消原因；不得在取消后继续设备副作用。生产准备命令先 SIGTERM，宽限 1 秒后升级 SIGKILL，并移除 listener/timer；真实 Xcode/设备链路的 owner 清理仍须 G5 复验。

```
TUI cancel → session command → AgentRuntime.abort → ToolDispatcher cancel
→ selected route → backend/build/parser AbortSignal
→ owner SIGTERM → grace timeout → SIGKILL
→ resource cleanup → partial evidence commit → cancelled terminal state
```

不变量：

- abort 幂等，且同一 run 只有一个 terminal event；
- pending permission ask 必须被取消；
- XCUITest 的 xcodebuild 与 xcresult parser、DeviceBackend 的探索动作和 Appium/WDA readiness 都接收同一取消信号；
- 每个 provider/backend/server 只回收自己拥有的进程，不跨 owner 接管；
- session 结束后无 pending tool、owned child、WDA tunnel 或占用端口；
- 已生成的证据仍进入索引；用户 abort 后 run 主状态保持 `cancelled`；
- cleanup 超时或残留必须形成独立的结构化 `cleanupOutcome`，不能吞掉错误或覆盖既有执行事实；只有非 abort 路径的 cleanup failure 才把 run 主状态设为 `infra_failed`。

### 5. Route B 是 physical production default

Route B（WdaManager + owned iproxy + Appium external URL）符合 ADR-012/023 的进程所有权，且已有同设备正常和 abort 无残留证据，因此设为真机生产默认。

Route C（Appium managed xcodebuild）仅为用户显式选择的诊断路线：

- 不参与自动选择或静默 fallback；
- 必须使用独立、可归属的 Appium lifecycle；
- 无法证明本轮 Appium 与其 child 完整回收时，结果必须失败关闭并报告 cleanup limitation；
- Route C 的第三方限制不再阻塞 Route B 的 production default 或 MVP 出口。

主动探测无法观测设备或 WDA 身份时按 `wda_status_failed` 报告身份不可验证，不得假装 ready，也不得说成已证实的身份不匹配；只有实际观测到与期望不符的身份才使用 `wda_identity_mismatch`。

Route B 的 production composition 必须区分两种输入：未提供外部 endpoint 时，由 iTestAgent/WdaManager 拥有 WDA 与 iproxy 的启动、readiness 和清理；用户显式提供 `webDriverAgentUrl` 时才进入 attach 模式。内部生成的 loopback URL 只是 managed Route B 的连接结果，不能作为“外部 WDA 已启动”的判据。

### 5.1 项目配置不得重定向全局凭证

`model.baseURL` 与 `apiKeyRef` 共同构成凭证绑定。项目配置属于 workspace 输入，不能仅凭配置层优先级把全局 Keychain 凭证发送到项目指定 endpoint。项目可以覆盖普通模型名称与非敏感运行选项；若要使用项目自定义 endpoint，必须提供本次 session 凭证或经过一次明确确认。provider URL 必须是 HTTPS，只有 loopback HTTP 可例外。

### 6. Session teardown 超时后实例终止

`deleteSession()` 超时不能被解释为删除完成。超时后：

- backend 与 driver 实例进入 terminal/non-reusable 状态；
- 后续操作和 `createSession()` 必须拒绝，调用方需要创建新实例；
- 原删除任务的迟到完成不能改变新实例状态；
- WDA/tunnel/Appium 等 owner 资源仍按固定顺序清理；
- 返回结构化 cleanup outcome，区分 deleted、already_closed、timed_out、failed 和 owned-process residue。

## 文档与任务所有权

- T6.10 负责实现本 ADR、修复或重分类 DEF-025/029/033，并完成自动化、真实 PTY、G5 与 G5-SIM 验证。
- ADR-023 继续定义 owner 边界；本 ADR 不允许为了修复 Route C 而按进程名扫描或终止其他 owner 的进程。
- ADR-032 继续定义 raw-local-only 与模型安全投影；本 ADR 增加全链路取消时的证据提交与 secret 清理要求。

## 验证要求

1. 真实 PTY renderer matrix 覆盖输入、流式更新、resize、退出和资源清理；OpenTUI 额外覆盖首次配置 UTF-8/掩码输入，以及候选链路和 TestPlan 审阅的 Enter 确认事件；记录 Bun、renderer、平台与终端环境。
2. 权限测试证明高风险 allow 不能跨请求或 session 绕过确认，持久化 deny 可加载和撤销。
3. Keychain 测试证明独立确认、非 argv 传递、成功后才 remembered，以及失败回退 session-only。
4. XCUITest、DeviceBackend、pending ask、WDA readiness 与 xcresult parser 的取消测试使用同一 AbortSignal，并检查唯一 terminal event、部分证据和 owned-child 清理。
5. session 删除 timeout 测试证明旧实例不可复用、迟到 Promise 不影响新实例，cleanup outcome 不虚报成功。
6. 真机 G5 使用 Route B production composition；Simulator G5-SIM 验证相同 abort、session 与脱敏语义。Route C 若验证，只作为显式诊断并单独报告限制。

## 后果

### 正面

- 产品验收不再被单一 renderer 框架绑死。
- R7 与权限记忆不再冲突。
- Route C 的第三方限制不阻塞可靠的 Route B 主线。
- abort、teardown、Keychain 与证据保存都有可测试结果。

### 负面

- OpenTUI 升级后仍需真实 PTY spike，不能只靠单元测试决定默认值。
- 高风险操作无法通过持久化 allow 减少确认次数。
- cleanup outcome 与 terminal backend 状态需要扩展接口和调用方处理。

## 关联文档

- ADR-008：TUI renderer 选型
- ADR-010：Agent Harness Runtime 边界
- ADR-012：WDA lifecycle separation
- ADR-023：Process Ownership Boundary
- ADR-028：physical preflight 与 WDA readiness
- ADR-032：本地原始证据与语义 UI 风险
- `docs/01-spec/全量用户故事与验收标准规格书.md`
- `docs/05-planning/deferred-items.json`
