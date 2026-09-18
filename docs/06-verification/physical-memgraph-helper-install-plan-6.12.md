# T6.12 独立 helper 固定安装与授权前置计划

## A3 诊断推进：App 包启动已获得只读访问（2026-09-09）

同一已授权固定二进制经公开 App 启动方式运行，返回 eligible/xcode_not_running、targetVerified=false、Xcode 26.5；退出码 0、stderr 空、helperRemaining=0、哈希不变。未扩大父应用权限、重签或改设备。结果支持启动方式影响权限归属，但未观察 TCC 内部链，不能排除时间因素。

下一步按 physical-memgraph-launch-plan-6.12.md 的 A4 修复候选做 App 启动 transport 和 owner/取消，不能简单用 open -W 替代可控子进程。A4 待确认，现有固定包不覆盖，暂存新版与无 AX 的专用宿主 fixture 先验证生命周期，再审阅升级。无需重复要求开启同一开关。

## A3 辅助功能授权后的复检（2026-09-09）

用户明确允许为固定版本 helper 启用辅助功能，并自行完成系统 Touch ID 验证。Agent 经公开 System Settings 文件选择器选中固定 iTestAgentMemoryHelper.app，添加后观察到 iTestAgentMemoryHelper_Toggle=on。其他 App 开关未修改。

随即从固定安装目录执行一次独立只读 preflight：仍为 blocked/accessibility_unavailable、targetVerified=false、Xcode 26.5。只读检查确认同一非 root 有效用户、二进制哈希未变、系统签名校验通过。不能以设置开关开启代替 AXIsProcessTrusted 实际返回，也不能声称已获得运行时访问。

尚待区分启动归属/运行环境、系统权限传播或 bundle 识别问题；当前证据不足以确认根因。没有重新编译/重签/安装，没有重置 TCC 数据、扩大 Codex/Terminal 权限或操作设备。下一步应制定固定 bundle 启动与权限归属的最小诊断，不能重新要求同一系统开关授权或自动进入 capture B。本次只读复检已执行，未宣称生产 G5。

## A2 固定安装完成（2026-09-09）

用户确认 A2 后已实现内部 installer/resolver 与 7 项新测试。固定安装位于 ~/.itestagent/helpers/xcode-memory/iTestAgentMemoryHelper.app，bundle ID=com.itestagent.memory-helper；ad-hoc 签名校验通过，二进制 SHA256=4b7f416dd2c0d7ff4f2809ca6c6f073ad0d2abf87767f39d829eae4798f72520。独立调用第一次 installed、第二次 reused，install.json 未变；随后从校验后的固定 bundle 执行只读 preflight 返回 accessibility_unavailable、targetVerified=false、Xcode 26.5。未请求系统授权、未启动 Xcode、未操作设备。

首次调查发现 swiftc 输出带 driver 前缀，随后还发现直接调用编译器需要明确 SDK；均在发布前停止，目标目录未创建。已支持真实版本输出并显式使用选定 Xcode 的 macOS SDK，回归覆盖工具链/SDK绑定。没有覆盖或重装已完成的 bundle。

安装使用独占目录预留与最后写入清单；存在未知/不完整目录时阻断，不覆盖。发布失败可能保留不完整目标，不能自动删除。resolver 校验当前源码/plist摘要、完整文件清单及系统签名，拒绝链接与篡改；ad-hoc 是开发期身份/完整性机制，不宣称可信发行或防御同用户恶意进程。工具目录位于既有唯一本地持久化根，暂存清理仅限本次 owner。

最终 typecheck 通过；lint 917 文件通过；性能包正常宿主 214 tests/1311 assertions 全过（A2 新增 7 项）。未 commit/push。T6.12 in_progress，生产 capture/TUI G5 尚未完成。下一步仅可针对上述固定版本另行申请辅助功能授权并只读复检；不自动给父应用扩权、不重跑旧设备对照。

状态：用户已确认，A2 实现与首次安装/复用验证完成；系统辅助功能授权尚未授予。2026-09-09，接续 ADR-044 第一单元。

## 已核实的前提

第一单元的独立 helper 已编译与回归，宿主返回 accessibility_unavailable。只读 codesign 检查临时产物：ad-hoc 签名，存在 designated requirement，包含 cdhash；没有读取私钥或使用签名证书。固定路径不等于重新编译后的身份连续性。

Apple TN3127 说明隐私资源身份与 designated requirement 有关，开发签名和发行签名可能不同。公开 AXIsProcessTrustedWithOptions 文档及本机 SDK 说明 prompt 是异步提示，不会改变该次返回值。因此不能以“已弹授权框”当作已授信。

- https://developer.apple.com/documentation/technotes/tn3127-inside-code-signing-requirements
- https://developer.apple.com/documentation/applicationservices/1459186-axisprocesstrustedwithoptions

规格约束：“不得要求用户手动操作 Xcode/Instruments、导出内存图或搬运文件来完成每次测试”；首次必要环境配置及逐动作授权仍须清晰分离。稳定权限方案不是自动同意系统权限，也不能承诺永不失效。

## 推荐的下一实施单元 A2

开发验证采用固定 app bundle，不引入 Developer ID 账号、证书或新第三方依赖。标识 `com.itestagent.memory-helper`，显示名称 `iTestAgent Memory Helper`，唯一可执行文件沿用只读 Swift helper。

安装目标：`~/.itestagent/helpers/xcode-memory/iTestAgentMemoryHelper.app`；这是既有唯一本地持久化根中的新增工具目录，不是项目配置字段。编译缓存与暂存同属 helpers 下的受控子目录；运行证据继续写 runs artifacts。初版不是发行承诺，Developer ID/公证/跨版本权限持续性另外评估。

拟改文件：

- performance-xctrace-analyzer 包新增内部 `src/xcode-memory-helper-install.ts`：显式根目录、选定 Xcode 工具链输入；构建最小 app bundle、Info.plist、helper；使用系统工具进行 ad-hoc 签名和验证；产物清单含 schemaVersion、bundle ID、协议版本、源码/二进制摘要及工具链版本。任何输出仅固定错误码及本地引用。
- 新增 `test/xcode-memory-helper-install.test.ts`：不存在时安装、相同完整内容幂等复用、既有内容不符阻断、manifest/签名异常、路径与符号链接逃逸、构建/签名失败、取消与所属进程退出；不覆盖未知目录，不删除用户数据。
- 修改 `src/xcode-memory-preflight.ts` 或增加内部 resolver：从已验证的固定 bundle 解析 executable；执行前重核验清单/签名。原 preflight 协议保持只读，继续 targetVerified=false。安装不是 capture readiness。
- native/README.md、ADR-044、技术选型、数据目录说明与验证记录同步；不新增正常 TUI 默认入口或配置 schema。

流程：先构建唯一暂存目录并校验，首次安装采用不覆盖发布；既有同内容合法 bundle 直接复用，内容不同必须显式阻断，不能暗中升级已获权限的代码。竞争实例不能覆盖对方产物，失败只清理明确属于本次且没有发布的暂存内容。具体安全原语在实现前结合现有文件工具确认；若无法保证不覆盖就不发布。

本单元确认范围：上述代码/测试；在本机目标首次安装一次只读 helper（若已有不符内容则停止）；执行一次独立 preflight 和无修改复用校验。Swift 编译、ad-hoc 签名不选择 Apple Team、不接触 Keychain，不写被测 iOS 项目。保持现有 helper 功能，**不请求或启用 AX 权限，不启动 Xcode、不操作 iPhone**。不将这次安装授权解释为后续升级或 GUI 自动化授权。

## 检验与退出

定向测试、typecheck、lint；真实 macOS 编译/签名校验/首次安装与复用检查，退出/取消测试使用自有临时子进程。报告签名模式和清单一致性，不输出本机个人签名身份。保留 accessibility_unavailable 原因，不能伪造已获得权限。目录写入若被沙箱拦截，走明确安装范围的标准审批，不能迁移到非持久化临时二进制要求授信。

A2 后才能提供可审阅的稳定安装位置、bundle ID、可执行文件哈希和实际功能边界，再就**该具体版本**申请一次系统辅助功能授权。实际归属是否为该 helper、是否能在正常用户启动环境独立查询必须实测；若系统把访问归给父应用，不自动授予 Terminal/Codex 更广权限，先记录证据并调整方案。

授权后的只读查询应分别验证 Xcode 未运行和已有实例冲突，不能自动启动或关闭用户 Xcode 来制造场景。捕获/调试/导出仍属于 ADR-044 B 单元的新计划；两组旧设备对照授权已消费。

## 尚未承诺

固定路径的 ad-hoc 开发包不承诺重新构建后免授权，也不等于可分发生产包。helper 安装通过不能关闭 US-12.3 AC5/AC7；真机完整 TUI、Simulator 多轮/baseline、XCUITest 及其他出口仍待完成。
