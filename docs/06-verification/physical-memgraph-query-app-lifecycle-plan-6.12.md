# T6.12 独立query App生命周期验证候选

日期：2026-09-17。状态：用户已授权，两项限定生命周期检查通过。依据ADR-046与query-composition-plan。此次只验证App启动、IPC与原实例退出，不是物理内存采集或G5。

## 准备与最小修复

准备时发现launcher定时器在helper退出后立即读取protocolClosed；worker已读完协议但main完成回调尚未执行时，会提前exit2。诊断假设按代码证据排序：①定时器与bridge完成回调先后竞态；②bridge尚未读完EOF；③清单/签名不匹配。第一项可由确定性状态复现；第二项也要求独立等待bridge终态；第三项由固定清单与codesign只读验证排除本候选准备阶段的漂移，但不声称排除未来运行异常。

增加纯退出判定，只有launch回调、bridge终态及原helper退出（或确证未尝试创建）齐备才结束，deadline仍失败关闭。32种组合及“helper先退出、bridge随后完成”时序通过；没有以超时替代退出证据。该修复属于已批准离线launcher接线的最小纠正。

复检：2 pass / 0 fail、81 assertions、32.63秒；包含真实无GUI socket/EOF/信号和候选warnings-as-errors编译。typecheck、lint959文件、diff检查通过。日志`/private/tmp/itestagent-query-app-prep-tests.log`、`itestagent-query-app-prep-typecheck.log`、`itestagent-query-app-prep-lint.log`。上一315/97为此前完整离线范围证据，本轮没有重跑全库或新增G5。

## 可审阅签名候选

在全新临时目录重新构建，仅对这份候选做ad-hoc签名，不使用个人证书/Keychain、不覆盖既有安装包。App与launcher的codesign --verify --strict通过，随后更新完整文件清单，TS真实resolver已复核签名与固定清单，未调用launch。

| 项目 | 值 |
| --- | --- |
| 候选根目录 | `/private/tmp/itestagent-query-app-candidate-VFrzHd/candidate` |
| App | `iTestAgentMemoryQueryHelper.app`，0.1.0，`com.itestagent.memory-query-helper` |
| 清单 | `candidate.json`，26项文件，含签名资源 |
| 清单SHA256 | `ce4d25b1cd854e4f0eaf304d73e44fa70cd371bbe7ddef24356426bd0d82be84` |
| helper二进制SHA256 | `ee757251009821d02be7beaafabac75780d0657653d90eed3dffe075f865b71c` |
| launcher二进制SHA256 | `bdb9a2892a720b87f45bc5c9e1abe6e278c35b0266a5acd53a7afdb30ead0b4b` |
| 复核元数据 | `/private/tmp/itestagent-query-app-candidate-review.json`、`itestagent-query-app-candidate-resolution.json` |

运行检查脚本`/private/tmp/itestagent-query-app-lifecycle-check.ts`已准备并仅转译检查，尚未执行。其固定清单不可从命令行替换；结果文件以wx预留防止自动重试。脚本仅摘要白名单结果，不输出nonce/challenge或原始控制台。

## 请求确认的具体动作范围

1. 只读复核上述签名/清单及无同bundle既有实例后，从临时目录执行一次normal。Bun启动自有launcher，经NSWorkspace启动该独立App，发送一次合成hello；无resource provider，应收到ack/closing/closed，不得prepared、询问查询权限或产生query结果。launcher须在原helper退出且bridge完成后exit0。
2. 第一项通过且原实例已退出后，执行一次prelaunch-eof：第二个自有launcher收到stdin EOF，不发送hello。预期启动前取消、exit2。该检查仅验证启动前EOF，不宣称已经覆盖真实App运行中断。
3. 最多两个launcher启动、最多两个helper启动（第二项预期零helper）；各自150秒原生期限，155秒外层退出观察。无自动重试；异常则记录未通过，保持unknown，不force kill或接管其他实例。
4. 两项均只做独立App生命周期检查：不安装到helpers根目录、不改系统授权，不启动Xcode/设备，不发AX/CGEvent/Return，不打开工程或调试目标，不创建/释放capture lease，不生成物理identity。若出现系统安全/授权提示则停在提示前，不用既往授权代答。
5. 正常退出由保留的NSRunningApplication观察和Bun自有child.exited支撑，另以只读进程/App清单检查残留；原controller/probe/helper哈希前后保持一致。helper无法自证退出，单凭closed帧不能判定完成。

本轮检查不能替代Xcode/document/debugger/AUT关闭来源、physical generation或正常生产TUI真机验收。T6.12保持in_progress，无commit/push。当前只完成准备，上述两项真实运行额度均未消费。


## 2026-09-17 授权执行结果

用户“授权”批准上述两项具体检查。执行前只读ps确认无同名query进程，三份既有安装二进制哈希与先前记录一致；沙箱内ps被拒后仅对只读检查申请沙箱外执行，没有将权限错误当作无进程。两份结果文件此前均不存在。运行脚本每次在启动前重新验证同一固定manifest与签名。

| 检查 | 实际观察 | 结论 |
| --- | --- | --- |
| normal（一次） | query_closed；launcherExited=true；permissionRequests=0；grantAttempted=false；queryResultReceived=false；独立ps无helper/launcher残留 | 真实NSWorkspace App握手/无provider关闭路径通过；返回候选unsupported语义，不是可采集 |
| prelaunch-eof（一次） | stdin关闭且未发送hello；launcherExited=true、exitCode=2、stderrEmpty=true；独立ps无残留 | 启动前EOF取消检查通过；不宣称真实App运行中断已验证 |

normal通过及独立退出核验后才执行第二项；两个launcher启动额度已消费，没有自动重试、terminate或force kill。normal的原helper退出由launcher保留的NSRunningApplication观察，launcher自身由Bun child.exited观察；另以ps检查结束后的残留。EOF项没有独立记录瞬时helper创建次数，不能仅凭最终无残留宣称其创建次数实测为零；预启动门禁的确定性证据仍来自已有离线用例。

证据：

- `/private/tmp/itestagent-query-app-normal-result.json`
- `/private/tmp/itestagent-query-app-normal-exit-check.json`
- `/private/tmp/itestagent-query-app-prelaunch-eof-result.json`
- `/private/tmp/itestagent-query-app-final-exit-check.json`

最终三个既有helper/controller/probe哈希均未变化。未安装候选、未改系统授权、未启动Xcode/设备、未发送AX/CGEvent/Return、未创建或释放capture lease，未commit/push。运行期间没有新代码修改，沿用本候选的2项原生定向81 assertions与静态门禁，不把此前全包315 pass说成本轮重跑。

下一缺口：完整资源owner证据如何由launcher传回TS并经验证消费、Xcode/document/debugger/AUT关闭观察器及physical generation。此次App正常退出不能替代这些资源证明，也不能开启默认capture路线。T6.12保持in_progress；下一次真实运行须有新的具体范围，不复用本次已消费额度。
