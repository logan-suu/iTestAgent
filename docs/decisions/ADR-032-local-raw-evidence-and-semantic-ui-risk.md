# ADR-032：本地原始证据、模型安全投影与语义 UI 风险边界

**状态**：Accepted

**日期**：2026-09-01

**决策者**：Logan Su + Codex（T6.6 PR #75 规格复审确认）

**关联任务**：T6.6、T6.10

## 背景

R6 要求账号、OTP、token 等敏感数据不落盘明文，数据流文档同时允许无法可靠自动脱敏的截图和视频作为 `raw-local-only` 本地证据。UI tree 也可能包含账号、消息、验证码或其他屏幕文本，但原文对本地定位、断言和审计具有价值。若把所有原始证据都视为禁止落盘，会破坏证据链；若直接把 UI tree 送入远程模型或写进报告，则会绕过 R6。

R7 要求高风险操作经过 PermissionEngine。仅按底层动词把所有 `tap`/`input` 视为低风险会漏掉删除、支付或授权等副作用；每次点击都询问又会使已确认 TestPlan 内的自动探索不可用。

## 方案比较

### 方案 A：禁止保存任何可能含敏感内容的设备证据

优点：持久化边界简单。

缺点：截图、视频和 UI tree 无法形成可审计证据；真机画面无法可靠自动脱敏；与 US-13.1 冲突。

### 方案 B：本地保存并允许按用户确认发送原文

优点：实现简单，模型获得完整上下文。

缺点：用户难以逐字段审计 UI tree；确认不能替代 secret 隔离；容易把 OTP/token 发送给模型。

### 方案 C：分离原始证据域与派生内容域（决策）

原始设备证据只在当前 run 的 artifacts 中保存并标记 `raw-local-only`；本地断言和审计可以读取。模型上下文、报告正文、导出和外部传输只能接收确定性脱敏后的派生内容。artifact-index、result 和 summary 可以引用本地路径与元数据，但不得嵌入原文。

### UI 风险方案：按语义副作用分类（决策）

已确认 TestPlan 范围内的普通导航和非敏感输入可以执行。删除、支付、账号、安全设置、授权变更以及语义不确定且可能产生敏感副作用的动作必须 fail-closed，并通过 PermissionEngine `ask`/`deny`。风险分类不能只看 `tap`/`input` 动词，也不能让模型自行宣布动作安全。

## 决策

1. 账号、密码、OTP、token、支付凭证等 secret 使用内存值或 SecretRef；RunStep、RecordingStep、Flow、错误、日志和报告只能记录引用或脱敏占位符。
2. screenshot、video、UI tree 等原始设备证据可以写入当前 run 的 artifacts，必须标记 `redactionStatus=raw-local-only`，并使用受限文件权限。
3. raw-local-only 原文不得进入 LLM/provider 请求、日志、报告正文、导出或外部传输。跨越该边界前必须生成 `redacted` 派生内容；模型输入不提供“用户确认后发送原文”的例外。
4. artifact-index、result 与 summary 可以保存本地引用、类型、哈希、大小、case/step 关系和脱敏状态，但不能嵌入 raw-local-only 内容。
5. UI 风险分类由 Engine 的确定性策略执行。普通导航、等待、截图和非敏感输入在已确认 TestPlan 内允许；明确或疑似产生删除、支付、账号、安全设置、授权变更等副作用的动作进入 PermissionEngine。
6. 目标语义不足以排除敏感副作用时不得静默归为低风险；应请求确认或返回结构化 blocked。模型建议只能作为待校验输入，不能绕过策略。
7. T6.6 修复模型边界、录制持久化和当前探索权限缺口；T6.10 继续完成全链路安全、abort 与 renderer 收口。不得用 T6.10 的后续任务掩盖当前 PR 已引入的直接泄露或绕过。

## 后果

### 正面

- 保留本地可审计证据，同时阻止原始设备内容进入远程模型。
- secret 与普通测试文本获得不同的持久化语义。
- 自动探索无需逐点击确认，高风险副作用仍由统一权限入口控制。

### 负面

- 需要维护模型安全 UI 投影和 secret reference 数据路径。
- 本地 artifacts 仍可能包含敏感界面，必须提供清理、权限限制与明确标注。
- 语义风险策略需要保守规则和持续测试，无法识别时会阻塞而非猜测。

## 验证要求

- 测试证明 raw UI tree 不会直接传给模型，模型只收到脱敏投影。
- 测试证明账号、OTP、token 等输入不会出现在 RunStep、RecordingStep、Flow、错误或报告对象中。
- 测试证明普通导航无需逐项 ask，删除/支付/账号/安全/授权及不确定敏感动作经过 PermissionEngine 或 blocked。
- artifact-index 只保留 raw-local-only 路径与元数据，不嵌入原始内容。
- G5/G5-SIM 只验证真实执行与证据链，不使用或记录真实凭证。

## 关联文档

- ADR-010：Agent Harness Runtime Boundary
- ADR-011：iOS Simulator First-class Support
- ADR-031：Run、Case、Step、Evidence 关联与自包含 Run 目录
- `docs/01-spec/全量用户故事与验收标准规格书.md`
- `docs/02-architecture/架构设计文档.md`
- `docs/02-architecture/数据流全链路技术说明文档.md`
