# T6.12 A4 暂存新版的一次升级与只读复检

## 固定新版授权复检通过（2026-09-09）

用户已在 System Settings 移除旧 helper 条目，Agent 确认其不再存在后，经公开文件选择器重新添加固定新版 iTestAgentMemoryHelper.app；观察到对应开关 on。随后一次独立生产内部 App transport preflight 返回 eligible/xcode_not_running、targetVerified=false、Xcode 26.5、cleanupVerified=true。没有扩大父应用权限或修改其他条目；没有启动 Xcode 或操作设备。

此前升级后旧条目 on 但实际不受信的问题，在移除旧条目并添加固定新版后解除。当前只证明新版 host 只读前置和退出链路；Xcode 已运行分支、目标绑定、自动 Memory Graph 和正常 TUI G5 仍需后续 B 计划与实测。旧版备份保留，未继续升级/重签，T6.12 in_progress。代码未变，沿用 A4 typecheck/lint/226 项宿主包回归证据。

## 固定升级完成，旧 AX 条目仍待刷新（2026-09-09）

用户确认升级/备份及新版必要授权。旧版、新版摘要/签名和无运行实例核对通过；使用系统公开 renamex_np(RENAME_EXCL) 完成非覆盖备份及发布，完整旧版备份/新版清单再次核验通过。恢复状态由 /private/tmp/itestagent-helper-upgrade-state.json 定位，备份未删除，未自动回退。

固定新版 App transport 首次只读 preflight 返回 accessibility_unavailable、cleanupVerified=true。System Settings 旧同名条目仍为 on；尝试添加同一路径时 Open 禁用。AX 行选择无效、Remove 保持禁用，坐标点击返回 noWindowsAvailable，因此没有实际移除条目。只对 iTestAgentMemoryHelper 开关 off→on；随后一次授权后复检仍 accessibility_unavailable、cleanupVerified=true。未修改其他 App 权限、TCC 数据或设备。

当前需要在系统 UI 移除该 helper 旧条目后重新添加固定新版；自动化未能选中行，需用户仅完成这项首次环境恢复，后续添加/复检继续自动执行。没有新的捕获 G5，不将权限开关等同运行时访问。代码未变，沿用 A4 的 typecheck/lint/226 项宿主包回归证据。

状态：升级、旧版备份、新版 AX 授权及独立只读复检均完成；不代表自动捕获 G5。2026-09-09。

## 可审阅产物

候选版本 0.2.0、bundle ID `com.itestagent.memory-helper`；helper SHA256 `d751dcce8c54883df364c9dac016fcf791738017a10f8be8c3743e1c2b7b7e1d`，launcher SHA256 `a858a79951da0e5751c1d603613ec0fddc642859f4ebe5fd4c24afd6b04c4d19`。系统 ad-hoc 签名与 schemaVersion=2 清单校验通过。暂存位置由 `/private/tmp/itestagent-memory-a4-review-state.json` 定位，不把本机临时路径写入产品配置。

旧版固定 helper SHA256 仍为 `4b7f416dd2c0d7ff4f2809ca6c6f073ad0d2abf87767f39d829eae4798f72520`，未覆盖，原系统开关未调整。新版仍只读：增加 App 生命周期登记、绑定结果文件及独立 launcher，未增加 Xcode 点击/调试/捕获或设备能力。它的 ad-hoc 身份与旧版不同，不承诺继承旧授权。

## 具体申请

1. 使用已有文件/系统工具完成本机一次升级，不新增自动升级或后台服务：重核验上述候选摘要/签名、旧版摘要和无运行 helper/launcher。出现身份差异或仍有实例/lease 则停止。
2. 在 `~/.itestagent/helpers/` 下保留唯一旧版完整备份并验证；将已校验候选发布到固定 `xcode-memory/`，包含 app、launcher 和清单。使用不覆盖未知目标的操作，竞争/失败停止并保留可审计状态，不自动删除旧版或失败产物。升级期间不启动 helper；发布完成后再次验证。
3. 针对上述确切新版，如果系统不再授信，允许经 System Settings 为该 helper 重新开启辅助功能；若需要系统管理员验证由用户完成。不得转而扩大 Codex/Terminal 权限。只对明确的新 helper 条目操作，不清空 TCC、不重置其他 App 权限。
4. 通过新 App transport 执行一次独立只读 preflight，并核验其结果与 owner 退出。当前 Xcode 若未运行只验证该分支；若有实例则记录 conflict，不自动关闭/启动 Xcode。若未授信则完成第3步后执行一次明确的权限复检，不循环重试。

升级发布校验失败时不运行候选。旧版备份是可供审阅的回退来源；恢复也需要核对签名/清单和单独确认，不能声称恢复文件就必然恢复系统授权。任何同设备业务操作、重新运行内存阳性/释放、自动捕获 B 都不在此申请内。

## 已完成的 A4 验证

typecheck 通过；lint 920 文件通过；性能包 opt-in 宿主回归 226 tests/1365 assertions 全通过，含 6 项真实宿主用例：正常退出、结果先写后取消、超时、已有实例隔离、父管道 EOF 与晚回调、结果文件不覆盖/不跟随链接。暂存 candidate 构建及最终签名/清单验证通过，原固定包哈希未变。

新 transport 没有真实执行 Memory Graph；这些都是只读基础设施和无权限宿主 fixture 验证，不替代正常 TUI G5。T6.12 保持 in_progress。
