# ADR-028：真机 App 前置链与 WDA 主动可用性契约

**状态**：Accepted
**日期**：2026-08-31
**决策者**：Logan Su + Codex（规格评审确认）
**关联任务**：T6.4
**关联条目**：DEF-031、DEF-033

> **2026-09-04 T6.10 Update**：ADR-036 复审现有 G5 与 process ownership 后，将 Route B 定为 physical production default。Route B 从活动 WDA `/status` 观测 runtime identity，正常与 abort 清理均无残留；Route C 正常与 abort 后仍可见 Appium-owned `xcodebuild`，因此只保留为用户显式选择的诊断路线，不参与自动选择或静默 fallback，也不再阻塞 Route B 的 MVP 出口。Route C 无法证明本轮独立 Appium lifecycle 及其 child 完整回收时必须失败关闭并报告 cleanup limitation。DEF-031 已由“inventory fail-closed → active probe ready”的真机证据关闭；DEF-033 继续负责完整生产取消链和 Route C 限制的诚实呈现。

## 背景

ADR-012 在 2026-07-25 的 G5 Update 中把 Route C（Appium `managed-xcodebuild`）记录为免费账号默认路线，并把 Route B（iTestAgent 启动 WDA、`iproxy` 转发、Appium 通过 `webDriverAgentUrl` 连接）列为未来路线。

2026-08-28 的后续真机记录又表明 Route B 已成功完成 Appium session、UI tree、截图和 accessibility-id 查询；但仓库内 promotion G5 报告仍保留旧的 signing blocker，尚未形成一份可用于替换默认路线的当前对比证据。同时，生产组合存在不同默认值：部分入口默认 `managed-xcodebuild`，部分入口默认 `preinstalled`。

现有 `verifyPreinstalledWDA()` 只确认 WDA Runner App 存在。`devicectl` 当前输出不能证明免费账号 provisioning profile 尚未过期，因此“已安装”不能等价于“可用”，也不能据此宣称已精确探测 profile 过期。

App 来源契约也存在格式缺口：规格允许用户提供 `.app` 或 `.ipa`，而 `devicectl device install app` 的输入是 `.app` bundle。若接受 `.ipa`，必须先受控解包并定位 `Payload/*.app`，再执行与目标设备一致的验证。

## 方案比较

### 方案 A：继续固定 Route C 为默认

优点：沿用 2026-07-25 已记录的 G5 路线。

缺点：忽略 2026-08-28 Route B 新证据及生产默认值漂移；无法证明当前环境下仍是最佳路线。

### 方案 B：立即切换 Route B 为默认

优点：符合最新成功 recipe，WDA 进程和 tunnel 所有权更显式。

缺点：仓库内缺少一份替代旧结论的当前 Route B/Route C 对比报告；直接切换违反 R3/R4。

### 方案 C：候选路线 + 主动可用性门禁（初始决策，默认路线由 ADR-036 收口）

Route B 与 Route C 在 T6.4 中作为显式候选完成同设备复验。后续 identity/abort 证据证明 Route B 具备明确 owner 与无残留清理，Route C 仍受 Appium-owned child 限制；ADR-036 因此完成默认路线决策。

## 决策

### 1. WDA readiness 必须由主动探测证明

```text
installed != ready

ready = route-specific launch/session succeeds
     && WDA /status（或等价 WebDriver session probe）成功
     && target identity 与预期一致
```

- 不得仅凭 WDA Runner 出现在设备 App 清单中返回 ready。
- 不承诺从 `devicectl` 精确读取 provisioning profile 过期时间，除非新的 G5 证据证明该数据源稳定可用。
- 探测失败必须保留明确失败阶段：WDA 未安装、签名/配置不可用、launch 失败、tunnel 失败、`/status` 失败或 Appium session 失败。
- 失败后才能提出重签/重建/重装；操作完成后必须重新执行主动探测。

### 2. Route B / Route C 的选择必须证据化

- Route B：iTestAgent/WdaManager 拥有 WDA build/install/launch，拥有其启动的 `iproxy`，Appium 仅通过 `webDriverAgentUrl` 建立 WebDriver session。
- Route C：Appium 通过 `managed-xcodebuild` 和 `allowProvisioningDeviceRegistration` 管理每次 WDA 启动；iTestAgent 仍负责前置诊断、错误分类和用户确认。
- Route B 已凭主动 probe、Appium session、UI tree、截图、动作、identity 与 abort 无残留证据成为 physical production default。
- Route C 只作为用户显式选择的诊断路线，不进入 auto、不静默 fallback；无法证明本轮独立 Appium lifecycle 及 child 完整回收时必须失败关闭并记录 cleanup limitation。
- T6.4/T6.10 的 G5 报告必须记录环境、命令/配置、失败分类、资源所有权、证据路径与实际路线。Route C 的限制不再阻塞 Route B 的 production default 或 MVP 出口。

### 3. AppSource 必须归一化并验证

- 用户显式 `.app`：验证路径、bundle 结构、目标平台/架构、bundleId 和签名可用性。
- 用户显式 `.ipa`：在 iTestAgent 临时/产物目录受控解包，必须唯一解析到 `Payload/*.app`；失败时阻止安装并说明原因。
- workspace 已有产物：只使用与所选 targetKind、destination、scheme/configuration 相容且可追溯的产物；不能取“第一个找到的 `.app`”。
- 无可验证产物时才进入 `xcodebuild`，构建输出仍执行同一验证。
- physical 安装输入最终必须是已验证的 `.app` bundle。

### 4. R7 与安全边界

- 重签、重建 WDA、覆盖安装、重装或卸载任何设备 App 前必须获得明确确认。
- 免费账号三 App 上限不得触发自动卸载；必须列出候选影响并单独确认。
- Team ID、UDID、账号和签名细节只在内存与脱敏诊断中使用，不写入报告或日志明文。

### 5. 任务所有权

- T6.4 独占 AppSource、physical build/install/launch、WDA active readiness、自愈与 DEF-031 的实现和 G5 责任。
- T6.10 按 ADR-036 完成 DEF-033 的完整生产 abort、cleanup outcome 与 Route C 诊断限制，验证 Route B 默认及 T6.4 其他门禁在完整 session/rerun/redaction 链中不回归；不重复实现或关闭 DEF-031。

## 后果

### 正面

- 消除“已安装即 ready”的 R5 违规。
- 用明确 owner 与 abort 证据选择 Route B，避免 Route C 第三方 child ownership 阻塞可靠主线。
- AppSource 从路径存在检查升级为可安装制品契约。
- R7 门禁在真机修改发生前落到明确边界。

### 负面

- T6.4 必须增加一次 Route B/Route C 当前环境对比 G5，不能只依赖历史报告。
- `.ipa` 需要受控解包和更多失败分类。
- Route C 不再具备自动 fallback 地位；需要该诊断路线的用户必须承担额外环境限制并看到显式说明。

## 验证要求

1. 自动化契约测试覆盖 AppSource 优先级、`.ipa` 归一化、兼容性失败、R7 拒绝和 readiness fail-closed。
2. 真实 iPhone 必须验证 Route B production composition 的正常路径与 abort 清理；Route C 若执行，只作为独立诊断证据，环境依赖、child ownership 或 abort 缺口必须标记 partial/blocked/inconclusive。
3. 用可用 WDA 与不可用/过期 WDA 状态证明主动探测不会把“已安装但不可用”判为 ready。
4. 验证重签/重装后重新探测成功，并保留脱敏证据。
5. DEF-031 在实现、自动化测试和 G5 全部完成前保持 open。

## 关联文档

- ADR-006：Device backend Appium/WDA
- ADR-010：Agent Harness Runtime Boundary
- ADR-011：iOS Simulator First-Class Support
- ADR-012：WDA Lifecycle Separation
- ADR-023：Process Ownership Boundary
- `docs/06-verification/g5-spike-report-3.7.md`
- `docs/05-planning/deferred-items.json`：DEF-031
