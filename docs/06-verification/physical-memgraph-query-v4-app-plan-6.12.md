# T6.12 v4 App退出回执与临时lease释放实测准备

日期：2026-09-17。状态：用户确认后，真实App单次正常关闭及临时lease释放检查通过，额度已消费。依据ADR-047；不替代真实Xcode资源关闭来源、physical generation或G5。

## 已完成准备

用户继续后，在全新临时目录调用stageMemoryNoTargetCandidate，Swift warnings-as-errors编译通过；仅给新候选App和launcher做ad-hoc签名（不使用个人证书或Keychain）。重建签名后的完整文件清单，review及默认真实codesign resolver验证通过，未调用launch。既有三份helper/controller/probe的版本与二进制哈希均与上轮一致。无生产源码改动，沿用上一批317项性能/engine与75项TUI通过的结果，不将其计为本轮重跑。

| 项目 | 固定值 |
| --- | --- |
| 候选根目录 | `/private/tmp/itestagent-v4-app-candidate-GH66df/candidate` |
| 协议/profile | v4 / no_target_resources |
| App | iTestAgentMemoryQueryHelper.app；0.1.0；com.itestagent.memory-query-helper |
| 完整清单 | candidate.json，27项文件 |
| 清单SHA256 | `0a1e6162af3e87f666d14ad741732e53128929a26d4afbc38bb816073fc55ee6` |
| helper SHA256 | `6d4c816143d9a3fcd36fdcb796f4276062a1c888283dcb58e25a087337971b05` |
| launcher SHA256 | `d27a7a48e262a844d196632ff8478446745e74a93e07c04d71ac0ddb53aa36d5` |
| 候选复核记录 | `/private/tmp/itestagent-v4-app-candidate-review.json` |
| 既有安装哈希记录 | `/private/tmp/itestagent-v4-existing-helper-hashes.json` |

运行脚本`/private/tmp/itestagent-v4-app-closure-check.ts`已准备并转译检查，未执行。脚本固定候选路径及清单摘要，结果路径以wx预留，防止失败后自动重试；只输出白名单状态和资源状态，不记录challenge、原始帧或设备证据。

## 请求确认的单次动作

1. 只读复核固定候选签名/清单、已安装helper哈希及无同名query进程。进程观测失败视为未核验，不能当作无实例。
2. 最多启动一次自有launcher，经NSWorkspace最多启动一次该候选helper。仅发送一次合成hello；无resource provider，不准备查询、不请求查询权限、不产生query结果。
3. 在全新`/private/tmp/itestagent-v4-app-lease-*`目录创建本轮临时lease；使用已实现的完整回执核验和ledger proof消费入口，仅在正常证据齐备时删除该轮lease。此为隔离测试锁，不操作`~/.itestagent/helpers`中的生产锁或未知旧锁。
4. 预期返回unsupported、leaseRetained=false、targetVerified=false、grantAttempted=false；ledger中launcher/helper为closed，其他四项为not_created；临时锁不存在，独立只读进程检查无query残留，既有安装哈希不变。
5. v4验证总期限5秒；失败则保留临时锁并记录unknown。原生owner自身期限150秒，必要时只读观察至155秒；不自动重试、不force kill、不接管其他实例、不以超时推断退出。遇系统安全或授权提示时暂停，不用旧授权代答。

本次范围不包含取消实测、安装、系统授权修改、Xcode、iPhone、AX/CGEvent/Return、打开工程、调试目标或物理identity采集，也不commit/push。只请求上述正常路径一次；旧v3的两次运行额度已消费，新v4本轮额度尚未消费。

## 判定与后续

只有固定候选完整协议/实例/清单/EOF/实际退出、lease释放和独立残留检查全部通过才记录本项成功。任一失败保留实际证据与限制；不能以离线fixture成功替代真实App结果。该项即使通过，T6.12仍in_progress，真实Xcode/document/debugger/AUT关闭来源、physical generation与生产TUI真机验收仍待完成。

## 授权执行结果

用户“确认”后执行固定脚本normal-once一次。执行前复核三份既有安装哈希一致，结果路径不存在；脚本以wx预留结果后检查无同名query进程，并通过真实签名/清单resolver重新核验候选。自有launcher经NSWorkspace启动无provider App，完成v4握手、原实例退出、launcher所属回执及TS终态核验。

实际结果：status=unsupported、leaseRetained=false、targetVerified=false、grantAttempted=false。ledger中launcher/helper均closed，xcode/document/debugger/aut均not_created。本轮隔离目录`/private/tmp/itestagent-v4-app-lease-WIdp4M`中的锁已由既有proof消费入口自动释放，没有手动清锁。脚本结果passed=true、remainingQueryProcesses=0；另一次独立只读ps核验也无残留，三份既有安装哈希未变。

证据：`/private/tmp/itestagent-v4-app-normal-result.json`与`/private/tmp/itestagent-v4-app-final-check.json`。一次launcher/helper运行额度已消费，无重试、外部终止或force kill。未安装候选、未改权限、未启动Xcode/设备或发送AX/CGEvent/Return，未commit/push。此次没有代码修改或重跑离线回归。

此结果首次证明当前v4独立App正常关闭回执可跨launcher/TS边界释放本轮无目标临时lease；不证明取消路径释放、生产全局锁并发行为、真实Xcode资源清理或物理identity。下一步仍须为Xcode/document/debugger/AUT设计和验证原owner关闭观察来源及physical generation，之后接通生产TUI真机验收。T6.12保持in_progress。
