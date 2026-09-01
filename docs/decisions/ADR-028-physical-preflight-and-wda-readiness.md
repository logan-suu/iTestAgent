# ADR-028：真机 App 前置链与 WDA 主动可用性契约

**状态**：Accepted
**日期**：2026-08-31
**决策者**：Logan Su + Codex（规格评审确认）
**关联任务**：T6.4
**关联条目**：DEF-031

> **2026-09-01 G5 Update**：同一台 iPhone 14 Plus 上，Route B 与 Route C 均完成 WDA active readiness、Appium session、UI tree、截图、Home 动作与清理验证。Route C 无独立 tunnel，清理边界更简单，选为 production default；Route B 保留为显式优化路线且不得静默 fallback。Route B 的交互式 xcodebuild 中断仍会触发系统授权提示，需由 subprocess controller 强制回收。DEF-031 已由“inventory fail-closed → active probe ready”的真机证据关闭。用户完成 Xcode Accounts 登录并自行释放免费开发者 App 名额后，IntegrationApp 也完成签名归一化、首次安装、inventory 复核与启动 G5。

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

### 方案 C：候选路线 + 主动可用性门禁（决策）

Route B 与 Route C 都保留为显式候选。T6.4 在当前真实 iPhone 环境中用同一套成功标准复验后，才选择生产默认路线并把证据写入 `docs/06-verification/`。在证据产生前，规格和生产组合不得把任一路线描述为当前唯一默认。

## 决策

### 1. WDA readiness 必须由主动探测证明

```
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
- 两条路线使用相同验收：WDA active probe、Appium session、UI tree、截图、动作、清理和 abort。
- T6.4 的 G5 报告必须记录环境、命令/配置、失败分类、资源所有权、证据路径和最终默认路线。没有该报告时，选择结果为 `inconclusive`，不得静默 fallback。

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
- T6.10 只验证 T6.4 已建立的门禁在完整 session/rerun/abort/redaction 链中不回归，不重复实现或关闭 DEF-031。

## 后果

### 正面

- 消除“已安装即 ready”的 R5 违规。
- 避免在证据不完整时固化 Route B 或 Route C。
- AppSource 从路径存在检查升级为可安装制品契约。
- R7 门禁在真机修改发生前落到明确边界。

### 负面

- T6.4 必须增加一次 Route B/Route C 当前环境对比 G5，不能只依赖历史报告。
- `.ipa` 需要受控解包和更多失败分类。
- 最终生产默认路线需在 T6.4 验证报告完成后再次同步 ADR/技术选型。

## 验证要求

1. 自动化契约测试覆盖 AppSource 优先级、`.ipa` 归一化、兼容性失败、R7 拒绝和 readiness fail-closed。
2. 真实 iPhone 分别验证 Route B、Route C；若某路线环境依赖缺失，报告必须标记 blocked/inconclusive。
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
