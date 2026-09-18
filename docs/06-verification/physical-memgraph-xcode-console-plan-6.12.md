
## 2026-09-17 替代提交方案已准备，待批准离线实现

已核对US-12.3禁止每轮人工操作作为验收路径，以及公开CoreGraphics/SDK的postToPid、事件权限preflight、Return常量。新增ADR-045提案和physical-memgraph-native-return-plan-6.12.md，推荐显式实验性固定Return策略，仅向自有且反复核验的Xcode实例；不做全局键盘或AXConfirm失败后自动fallback。void投递不能判执行成功，仍需请求绑定响应；焦点/PID竞态残余风险明确保留。

本次仅申请代码/无副作用状态机测试/公开适配器编译，不安装App、不请求权限、不实际发送事件、不启动Xcode/任何App夹具或设备。代码尚未实施，0.1.3和系统权限不变。完整计划已可审阅，T6.12 in_progress，无提交推送。

## 2026-09-17 0.1.3 原生能力观察通过；AXConfirm 未公开

用户“继续”授权本次升级和单次只读复检。锁定0.1.3安装及旧0.1.2备份验证通过；用户仅移除旧probe AX条目后，正常按完整路径重加（面板版本0.1.3），preflight c6463684-f550-4de6-b920-146600de2fd5 返回 trusted，exit0/cleanupVerified=true。初次 unavailable 证据保留。

既有fixture哈希复核通过，初始Xcode未运行，只打开MemoryIdentityProbe/My Mac。一次Run Without Building/Pause、聚焦debug console后，原生观察6183a00a-bcb7-410b-a91c-2d611ca814b5返回status=observed/reason=read_only_capabilities，无axFailure。初始实例五项全部通过，工程目录绑定及最终文档/窗口/焦点复核通过。

实际布尔结果：selectedTextSettable=true、emptyPromptMatches=true、emptySelectionAtEnd=true、inputCountReadable=true、outputCountReadable=true、outputRangeReadable=true；confirmAdvertised=false。这验证了文档匹配修复在本次真实宿主可用，以及输入/输出只读能力；它没有执行AXSelectedText写入、任何命令/Return/AXConfirm，也不证明提交可靠性或物理目标身份。targetVerified仍false。

结论限定当前Xcode26.5/该宿主控制台：公开动作列表没有AXConfirm。现有MemoryConsoleSubmission要求显式AXConfirm，因此必须在插入前拒绝；不能因可写或此前CUA Return成功而放行。继续同一能力探针不会填补提交协议缺口。替代提交途径属于下一技术边界决策，不能静默改为AXPress、CGEvent、AppleScript或复用CUA作为独立生产实现。

一次Resume后Finished running、Stop disabled，关闭所属工程并Quit。独立ps确认Xcode69219/RPC69367/宿主69368均不存在，应用清单isRunning=false。launch=1/pause=1/resume=1/stop=0/queries=0/observations=1；本次额度消费。系统probe授权保持，不自动授予新版本或新输入方式。

下一步应先形成可审阅的替代提交方案与ADR边界：既有CUA短加载只可作为宿主参考证据；若评估独立原生受控键盘通道，须明确仅自有Xcode/既有fixture、固定请求、空输入/焦点/前后台及owner复查、一次性发送、不确定结果不重试、严格响应解析和清理，并单独确认实现/安装/真实动作范围。另一选择是保留unsupported或人工提交作为显式受限能力；这不能宣称独立自动化B完成。本轮未选择或实现任何新通道。

证据 `/private/tmp/itestagent-console-document-binding/` 下 installed-app-preflight.json、observation-result.json、owner.json、cleanup-result.json。本轮无生产代码变更或新构建/设备/提交推送，文档JSON/diff通过；上一254 pass/8 skip为历史代码门禁，没有新的G5/G5-SIM。T6.12保持in_progress，完整capture/export/生产接线/真机验收仍未完成。

## 2026-09-17 0.1.3 已授权安装，单项 AX 更新待用户操作

用户“继续”授权上一具体升级及单次只读复检方案。新旧完整清单/签名和无运行中probe检查通过；0.1.2备份至 `~/.itestagent/helpers/xcode-memory-console-probe-backup-d39c623f-76bb-4a2e-a256-dc3ae6f7d8f5/`，0.1.3安装至原固定路径，复制后验证通过。原0.2.0 helper及已有备份不变。

preflight请求98fc6931-10c1-45e9-ab2a-ba34e0e6c27c返回accessibility_unavailable，exit0/cleanupVerified=true。系统probe旧条目仍on，CUA点击无法选中、Remove disabled，已请求用户仅移除此条目，再正常添加新版；不重置TCC或更改其他权限。证据 `/private/tmp/itestagent-console-document-binding/installation-result.json`、installed-app-preflight.json。Xcode尚未启动，既有fixture哈希已复核；单次宿主额度未消费，同方案无需重新确认。T6.12 in_progress，无设备/提交推送，JSON/diff校验通过。

## 2026-09-17 本地工程目录绑定修复完成，0.1.3 候选待确认

按用户“继续”落实上一节离线修复计划。新增 native/itestagent-memory-local-document.swift：只接受无 host（明确 localhost 同样拒绝）、user/password/port、query/fragment 的绝对本地 file URL，限制长度并拒绝 NUL。realpath 后以 O_DIRECTORY/O_NOFOLLOW/O_CLOEXEC 打开目录，不读取文档内容。比较完整 canonical path 和设备/inode，不以 URL 尾目录标记、窗口标题或 basename 判同一工程。

预期目录描述符保持打开至 binding 释放，阻止同路径替换继承原目录身份；缺失、普通文件、不同工程/同名前缀/远程URL及带查询/片段拒绝。已知本地符号链接和 /tmp→/private/tmp 别名可在指向同一实际目录时匹配。此为本地目录身份检查，不宣称对抗同用户恶意文件系统竞态的隔离，也不替代真实设备/构建/进程绑定。

原生 locateMemoryAXConsole 已使用此单元，在每次解析开始建立 binding，保留到末尾文档复查；前后 owner/取消/期限检查保持。其生命周期限单次解析，不能据此宣称多个独立轮询之间的目录身份连续性已解决。临时 probe 在完整单次观察中保留同一 binding；已安装 probe 未改。上下文/定位测试夹具改为独占临时现存目录，实际验证无尾斜线 AX 文档与带目录标记 expected URL 匹配。

验证：新增编码（空格/%/#/中文）、尾斜线、symlink/路径别名、远程/localhost/credentials/query/fragment/NUL/超长、缺失/文件/不同目录及目录移动替换负例；新旧四项原生定向测试 4 pass。性能包 254 pass/8 opt-in skip/0 fail，1570 assertions/40文件（28.24秒）；typecheck/lint939/diff通过。没有运行全库、Xcode、设备或 G5/G5-SIM。

临时只读 0.1.3 候选 `/private/tmp/itestagent-console-document-binding/iTestAgentMemoryConsoleProbe.app` warnings-as-errors 编译及严格签名通过；review-sources/review-manifest.json 同目录。可执行 SHA256 `85c7c61c08cc3fe69e3a945910d769ebf84fee548c81539e57bcf4be540b84cb`。未安装、未执行。固定安装版仍是已授权 0.1.2，哈希 11e74e3fa8ff08d5b9ade0baf248d7222e4daf56fe8ea5d95a320725f7d3808a 不变。实际 Xcode 文档匹配和后续能力仍待复验，不能把离线通过当真实修复已验证。

### 下一次备份升级与一次只读复检（待确认）

确认后核对新候选与固定旧版完整清单/签名，并确认无运行中 probe；将 0.1.2 移至 helper 父目录新唯一备份目录，安装此次锁定 0.1.3 至原固定 probe 路径，复制后复核。哈希/现有文件冲突即停止，不删除旧备份，不改原0.2.0 helper。

执行无 Xcode preflight；如新签名 trust 不匹配，只在正常系统设置移除该 probe 旧条目并按完整新版路径重加，用户完成必要的选择/身份验证，不改其他 App 权限或重置 TCC。trusted 后才可继续。

仍使用前述2026-09-16第3–5步的唯一既有 macOS fixture/二进制哈希及5分钟上限：初始存在用户 Xcode、fixture缺失/变化或要求构建即停止；最多一次 Run Without Building/Pause、聚焦空输入、一次只读观察，再一次 Resume/正常关闭/Quit及独立所属进程退出检查。无命令/Return/AXConfirm，不重复试验或激活以绕过失败；无iPhone/Simulator/capture/baseline/commit/push。升级和该次额度需要明确确认，现未执行。

日志 `/private/tmp/itestagent-document-binding-package.log`、itestagent-document-binding-typecheck.log、itestagent-document-binding-lint.log。T6.12 in_progress，未提交推送。

## 2026-09-17 0.1.2 复检定位文档匹配失败，目录 URL 表示差异离线复现

用户确认安装及复检后，固定 0.1.2 哈希/签名及备份验证通过。用户手动移除旧单项 AX 条目，CUA 确认消失后按固定路径重新添加（面板版本0.1.2），原生 preflight 请求 29598018-a1fe-4f8c-806d-f4f70b5b3e2f 返回 trusted、exit0/cleanupVerified=true；初次 unavailable 证据保留。

现有 fixture 路径/产物哈希复核通过，应用清单初始 Xcode 未运行。仅打开既有 MemoryIdentityProbe/My Mac，一次 Run Without Building/Pause、聚焦输入后一次原生只读观察。请求 b47dc6d8-00ac-46ae-a988-0e29b9f28a8f：初始实例五项全部通过；axFailure={stage:document, operation:document, cause:mismatch, nodesVisited:0, depth:0, elapsedMilliseconds:61}，无 AX API 错误码。因此本次已成功读取可解析本地文档 URL，但它与期望 URL 的比较失败；尚未遍历控件/查询提交能力。没有命令、Return、AXConfirm 或重试。

一次 Resume 后 Finished running、Stop disabled；关闭所属工程并 Quit。独立 ps 确认 Xcode65971/RPC66107/宿主66108 均不存在，应用清单 isRunning=false。launch=1/pause=1/resume=1/stop=0/queries=0/observations=1；本次额度已消费。

最小离线复现使用同一已存在工程路径和 CUA 已展示的 file URL，不再次访问 Xcode：URL(fileURLWithPath:) 自动保留目录标记，而 URL(string:) 构造不带尾斜线的同一路径 URL；两者 resolvingSymlinksInPath().standardizedFileURL 比较 false，path 比较 true，hasDirectoryPath 分别 true/false。这确认候选中的直接 URL 相等算法可对同一工程发生误拒绝。未记录本次原生 AXDocument 原值，故不能将该复现直接定为此次 live 错误唯一根因。

按证据排序：①目录 URL 表示差异（已独立复现算法缺陷，CUA 已显示同一路径）；②AXDocument 指向不同工程/工作区或尚未稳定（本次没有保存其值，不能排除）；③读取前后文档漂移（实例门禁成功不证明文档始终不变）。只修表示等价问题，不容许任意不同工程通过。

下一具体离线实现计划：新增受限本地文档匹配单元，对合法本地 file URL 做目录/规范路径比较，消除仅目录尾标记差异；保留工程匹配与 owner/focus 门禁，拒绝远程 host、query/fragment、无效/不存在路径及不同文件。测试覆盖有无尾斜线、已知本地路径别名、百分号/空格编码、不同工程、同名前缀、缺失路径/非本地URL。接入候选，回归后生成新的可审阅包；不直接放宽为窗口标题或 basename 比较，不自动覆盖已授权0.1.2或重复宿主运行。生产 context 的匹配策略如需统一，须同样测试并同步说明，不宣称仅候选修复已经完成生产接线。

证据目录 `/private/tmp/itestagent-console-ax-diagnostic/`：installed-app-preflight.json、observation-result.json、owner.json、cleanup-result.json；离线复现源码 `/private/tmp/itestagent-document-url-check.swift`，布尔结果收录 cleanup-result.json 的 urlReproduction。没有本轮生产代码变更，全库/G5/G5-SIM未重跑；文档 JSON/diff 通过。T6.12 保持 in_progress，无设备/提交推送。

## 2026-09-17 0.1.2 已确认安装，等待单项 AX 授权更新

用户确认后完成新旧完整包清单/签名验证，并以独立 ps 确认 probe 未运行。旧 0.1.1 备份至 `~/.itestagent/helpers/xcode-memory-console-probe-backup-161848b9-e1e2-4a56-828e-fa00706dfa89/`，锁定的 0.1.2 安装到原固定 probe 路径，复制后新旧包哈希和严格签名均通过。原 0.2.0 helper 不变。证据 `/private/tmp/itestagent-console-ax-diagnostic/installation-result.json`。

新版第一次 preflight 请求 73d35888-10bc-49bc-b532-2e44ae707342 返回 accessibility_unavailable，exit0/cleanupVerified=true。系统设置仍显示旧 probe 开关 on；已有上一轮证据表明需要正常单项移除后重新添加，不能只凭开关判断新版 trust。CUA 对已聚焦列表使用 Home 和点击 probe 行后仍未选中，Remove disabled；已请求用户仅移除该 probe 条目，再继续添加固定新版。没有重置 TCC、操作其他 App 权限或启动 Xcode。一次宿主观察额度未消费，同一升级/复检范围无需重新确认。

本轮至此没有生产代码/设备/提交推送；T6.12 in_progress。旧 253 pass/8 skip 为上一实现单元证据，未重跑。文档 JSON/diff 校验通过。

## 2026-09-17 AX 各阶段诊断完成，0.1.2 候选待确认

本轮按用户确认完成离线诊断单元，未升级或运行已安装 probe。新增 native/itestagent-memory-ax-diagnostics.swift，固定阶段覆盖 windows/windowIdentity/document/tree/pair/focus、可写性/动作/inputCount/prompt/selection/outputCount/outputRange、最终窗口/文档/焦点复查。固定操作区分 timeout、角色/标识/描述/文档/焦点属性、子节点计数/读取、动作、范围、选区和预算；固定原因区分 AX API、类型/缺失、限额、歧义、循环、匹配、上下文/期限及未知异常。首个失败冻结，后续操作禁止恢复，外层 catch 不覆盖根因。

错误仅包含枚举、SDK AXError.h 的 -25214…-25200 白名单代码、访问节点数（最多513）、深度（最多17）和诊断总耗时（最多60000ms）；不记录任意异常字符串、属性值、PID/路径或原始窗口/控制台文本。错误码未知时省略，不能把遗漏当 success。通用诊断模块可分类 cancelled，但本次探针没有据此新增或宣称完整内部取消协议，外部 launcher 的期限/生命周期边界仍需独立保留。

临时只读 probe 0.1.2 已接入这些阶段及直接公开 AX API 的错误检查，保留 10 秒观察期限、0.25 秒消息期限、512节点/16层/64子节点及范围读取边界。原先 try? 吞掉的 capability 查询错误现在阻断并给出诊断，属于更严格的失败关闭；不将未知能力报作确定 false。最后还复核同一窗口对象。没有改变生产 context、提交逻辑或目标身份语义。

验证：合成 fixture 覆盖 289 个阶段×操作组合、首错保留/禁止恢复、未知错误码、极值计数/时间和各类失败。测试证明诊断政策，不证明真实 Xcode 所有 API 分支。候选首次编译发现 Swift 短路表达式的 try 位置错误，修正后 warnings-as-errors 编译与严格签名通过。性能包 253 pass/8 opt-in skip/0 fail，1566 assertions/39 文件（25.86秒）；typecheck、lint938 与 diff 通过。无全库或 G5/G5-SIM 新证据。

候选 `/private/tmp/itestagent-console-ax-diagnostic/iTestAgentMemoryConsoleProbe.app`；review-sources、review-manifest.json 同目录。可执行 SHA256 `11e74e3fa8ff08d5b9ade0baf248d7222e4daf56fe8ea5d95a320725f7d3808a`。已安装 0.1.1 哈希仍为 685382d2c4117213f42d164f8117b41b2b15b77e95635a07ec60a787402bb560，未改变。本轮无 Xcode/设备/系统权限/提交推送；T6.12 in_progress。

### 下一次升级和单次复检（待确认）

确认范围仅为：核对上述新候选及固定旧版完整清单/签名、确认无运行中 probe；将 0.1.1 移至 helper 父目录的新唯一备份目录，再将此 0.1.2 安装到原固定 probe 路径。冲突/哈希不符即停止，不删除既有备份，不动 0.2.0 helper。新包复制后再次验证全部文件哈希及签名。

先运行无 Xcode 的 AX preflight；若权限不匹配，正常系统设置仅移除/重新添加该 probe 的固定新版路径，用户完成必要的身份验证，不碰其他 App 权限或重置 TCC。trust 未成立不得进入宿主操作。

trust 通过后，复用前述 2026-09-16 第3–5步同一 macOS fixture 和锁定二进制哈希；初始有用户 Xcode/工程或产物缺失/哈希变化/要求构建即停止。最多一次 Run Without Building/Pause、聚焦空输入、一次只读观察；不写命令、不按 Return、不执行 AXConfirm，不因失败自动重试或更改前台状态绕过检查。一次 Resume、正常关闭/Quit及独立所属进程退出核验，总流程5分钟。无 iPhone/Simulator/capture/baseline/commit/push，单次额度执行后消费，结果不代表身份或提交能力通过。

日志 `/private/tmp/itestagent-ax-diagnostic-package.log`、itestagent-ax-diagnostic-typecheck.log、itestagent-ax-diagnostic-lint.log。

## 2026-09-17 0.1.1 宿主复检完成：实例通过，AX 读取阶段阻断

用户手动移除旧 probe 权限条目后，CUA 确认该行消失；正常 Add/Go To 选择固定路径，Open 面板显示版本 0.1.1，添加后原生 preflight 返回 read_only_probe_trusted（a3998c32-53df-4f1b-b660-76735110fa39），exit0、cleanupVerified=true。之前三次 unavailable 如实保留。单项移除再添加解除本次新版权限阻断；不据此宣称已确认 TCC 内部根因，没有重置 TCC 或改其他 App 权限。

再次核对 fixture 哈希并确认 Xcode 未运行，只打开既有 MemoryIdentityProbe/My Mac，一次 Run Without Building/Pause，聚焦 debug console 后执行一次新版只读观察。请求 f77e6ee3-726d-4ffc-894b-a22d89f488b5：initialObservation.reason=observation_eligible；instanceCount=1、pidMatches=true、bundleMatches=true、active=true、terminated=false。最终 blocked/bounded_observation_failed、capabilities={}、targetVerified=false，探针 exit0、cleanupVerified=true。

本次初始实例门禁通过，不代表已解释此前 observation_conflict。后续统一 catch 仍未区分具体 AX API/阶段失败，无法断言窗口属性、节点预算、公开动作或范围读取哪项导致失败，更不能说 AXConfirm 不支持。无命令写入、Return、AXConfirm 或重试。

一次 Resume 后 Finished running，关闭所属工程并 Quit。Quit 后 CUA 返回 procNotFound；独立 ps 确认 Xcode 62145、直属 LLDB RPC 62295、宿主 62296 均不存在，最终应用清单 isRunning=false；不依赖单独 CUA 错误作为清理证明。launch=1、pause=1、resume=1、stop=0、queries=0、observations=1；此次复检额度已消费。

本地证据 `/private/tmp/itestagent-console-observation-diagnostic/`：installed-app-preflight.json、observation-result.json、owner.json、cleanup-result.json。安装版现在为已授权 0.1.1，原 0.1.0 备份仍保留。下一离线单元应一次补齐有界观察各阶段的固定错误类型、AXError 数字白名单、预算/时限及终止阶段（不记录属性值、控制台/窗口文本），用合成异常覆盖并验证原失败关闭条件；避免逐次 live 试验才发现下一个未区分错误。尚不授权新版本升级、再次宿主复检或设备操作。

本轮未改生产代码或重新构建；文档 JSON/diff 检查通过，上一 252 pass/8 skip 仍为历史代码门禁，没有新的 G5/G5-SIM。T6.12 保持 in_progress，未提交推送。

## 2026-09-17 0.1.1 已确认升级，AX 重新授权仍受阻

用户确认后核对新候选全部源码/包清单及旧安装包完整清单，严格签名通过；独立 ps 确认无运行中探针。旧 0.1.0 移至 `~/.itestagent/helpers/xcode-memory-console-probe-backup-8d0cbd6a-2be6-4d86-b4d2-189e6f58ebf9/`，0.1.1 安装至原固定 probe 路径，复制后新旧包哈希/签名再次通过。原 0.2.0 helper 未改。安装记录 `/private/tmp/itestagent-console-observation-diagnostic/installation-result.json`。

升级后 AX preflight 返回 accessibility_unavailable。正常系统设置显示 probe 开关 on，但重新添加完整固定路径（Open 面板明确显示版本 0.1.1）后仍不可用；仅切换该 probe off/on 后再次检查也相同。三次 preflight 均 exit0、cleanupVerified=true；没有绕过权限、重置 TCC、读取 Xcode 或执行命令。原生 trust 优先于设置开关显示；旧记录/签名匹配问题只是候选解释，未读 TCC 数据库，根因不确诊。

计划内的正常单项授权更新尚未完成。CUA 用行索引、可见坐标及窗口 Raise 后均无法选中 probe 行，Remove 一直 disabled；已请求用户手动仅移除 iTestAgentMemoryConsoleProbe 条目，随后可继续添加固定新版路径并 preflight，不重复申请同一方案授权。没有删除 App 或备份，没有更改其他 App 权限。

证据目录 `/private/tmp/itestagent-console-observation-diagnostic/`：preflight-before-reauthorization.json（64bc3a00-f512-41c7-93ec-dd1fa56abcbc）、preflight-after-readd.json（09df721b-54f4-4e16-bb95-b86b7fa795df）、installed-app-preflight.json（fa532771-dabc-49f8-9172-60dcc6c726d5）。本次宿主启动/观察额度均未消费，Xcode 未启动；后续先重新核对 fixture 和初始 Xcode 状态。T6.12 保持 in_progress，无生产代码/设备/提交推送。文档 JSON 与 diff 检查通过；上一 252 pass/8 skip 为历史代码门禁，本轮未重跑。

## 2026-09-17 实例诊断已补齐，0.1.1 候选待升级确认

新增 native/itestagent-memory-app-observation.swift，区分 observation_instance_absent / observation_instances_ambiguous / observation_pid_mismatch / observation_bundle_mismatch / observation_not_active / observation_terminated / observation_incomplete，以及无效输入和错误线程。全部检查布尔值随固定主原因保留，多个条件失败不会因只返回首项而丢失其余证据；未知字段省略，不编码成实测 false。只有实例唯一、PID/路径匹配、active=true、terminated=false 时允许控件读取，targetVerified 始终 false。

公开适配器只采样 AppKit 进程元数据，不激活/启动/接管/终止 App。返回的观察对象不是生产 owner，既有每次 AX 操作的上下文复核仍保留。本轮没有更改生产 context 的 owner 判定，没有放宽授权或读写门禁。组合 guard 的实际失败原因仍未知，新增诊断尚未在真实 Xcode 执行。

原生合成 fixture 验证 405 种计数/布尔/未知状态与原放行条件完全等价，单项错误原因可区分，编码字段只含固定检查/原因，invalid PID 在枚举 App 前被拒绝。定向测试 1 pass；性能包沙箱内首轮 251 pass/8 skip/1 fail，既有公开系统通知握手返回 performance.notification_failed。沙箱外同一命令复验 252 pass/8 skip/0 fail，1562 assertions/38 文件（23.15 秒），支持通知环境限制解释，没有修改该测试。8 项 App/LLDB opt-in 未启用。typecheck、lint（937 文件）及 diff 检查通过；没有全库/G5/G5-SIM 新证据。

临时 0.1.1 候选 `/private/tmp/itestagent-console-observation-diagnostic/iTestAgentMemoryConsoleProbe.app` 已编译并通过严格签名验证；review-sources 与 review-manifest.json 位于同目录。可执行 SHA256 `685382d2c4117213f42d164f8117b41b2b15b77e95635a07ec60a787402bb560`。候选只替换初始组合实例检查为新固定诊断，结果添加 initialObservation；后续只读范围、期限和上下文检查不变。未执行候选、未覆盖固定安装版；复核安装版 SHA256 仍为 dcbe90837f036a49a458d96158a7a8526493a2dbae831529c7ed2d4898a97ecf。

### 下一次具体升级与复检范围（待确认）

原授权明确“本次不授权以后替换或扩展这个 App。”所以此次候选已经准备到可审阅状态，但升级与再次宿主运行尚未执行。

确认后：核对新候选清单/签名与固定旧版完整清单；仅在二者都匹配且无运行中探针时，将旧版移至同 helper 父目录下新建唯一备份目录，安装此 0.1.1 到原固定 probe 路径，不动 0.2.0 xcode-memory helper。目标或备份有冲突即停止，不删除/覆盖备份。再次校验所有文件与签名后执行只读 preflight；若 macOS 要求为此次更新版重新授予 AX 权限，使用正常系统设置并由用户完成身份验证，不重置 TCC 或绕过系统保护。

随后沿用前述 2026-09-16 第 3–5 步的同一既有 macOS 工程/二进制哈希及五分钟上限，最多一次 Run Without Building/Pause，聚焦空输入后一次只读观察，再一次 Resume 和正常关闭/Quit，并独立核对所属进程退出。初始有用户 Xcode、fixture 已清理/哈希变化、要求构建或上下文不明即停止。本次输出仅新增初始检查布尔值，不写命令、不执行 AXConfirm、不按 Return，不自动重试、不激活 Xcode 来绕过失败。仍无 iPhone/Simulator/capture/baseline/commit/push。成功或失败后该次额度即消费。

日志：/private/tmp/itestagent-observation-package.log（沙箱失败）、itestagent-observation-package-host.log（复验通过）、itestagent-observation-typecheck.log、itestagent-observation-lint.log。T6.12 保持 in_progress。

## 2026-09-17 AX 授权生效，单次只读观察在实例门禁阻断

用户完成 Touch ID 后，CUA 在系统 Open 面板选择已批准的固定 `iTestAgentMemoryConsoleProbe.app`。随后安装版 App preflight 返回 eligible/read_only_probe_trusted，请求 a9b88b09-0259-483f-a35f-68e6fb6362cc，exit0、cleanupVerified=true；以原生结果证实 AX 权限生效，不依赖设置列表的异步显示。安装版全部哈希与既有 macOS fixture 产物再次核对通过。

初始应用清单 Xcode isRunning=false。只打开既有临时 MemoryIdentityProbe 工程，核对 scheme/My Mac，一次 Run Without Building 后 Pause，CUA 确认 debug console 获焦。原生只读观察绑定本次 Xcode PID 90505 和既有工程路径，请求 7eec37e2-9067-4db6-b85b-bca0917248dc，返回 blocked/observation_conflict、capabilities={}、targetVerified=false，exit0、cleanupVerified=true。未进入 AX 控件读取，不能判断 AXSelectedText/AXConfirm、空 prompt 或范围读取能力；没有命令写入、Return、AXConfirm、重试或设备动作。

源码定位：该固定错误来自一个组合 guard，包含 NSRunningApplication 唯一实例、PID 相等、bundleURL canonical 路径、isActive 和未退出。当前证据不足以区分失败项。按证据排序的假设：①前台状态在 CUA/工具调用间变化（CUA 输入焦点不等于 App 原生 isActive）；②AppKit 实例注册或 PID 观察不一致（独立 ps 中本次 Xcode PID 正确，但不证明 AppKit 同时刻枚举）；③bundleURL canonical 路径或实例状态差异（ps 可执行路径符合预期，但不替代 bundleURL 检查）。三者均未验证，不将推测写成根因，不放宽门禁。

一次 Resume 后显示 Finished running，Stop 禁用；正常关闭工程并 Quit。独立 ps 确认本次宿主 90702、直属 RPC 90701 和 Xcode 90505 均不存在，应用清单 isRunning=false。launch=1、pause=1、resume=1、stop=0、queries=0、observations=1；本次单次宿主观察授权已消费。系统 AX 授权仍保持，不能将其当未来任意程序升级或宿主重跑许可。

本地证据目录 `/private/tmp/itestagent-console-capability-probe/`：installed-app-preflight.json、observation-result.json、owner.json、cleanup-result.json。下一最小单元是无 Xcode 的诊断改进：把组合门禁拆成固定原因/白名单布尔值并用合成状态验证；不修改已安装候选，不自动再次启动 Xcode。新的候选升级/宿主复检需具体方案，不能用已有权限绕过单次范围。

本轮无生产代码或构建变更；任务 JSON 与 git diff --check 通过，259 项性能包仍为历史证据，没有新 G5/G5-SIM。T6.12 保持 in_progress，无提交推送。

## 2026-09-16 已确认安装，等待 macOS Touch ID

用户确认上述独立只读 App 安装、AX 授权及一次宿主观察范围。源文件清单/签名核对通过，目标不存在后新建安装到 `~/.itestagent/helpers/xcode-memory-console-probe/iTestAgentMemoryConsoleProbe.app`，复制后所有文件哈希及严格签名核验通过。未覆盖旧 helper。安装证据 `/private/tmp/itestagent-console-capability-probe/installation-result.json`。

已通过 CUA 打开系统设置→Privacy & Security→Accessibility，点击 Add 后系统要求 Touch ID 或用户密码解锁。现等待用户完成系统身份验证；尚未选择/添加新 App，因此不能宣称 AX 权限已授予。临时宿主工程及可执行哈希仍匹配，尚未启动 Xcode、进行安装后的 trusted preflight 或消费一次宿主观察额度。解锁后继续添加固定新路径，并运行已准备的 installed-preflight.ts；不需要重新确认相同范围。T6.12 仍 in_progress；无生产代码/设备/提交推送，diff 与任务 JSON 检查通过。

## 2026-09-16 只读原生能力探针：候选完成，新增权限待确认

当前缺口是实际 Xcode 控件是否公开支持 AXSelectedText 与 AXConfirm；CUA Return 成功、合成提交测试通过均不能回答该问题。本轮在临时目录完成独立只读探针，不链接提交适配器、不调用 AXSetAttributeValue/AXPerformAction/键盘注入，不执行任何 LLDB 命令。

临时候选：`/private/tmp/itestagent-console-capability-probe/iTestAgentMemoryConsoleProbe.app`，bundle ID `com.itestagent.memory-console-probe`，版本 0.1.0；源码及依赖快照位于同目录 `review-sources/`，全部文件哈希见 `review-manifest.json`。签名后可执行 SHA256：`dcbe90837f036a49a458d96158a7a8526493a2dbae831529c7ed2d4898a97ecf`。swiftc -warnings-as-errors 编译与 codesign --verify --strict 均通过；此为临时验证候选，没有改变已安装 0.2.0 helper。

探针只读取受限 AX 控件元数据、可写性和动作列表；空 prompt 最多读取 7 个 UTF-16 单元，输出范围能力最多读取 1 个单元，内容不输出。窗口/文档/焦点/进程实例须匹配；读取限 512 节点、16 层、64 子节点，AX 消息期限 0.25 秒、观察期限 10 秒。结果只含请求号、固定状态及能力布尔值，targetVerified 始终 false。观察模式仅识别外部已确认的宿主会话，不接管或终止 Xcode，不能作为生产 owner 证明。

App 使用独占 0700 的 memory-request-UUID 目录；可选 observation.json 仅含匹配请求号、PID 字符串和工程路径，不接受命令。结果以目录描述符/openat、O_EXCL/O_NOFOLLOW、0600 写入。没有输入文件即只检查 AXIsProcessTrusted，不请求权限、不读取 Xcode。CLI 在沙箱内外均 blocked/accessibility_unavailable；App 经既有 launcher 独立启动后同样 blocked，exit0、cleanupVerified=true，无 stderr。App 请求号 `27aa9239-daae-4f65-80c9-9b8b5dfe2c35`，证据 `/private/tmp/itestagent-console-capability-probe/app-preflight.json`。本轮未启动 Xcode 或执行任何设备动作。

### 待确认的具体操作

1. 核对上述清单和签名后，将该候选复制到新目录 `~/.itestagent/helpers/xcode-memory-console-probe/iTestAgentMemoryConsoleProbe.app`。若目标已存在或源哈希变化，停止，不覆盖。原 xcode-memory helper 保持原状。复制后再次验证全部文件哈希/签名。
2. 用户通过 macOS 为这个固定路径的独立 App 授予辅助功能权限；不关闭系统保护、不重置 TCC、不沿用旧 helper 的身份。macOS 授权属于该 App，可能持续有效，单次观察额度不会自动撤销系统权限；本次不授权以后替换或扩展这个 App。
3. 授权后先进行同样的只读 App preflight。仍不可信即停止。然后最多一次 macOS 宿主观察：先确认 Xcode 未运行，复核 `/private/tmp/itestagent-xcode-length-fixture.json` 所定位的 MemoryIdentityProbe 工程及已构建二进制 SHA256 `d239145b49c89487139caa000c8cfd64df6a3fc244fe809c4b9a9b39c06d400b`。若文件已清理/哈希变化/存在用户 Xcode，不重建或接管。
4. 使用现有 CUA 打开唯一临时工程，确认 MemoryIdentityProbe/My Mac，最多一次 Run Without Building/Pause，并聚焦可见的空 LLDB 输入。要求构建、出现权限/保存提示或上下文不明即停止。以本次 PID/工程路径运行只读探针一次，外部 launcher 最长 15 秒；不写入命令、不执行 AXConfirm、不按 Return，不因能力缺失重试。
5. 一次 Resume 后等待 fixture 既有 60 秒 alarm 正常退出，关闭所属工程并正常 Quit。独立检查已记录宿主/RPC/Xcode 退出，不把无窗口当退出、不强杀共享进程。总流程最多五分钟；取消不开始新动作，正常收口本次所属资源，无法确认则如实记录。

本次确认只覆盖上述新 App 安装、该 App 辅助功能授权和一次无设备只读宿主观察。结果仅证明当时的能力枚举，不证明实际提交、物理绑定或完整 capture。后续提交验证需具体范围；不自动运行生产提交器，不涉及 iPhone/Simulator、capture/export、baseline、commit/push。T6.12 保持 in_progress。

本轮只有临时候选和文档变更，沿用此前 259 项性能包门禁作为历史证据；没有重跑全库，也没有新增 G5/G5-SIM 结论。

## 2026-09-16 短加载在 Xcode 返回完整身份，宿主匹配与退出通过

用户继续后完成一次已限定 Xcode 短加载验证。预先核对只读、非符号链接固定源码 SHA256 与既有 fixture 可执行哈希，初始 Xcode 未运行。仅打开新临时 MemoryIdentityProbe/My Mac，以一次 Run Without Building 启动并 Pause。短 ACK 经一次 Return 返回并通过生产严格解析；重新核对空输入与焦点后，提交 144 字符固定 runpy 加载命令一次，返回恰好一条同请求号、status=observed 的完整身份响应。没有重试或第三条命令。

生产 parseMemoryDebuggerIdentity 校验通过，宿主路径经 realpath 匹配既有 fixture，主模块 UUID 与 xcrun dwarfdump --uuid 实际产物一致；独立 ps 核对返回 PID 属于本次 fixture，LLDB RPC 是本次 Xcode 的直属子进程。这是单次宿主关联证据，不证明跨时刻 PID 连续性、物理设备 ID/bundle/构建绑定或原生 helper 提交可靠性。本次未做第二次身份查询，不能宣称同会话两次身份稳定已在 Xcode 复验。

一次 Resume 后 Finished running，无需 Stop。关闭工程后 CUA getAXState 返回 noWindowsAvailable，未重新启动或恢复窗口；正常 Quit 后独立 ps 确认本次宿主/RPC/Xcode 均不存在，最终应用清单 isRunning=false。没有将 noWindowsAvailable 本身当完整清理证明。launch=1、pause=1、Return=2、resume=1、stop=0。

证据：`/private/tmp/itestagent-loader-identity-response.txt`（仅白名单元数据、本地）、`/private/tmp/itestagent-loader-identity-validation.json`、`/private/tmp/itestagent-xcode-loader-owner.json`、`/private/tmp/itestagent-xcode-loader-result.json`。固定源码哈希 79db65f1e0287380150d12bb5a931e826b210ced13de0c2623c61f8cf837a3c7，宿主产物哈希 d239145b49c89487139caa000c8cfd64df6a3fc244fe809c4b9a9b39c06d400b。

短加载是已取得一次 Xcode 实证的候选，解决本次完整身份响应获取；不能据此断言此前长命令失败的精确根因或长度阈值。下一实施单元应把固定脚本来源/完整性、短加载命令与严格响应/owner 身份复查接到独立 helper，保持失败关闭、取消与资源清理门禁；临时源文件和 CUA 不能直接充当生产实现，也不自动升级已安装 helper。后续仍须原生通道验证、物理目标绑定、capture/export、生产接线及 G5。

本轮无生产代码变更、无构建/设备/权限/helper/baseline 动作，未提交推送。JSON 与 diff 校验通过；既有 255 项性能包证据仍为历史检查，未宣称重跑。T6.12 保持 in_progress。

## 2026-09-16 短加载 Xcode 验证范围

用户继续后验证已准备的 144 字符固定 runpy 加载命令。已复核只读非符号链接源码 SHA256 与既有 macOS 夹具二进制哈希，不构建。限一次 Run Without Building/Pause，先提交新短 ACK，严格通过并重新核对空输入与焦点后执行一次完整身份查询；两次 Return 上限、五分钟期限，无重试。固定源码只读取元数据，白名单响应留本地；核对请求、主模块/宿主可执行路径及公开 LLDB 身份字段，不访问目标内存。一次 Resume、必要时一次所属 Stop，正常关闭文档/Xcode，独立检查所属进程退出。存在用户 Xcode 即停止，不接管。无设备、权限、固定 helper 或提交推送。沿用“无法独立排除 PID 重用/目标漂移则不发布诊断，不能只看标题或摘要 PID。”成功仅证明一次 CUA 宿主查询，不能证明独立 helper 或物理绑定。

## 2026-09-16 独立回执未出现；144 字符固定脚本加载候选通过 CLI 身份对照

一次同会话短/长对照已完成。初始 Xcode 未运行，只打开哈希已复核的新临时 macOS 工程/My Mac；一次 Run Without Building/Pause。144 字符短 ACK 严格解析成功，确认独占目录的 xcode-receipt 不存在后，在空输入框写入 1803 字符命令并按第二次 Return。该命令仅独占写固定 UUID 回执并打印 ACK，不读目标数据。没有匹配输出，也没有回执文件，收口后仍不存在；不能用 CLI 的另一 cli-receipt 文件替代 Xcode 证据。

完整 AX 按控件区分后观察到：长命令位于 Console 输出区，debug console 输入控件为空，当前焦点仍为该输入控件；未观察到 SyntaxError/Traceback/NameError/PermissionError/FileExistsError/error:。因此“命令仍可见”不足以推断它留在输入区。没有文件不能区分提交后处理阻塞和执行失败；也不能仅解释为 ACK 显示遗漏。没有第三次提交或重试。一次 Resume 后 Finished running，正常关闭工程/Xcode；本次宿主、直属 LLDB RPC、Xcode PID 独立检查均不存在，应用清单 isRunning=false。摘要 `/private/tmp/itestagent-xcode-receipt-result.json`，准备 `/private/tmp/itestagent-xcode-receipt-review.json`。

随后仅在独立 CLI LLDB 评估短加载候选：将随包固定 Python 源码原样复制到独占 0700 临时目录，以 0400 新文件保存；固定 `runpy.run_path(...)["emit"]` 命令为 144 字符，调用仍只提供本轮 UUID，完整字段及拒绝逻辑不变。原源码 SHA256 79db65f1e0287380150d12bb5a931e826b210ced13de0c2623c61f8cf837a3c7。真实 LLDB 同一进程的原命令与短加载命令经生产解析器校验身份一致，重启后实例改变，原夹具退出/缺失目标保护及所属清理通过。exit 0、stderr 空。证据 `/private/tmp/itestagent-loader-cli-result.json`；下一 Xcode 候选准备 `/private/tmp/itestagent-xcode-loader-review.json`，xcodeExecuted=false。

CLI 前两次沙箱内尝试失败：首次缺少夹具结果文件，补充诊断后定位为 fixture.launch_failed，后续 fixture 未定义；LLDB 本身仍 exit 0，不能仅看退出码判成功。首次后独立检查未遗留宿主或 LLDB。经工具审核授权在沙箱外执行同一夹具后通过，支持启动环境差异的解释；未放宽成功条件。临时诊断保留失败记录，不将前两次计为通过。

下一步是单次 Xcode 验证这个短加载候选，再决定独立 helper 的固定源码路径、完整性与生命周期接线；CLI 成功不证明 Xcode 或生产能力。临时只读文件不是对同用户恶意修改的安全隔离，不能作为最终可信安装机制。本轮没有修改生产代码、安装 helper、操作设备/权限或提交推送；JSON 与 diff 校验通过，历史 255 项包测试未重跑。T6.12 保持 in_progress，完整捕获、目标绑定和生产 G5 尚未完成。

## 2026-09-16 独立固定文件回执对照范围

用户继续后，本次在同一既有且哈希匹配的新 macOS fixture 会话验证 144 字符短 ACK，然后验证 1803 字符固定回执命令。后者仅以独占创建模式向新建 0700 临时目录的固定 xcode-receipt 文件写本轮 UUID，不读取目标/用户文件；无覆盖、无目标状态访问。对照前确认该文件不存在；用 lstat/精确内容和本轮目录验证独立回执。CLI 使用不同 cli-receipt 路径已验证固定输出与文件内容，不能把 CLI 文件当 Xcode 执行证据。准备文件 `/private/tmp/itestagent-xcode-receipt-review.json`。

一次 Run Without Building/Pause，总限五分钟；短 ACK 严格匹配、空输入/焦点验证后才可发第二条；最多两次 Return，无重试。短命令失败即收口。长命令的独立回执与 AX 响应分别记录，缺少回执不能单独区分未提交和执行失败。一次 Resume、必要时一次所属 Stop，正常关闭工程/Xcode并独立核验进程退出。无构建、设备、权限、固定 helper 或提交推送。沿用约束：“无法独立排除 PID 重用/目标漂移则不发布诊断，不能只看标题或摘要 PID。”回执仅证明这段固定宿主代码曾执行，不是身份或生产 readiness。

## 2026-09-16 等长固定 ACK 也未获 Xcode 响应

恢复检查发现历史临时根路径仅余目录，旧源码、工程文件和可执行文件已不存在。未启动旧工程；在新独占临时根恢复同样仅 alarm(60)+pause 的 C 程序，显式 macOS、独占 DerivedData、CODE_SIGNING_ALLOWED=NO 预构建一次成功。新产物 SHA256 为 d239145b49c89487139caa000c8cfd64df6a3fc244fe809c4b9a9b39c06d400b；位置记录于 `/private/tmp/itestagent-xcode-length-fixture.json`，不当作历史相同二进制。

先行无目标 CLI LLDB 对照：1803 字符固定 ACK（短 print 加无行为注释，与旧 compact 查询等长）及 2220 字符阶段查询全部固定 ACK 通过严格匹配，exit 0、stderr 空。阶段查询在原样 compact 源码加载前/后及 emit 返回后打印固定请求标记，未减少身份校验。准备与结果位于 `/private/tmp/itestagent-xcode-length-review.json`、`/private/tmp/itestagent-xcode-length-cli-result.json`。

随后一次 Xcode 对照：初始用正确 id 字段确认 Xcode 未运行；仅 Welcome，新临时工程/My Mac 核对后 Run Without Building 一次，Pause 后聚焦空 LLDB 输入。1803 字符原文写入、焦点核对后一次 Return；即时与完整 AX 状态均无匹配 ACK，生产解析器判定 false，只有一个可见提示符、命令仍可见。未提交第二条阶段查询，未重试，没有目标身份读取。完整查询内容不是出现“无响应”现象的必要条件；长度/布局相关的提交或输出观察问题优先，但没有证明精确长度阈值，也不能确定命令完全未执行。短命令成功证据来自上轮，夹具已重建，不宣称本轮进行了同会话短/长配对。

一次 Resume 后宿主自然 Finished running，无需 Stop；正常关闭文档/Xcode，独立 ps 核对本次 Xcode/直属 LLDB RPC/宿主均不存在，最终应用清单 isRunning=false。计数 launch=1、pause=1、Return=1、resume=1、stop=0；结论 long_fixed_ack_unverified。摘要 `/private/tmp/itestagent-xcode-length-result.json`，owner `/private/tmp/itestagent-xcode-length-owner.json`。

当前缺口优先为长命令提交/输出观察。后续应先对同会话输入/响应边界建立可靠观测，再评估固定源码短加载方案；不能因短 ACK 成功就切换生产门禁或放宽身份条件。本轮无生产代码变更；CLI 固定 ACK 检查、临时构建、JSON 和 diff 校验通过，255 项性能包测试仍是历史证据，未宣称重跑。未操作设备、权限、固定 helper 或提交推送。T6.12 in_progress，物理绑定、capture/export、全资源清理与生产 G5 仍未完成。

2026-09-16 前置修正：旧临时路径仅剩空目录，源码、工程文件、既有二进制与审阅 JSON 已不存在，未启动旧工程。当前“继续”范围内先在新建独占临时目录恢复相同 alarm(60)+pause 的 macOS C 夹具，显式 macOS destination、独占 DerivedData、禁止签名完成一次预构建；不修改任何用户 iOS 项目。随后 GUI 仍限一次 Run Without Building，若提示再次构建则取消。新根路径记录于 `/private/tmp/itestagent-xcode-length-fixture.json`；其哈希为新构建审计，不能冒充历史二进制。

## 2026-09-16 长 ACK 与阶段标记诊断范围

用户“继续”后，从最后已验证位置执行一个有界宿主对照。第一条是固定 ACK 加无行为注释，总长 1803 字符，与历史 compact 查询等长；若严格通过，再提交 2220 字符阶段查询，在同一原样 compact 源码加载前、加载后、emit 返回后分别打印新 UUID 固定 ACK，身份读取语义保持不变。先行无目标 CLI LLDB 已验证所有四个 ACK（exit 0、stderr 空）；目标不创建。准备文件 `/private/tmp/itestagent-xcode-length-review.json`，CLI 摘要 `/private/tmp/itestagent-xcode-length-cli-result.json`。

本次限已核对原哈希的同一 macOS fixture，一次 Run Without Building/Pause、最多两次 Return、五分钟总上限。第一条失败则不提交第二条，不重试。仅白名单响应进入模型；不读取目标表达式、堆栈、内存。一次 Resume，必要时一次所属 Stop，正常关闭文档/Xcode，并独立检查所有所属进程退出；既有 Xcode/用户会话则不接管。无构建、设备、权限、固定 helper、baseline 或 commit/push 动作。两条 ACK/阶段标记只诊断传输，不提供物理绑定或生产就绪证明。

## 2026-09-09 固定 ACK 多语句与 exec 对照通过

独立无目标 CLI LLDB 与一次 Xcode/My Mac 宿主会话均验证：150 字符 `script pass; print(...)` 与 174 字符 `script exec(...)` 各返回一条固定 ACK，分别通过生产 parseMemoryConsoleAck 的严格请求匹配。第二条仅在第一条通过、输入恢复为空且焦点核对后提交。没有目标元数据读取，未进行第三次提交。不能再把“多语句或 exec 一概不被 Xcode 接受”作为根因；完整身份脚本的长度、内容或输出通道仍未区分，短 ACK 不证明完整查询执行或身份绑定。

本轮 launch=1、pause=1、ReturnAttempt=2、resume=1、stop=0。Resume 后 Finished running，正常关闭所属工程及 Xcode；独立进程检查确认本次 Xcode、直属 LLDB RPC、宿主均已退出，应用清单确认 Xcode isRunning=false。初始应用清单过滤误用了 bundleId 字段，空结果不能单独证明初始未运行；随后打开时仅 Welcome、无恢复工程或调试会话。后续 inventory 必须使用实际 id 字段。既有 fixture 哈希一致，无构建、设备、权限、helper 或提交推送动作。

证据：`/private/tmp/itestagent-xcode-syntax-lldb-result.json`、`/private/tmp/itestagent-xcode-syntax-result.json`、`/private/tmp/itestagent-syntax-first-response.txt`、`/private/tmp/itestagent-syntax-second-response.txt`。本轮仅诊断与文档，沿用最近 255 pass 的代码门禁，JSON 及 git diff --check 校验。T6.12 保持 in_progress；下一缺口是完整固定身份脚本的提交/输出，生产捕获、物理绑定和 G5 尚未完成。

## 2026-09-09 固定 ACK 语法对照范围

用户“好的请执行下一步”授权本次语法对照：同一既有 macOS fixture，仅一次 Run Without Building / Pause，依次提交多语句固定 ACK（150 字符）与 exec 固定 ACK（174 字符）；第一条严格匹配后才提交第二条，最多两次 Return。独立 CLI LLDB 已验证两条均可解析，不创建目标。命令不读取目标状态；总计五分钟内，一次 Resume、必要时一次所属 Stop，正常关闭工程和 Xcode 并独立检查进程退出。不重建、不重试、不操作设备、权限或固定 helper，不提交推送。原规则“无法独立排除 PID 重用/目标漂移则不发布诊断，不能只看标题或摘要 PID。”继续适用，ACK 不构成身份门禁。

# T6.12 B：Xcode 控制台公开操作检查

## 最新：等价短封装在 LLDB 通过，Xcode 对照仍无身份响应（2026-09-09）

已增加实验性 memoryCompactIdentityConsoleCommand，使用内置 zlib/base64 编码原样源码，调用方仍只能传请求 UUID。原命令保持不变。单测解压后逐字节比较随包源码；真实独立 LLDB 在同一进程中先执行原命令、再执行短封装，除请求号外完整身份响应相等，随后原有换世代/退出验证继续通过。长度 4897→1803 字符，单行且小于 2048；不减少身份字段或校验，不接收任意代码/路径，不自动用于生产。

门禁：全部 opt-in 宿主性能包 255 pass/0 fail、1587 assertions、33 文件、93.05 秒；typecheck、lint（932 文件）、git diff --check 通过。首次类型检查发现测试对可空 first 展开后字段变为 optional，已将比较放到存在性检查之后并复检通过。日志 `/private/tmp/itestagent-compact-query-package.log`、`/private/tmp/itestagent-compact-query-types.log`、`/private/tmp/itestagent-compact-query-lint.log`。

随后按本轮已明确范围执行一次 Xcode 对照：初始无 Xcode，唯一临时工程/既有哈希/My Mac 核对，一次 Run Without Building+Pause。空 LLDB 输入中的新 ACK 经一次 Return 返回并通过严格解析；再次核对空提示符和焦点后，写入 1803 字符短身份查询并按第二次 Return。即时与后续完整状态均无固定前缀身份响应，原命令仍可见，没有观察到 SyntaxError/Traceback/invalid syntax。没有第三条请求或重试。

一次 Resume 后宿主 Finished running，正常关闭本工程和 Xcode，无需 Stop。独立 ps 记录的 Xcode/直属 LLDB RPC/宿主均不存在，最终应用清单 Xcode isRunning=false。固定摘要 `/private/tmp/itestagent-xcode-console-compact-result.json`、owner 快照 `/private/tmp/itestagent-xcode-compact-owner.json`、ACK 白名单响应 `/private/tmp/itestagent-compact-ack-response.txt`。结论 compact_identity_unverified；launch=1、pause=1、ReturnAttempt=2、ACK=true、identityResponses=0、resume=1、stop=0。

缩短封装尚未解决 Xcode 结果缺失，不能断言 4096 字符阈值或把此候选当修复。继续区分更短输入形态、多语句/exec 提交和脚本输出路径；后续实验必须保持固定语义与单次限额，不能以 ACK 或 CLI 成功设置生产 submissionVerified。此候选保留用于受控对照，当前未接固定 helper、PermissionEngine 或生产入口。T6.12 in_progress；物理绑定、capture/export、全资源清理与 G5 尚未完成，无设备/helper/权限/baseline 动作，未提交推送。

## 当前：等价短封装与限定对照（2026-09-09）

用户要求执行下一步后，在已确认 B 范围增加候选 memoryCompactIdentityConsoleCommand。使用标准 zlib/base64 传输完全相同的已随包源码，原始查询保留作对照；不接受外部脚本、路径或目标表达式。字节相等测试及同一无设备 LLDB 的原始/短封装完整响应对比用于先验证等价性，不能预称 Xcode 已修复。长度由 4897 降至 1803 字符；不据此断言 Xcode 存在 4096 阈值。

在本轮检查通过后，以当前“执行下一步”接续一次同范围 Xcode 对照：原唯一临时工程/既有产物/My Mac，一次 Run Without Building + Pause，空 LLDB 输入提交一次新 ACK，严格匹配后才提交一次等价短身份查询；合计两次 Return 上限。一次 Resume、必要时一次所属 Stop、关闭项目和 Xcode并独立核验退出，五分钟预算；任何未知焦点/响应即停止，无重试、构建、设备、权限或 helper 升级。准备文件 `/private/tmp/itestagent-xcode-console-compact-review.json`，执行前为 executed=false。本对照只改变固定查询传输封装，不改变元数据访问语义或身份门禁。

## 最新：Xcode 短 ACK 实证通过，完整身份查询仍未验证（2026-09-09）

用户明确要求执行下一步后，完成一次限定 ACK-first 宿主检查。初始 Xcode 未运行；只有 Welcome，无恢复用户工程。复核临时工程及原 Debug 可执行哈希一致，选择 MemoryIdentityProbe/My Mac，以一次 Run Without Building 启动并 Pause。没有构建、签名或设备动作。

暂停后 debug console 显示空 `(lldb)` 并可聚焦。写入 144 字符固定 ACK，核对完整内容和焦点后按一次 Return，得到一条同 UUID 的 protocolVersion=1/status=acknowledged 响应。响应写入 `/private/tmp/itestagent-xcode-ack-response.txt`，通过生产 parseMemoryConsoleAck 严格校验，随后再次观察到空提示符。因此本轮已证明这条短命令经 CUA 在 Xcode 提交并取得响应；不是仅从按键成功或文本可写推导。

ACK 成功后才写入第二条完整固定身份查询，核对原文与焦点后按第二次 Return。随后及最后完整 AX 状态检查没有匹配的身份响应，完整原命令仍可见，未观察到 SyntaxError/Traceback/invalid syntax。不能确认身份查询已执行，也不把未见错误当成功。此次没有重复请求、替换按键、改写脚本或追加第三条命令。

一次 Resume 后宿主 Finished running，关闭所属工程回到 Welcome 并正常退出 Xcode，无需 Stop。独立 ps 确认本次 Xcode、直属 LLDB RPC 和宿主 PID 均不存在，Xcode 可执行进程不存在，最终应用清单 isRunning=false。固定摘要 `/private/tmp/itestagent-xcode-console-ack-result.json`、owner 快照 `/private/tmp/itestagent-xcode-ack-owner-snapshot.json`。计数：launch=1、pause=1、write=2、ReturnAttempt=2、ACK validated=true、identityResponses=0、resume=1、stop=0；结论 ack_passed_identity_unverified。

这将缺口从一般键盘/控制台可达性缩小到完整查询的提交或输出路径。后续假设按证据排序：较长的内嵌源码/输入形态影响 Xcode 提交；Python 脚本输出通道与短 print 不同；未捕获的执行或显示错误。尚未确认根因，不能直接把压缩命令、模块加载或其他传输方案作为已验证修复。下一步可先在无设备 LLDB 比较保持相同元数据语义的短封装，再提出明确的一次 Xcode 对照，不自动重跑当前会话。

本轮仅宿主验证与文档更新，沿用 254 项性能包/typecheck/lint 证据，不宣称本次重跑或 G5。ACK 不证明身份、原生 helper 可靠性或 capture ready；物理绑定、capture/export、全资源清理和生产接线仍未完成。T6.12 in_progress，未操作 iPhone/Simulator、helper、权限、baseline 或提交推送。

## 最新：原生按键对照通过，短 ACK 通道已实现（2026-09-09）

本轮没有启动 Xcode，先用独立、60 秒自动退出的 NSTextView 宿主对照验证 Computer Use 输入。夹具只接收固定文字 itestagent-fixed-probe，记录按键/换行计数、文本长度、固定文字匹配和前台/焦点布尔值，不执行 LLDB 或目标命令。最终 paste + 一次 Return 得到 keyDownCount=1、returnKeyCount=1、newlineCount=1、textLength=23、expectedText/firstResponder/applicationActive 均 true。正常 Quit 后精确进程路径不存在，专用 Finder 窗口关闭；Xcode 仍未运行。

夹具调试失败完整保留：初始有四份本次 probe 启动崩溃报告，根因为 NSTextView 便利初始化器回调未实现的 designated initializer；改用 designated initializer 后仍缺少文本存储/布局与标准 Edit 菜单，出现 paste 超时、文字事件到达但文本长度为零。补齐 NSTextStorage/NSLayoutManager/NSTextContainer 与 Edit/Paste 后才得到上述有效对照。失败夹具不算 Xcode 或输入行为证据，不将首次未见进程误称从未启动。最终临时源码 `/private/tmp/itestagent-input-probe-nquoklej/probe.swift`，SHA256 `0b430daaaf1c4f46edfa6547f36a49adcd8fdd780455fab1605add611d94a79f`；固定摘要 `/private/tmp/itestagent-input-probe-summary.json`。

此结果只排除 Return 在所有原生视图中都失效，不能证明 Xcode 的特殊控制台提交。依据 [Apple debug area](https://help.apple.com/xcode/mac/current/en.lproj/devda5478599.html) 和 [LLDB embedded Python](https://lldb.llvm.org/use/tutorials/python-embedded-interpreter.html)，控制台/脚本输出仍需单独验证，不能从一般 AppKit 对照推导。

已在既有内部 TypeScript 模块增加 memoryConsoleAckCommand/parseMemoryConsoleAck：命令只执行固定 print，输出协议版本、请求 UUID、acknowledged；不访问 lldb 对象或任何目标。当前命令 144 字符，与完整身份查询解耦。严格解析要求固定行前缀、最大 256 bytes、同一请求及无额外字段；命令回显、旧请求、重复行、额外 targetVerified、错误状态等拒绝。ACK 不能由身份解析器接受，不能释放 lease、宣称进程身份或捕获就绪。

真实公开 LLDB 测试在创建目标前执行该短 ACK，取得恰好一条匹配响应，再继续既有进程身份/退出验证。最终全部 opt-in 性能包 254 pass/0 fail，1580 assertions、33 文件、52.01 秒；typecheck、lint（932 文件）、git diff --check 通过。日志 `/private/tmp/itestagent-console-ack-package.log`。这是独立 LLDB 宿主证据，尚未在 Xcode 控制台执行新 ACK。

下一次具体探针已准备于 `/private/tmp/itestagent-xcode-console-ack-review.json`（0600，executed=false）：新的 ACK UUID 和身份 UUID。建议下一次限定沿用唯一 macOS 工程/既有产物/My Mac，一次启动与 Pause，先提交一次短 ACK；只有得到严格匹配响应才提交一次完整身份查询。总共最多两条固定命令、两次 Return；未知焦点/响应即停止，无键盘替换、无自动重试；同一会话一次 Resume，必要时一次 Stop，正常关闭与独立退出核验、五分钟上限继续适用。当前未执行此探针，不消费旧探针的额度或宣称 UI 提交已解决。T6.12 保持 in_progress，生产原生接线与 G5 仍未完成；未操作设备/helper/权限或提交推送。

## 最新：暂停态输入已定位，Return 响应仍未验证（2026-09-09）

按用户“继续下一步”执行已明确的单次暂停态范围。初始 Xcode 未运行；唯一临时工程的 MemoryIdentityProbe/My Mac 与既有产物核对通过。一次 Run Without Building 后点击一次 Pause；公开 AX 显示 Paused、Continue，并在 debug console 中出现 `(lldb)` 空提示符。聚焦该区域后，第一条固定命令通过 paste 写入，AX 核对完整命令、新请求 UUID 和同一 debug console 焦点均匹配，再调用一次 Return。

Return 调用后及恢复前后的状态检查均未提取到匹配 requestId 的固定前缀 JSON 响应。最终可见文本仍含完整原命令，只有一个 `(lldb)` 和一次请求 UUID，没有显式截断标记；没有把命令回显或 Return 工具成功当作执行证明。第二条未写入、未提交。结论为 response_unverified：只验证暂停态输入区可辨识/可聚焦及固定命令可写，不确认查询执行、Return 提交生效、进程身份一致或独立 helper 能力。

随后在同一工程使用一次 Continue/Resume，观察 Finished running 与 Stop disabled，无需 Stop；关闭所属工程回到 Welcome，正常退出 Xcode。独立 ps 确认本轮记录的宿主、直属 LLDB RPC、Xcode 均不存在，最终应用清单 Xcode isRunning=false。未重启、未强退、未发生权限或保存提示。本机摘要 `/private/tmp/itestagent-xcode-console-paused-result.json`，owner 快照 `/private/tmp/itestagent-xcode-paused-owner-snapshot.json`，固定前缀提取结果为空。动作计数：launch=1、pause=1、queryWrite=1、ReturnAttempt=1、matchedResponse=0、resume=1、stop=0。ReturnAttempt 不是 confirmedQueryExecution。

下一调查按证据排序：Return 在该控件未形成可验证的提交（原命令仍可见、无新提示符）；Xcode 的脚本输出通道未由当前 AX 表示提供；请求执行或显示发生了未观察到的异常。尚无依据选择生产适配方案，不改写命令、不切换按键或自动重跑。后续先审计现有控制台元数据/提交通道，再提出具体有界验证；当前授权额度已消费。物理目标绑定、原生提交与响应 transport、capture/export、完整清理及 G5 仍待完成。

本次只有宿主探针和文档更新，无生产代码变更，沿用已有 253 项性能包/typecheck/lint 记录，不宣称本次重跑。T6.12 in_progress；未操作 iPhone/Simulator、helper、权限、baseline 或提交推送。

## Current: one paused host inspection (2026-09-09)

The user's request to continue the next step resumes the previously proposed paused-host probe. Bound scope: the existing temporary MemoryIdentityProbe project and binary, My Mac, one Run Without Building and one public Pause. Submit at most two fixed metadata requests, each with one Return, only after identifying the LLDB prompt and empty input in the same focused window. A missing or invalid first response blocks the second. Fresh request IDs are in `/private/tmp/itestagent-xcode-console-paused-review.json`. No rebuild, restart, device switch, arbitrary debugger command or permission change.

Do not inspect stacks or memory. Retain only input capability and fixed-prefix metadata. For cleanup, use at most one Resume in the same owned session so the existing alarm can run; if still alive, one owned Stop is allowed, followed by normal project close and Xcode quit. Unknown ownership/windows/save dialogs block active cleanup. No force kill, five-minute total limit, and timeout is not cleanup proof. These host actions do not authorize physical production execution.

Initial inventory confirms Xcode is not running and the existing executable hash matches. Results pending; CUA success would not prove native helper submission or G5.

## 最新：已授权 Return 探针收口，输入控件未验证（2026-09-09）

用户确认后执行一次限定宿主检查。初始应用清单 Xcode isRunning=false；启动只有 Welcome，无恢复用户工程。既有二进制 SHA256 与审阅值一致。打开唯一临时 MemoryIdentityProbe 工程，核对 scheme/My Mac，执行一次 Run Without Building，无重建、签名或设备动作。出现 Running、Pause 和 Stop，证明本次宿主启动。

提交前检查发现：公开 AX 中的 debug console 控件点击返回 cannotClickOffscreenElement；可见 Console 可聚焦，但截图与 AX 没有可辨认的 LLDB 命令提示符或独立输入区，无法排除它是 AUT 的标准输入区域。因此按方案停止：查询写入 0 次、Return 提交 0 次，没有以可写区域推断 LLDB 输入，没有向未知焦点发送命令。不能称为查询执行失败，也不能称已验证 Return 提交。

随后观察到 Finished running、Stop disabled，未按 Stop 或发出终止命令；关闭所属工程回到 Welcome，再正常退出 Xcode。独立 ps 确认本次记录的 Xcode/直属 LLDB RPC/已知宿主 PID 均不存在，Xcode 可执行进程亦不存在；最终应用清单 isRunning=false。无保存/权限提示、无强退、无重跑。不能仅凭 PID 消失证明运行身份连续性，但这些观察可用于本次自有宿主的事后退出核验，未转换为生产完整 capture 清理证明。

本地固定摘要 `/private/tmp/itestagent-xcode-console-return-result.json`，owner 快照 `/private/tmp/itestagent-xcode-return-owner-snapshot.json`。结果 reason=lldb_input_not_verified，fixtureLaunches=1，queriesWritten=0，returnSubmissions=0，记录进程及 Xcode 均不存在。候选请求文件未执行；本轮单次启动额度已消费，不再自动运行。

后续调查假设（尚未确认）：运行态 Console 仅提供程序 IO、LLDB 输入在暂停后才显示；debug console 属于当前未显示的子区域；CUA 对控件可见性/输入语义表示有限。第一项与当前 Running/Pause 和无 LLDB 提示符现象最吻合，不能据此直接编码生产适配。下一候选为一次新的 macOS-only 启动后显式 Pause，再核对 LLDB 输入区并最多提交两条原固定查询；Pause 不属于本轮已执行动作，后续需明确新范围。若采用暂停，60 秒 alarm 可能在停止态不能完成清理，下一方案必须明确 Resume/Stop 收口及归属核验，不能简单复用当前自动退出假设。

本轮仅 UI 宿主验证与文档变更，沿用上轮 typecheck/lint/253 项性能包证据，不重跑代码测试或宣称新 G5。T6.12 in_progress；原生提交、物理目标绑定、capture/export、全资源清理及 C/D/E 仍未完成。未操作 iPhone/Simulator、升级 helper、更改权限或提交推送。

## 下一步提案：固定 Return 提交的宿主验证（待确认，2026-09-09）

此前“不能据此引入 CGEvent、AppleScript 或修改 lldbinit/scheme”及禁止未知键盘提交的规则仍有效。本提案请求一个明确、单次的范围变更：允许在下面的隔离 macOS fixture 中，经现有 Computer Use 对已确认的 LLDB 输入控件写入固定元数据查询，并显式按 Return 提交。不是重新消费之前的单次检查授权，不自动扩大到原生 helper、任意键盘注入、设备或生产捕获。

方案对比：继续仅接受已验证 AX 提交动作会保持当前阻断；本次限定 Return 探针可验证 Xcode 的控制台提交语义，但不能证明独立 Swift helper 的 AX/键盘权限、焦点原子性或可靠性。优先先取得这一工具层证据，再决定原生适配方案，不直接用键盘事件替代生产门禁。

已完成可审阅准备：复核临时 main.c 仅 alarm(60)+pause，既有 Debug 可执行文件 SHA256 仍为 `71cd9e0be6099aaf95879e2034c393a13cc88625c212e3b5d4c8ce14f8d3bbd3`。工程为 `/private/tmp/itestagent-xcode-identity-review-roq1kjn4/MemoryIdentityProbe.xcodeproj`，scheme MemoryIdentityProbe、destination My Mac，复用已构建产物。通过生产固定命令构造器准备两条单行请求，各有新 UUID，保存于 `/private/tmp/itestagent-xcode-console-return-review.json`（0600，executed=false）；未执行命令、启动 Xcode 或修改工程。

确认后执行范围：

1. 初始只读检查 Xcode 未运行，无其他实例/恢复工程；有冲突即停止。打开上述唯一临时工程，核对 scheme/My Mac、已有产物哈希，无构建、签名修改、安装或设备切换。
2. 最多一次 Run Without Building；要求 Build & Run、额外权限或出现未知窗口时取消本轮。不重建、不重跑，不使用 iPhone/Simulator。
3. 仅当本工程正在调试、Xcode 前台、已识别的 LLDB 命令输入框被聚焦且输入为空时，写入第一条已准备的固定查询。写入前后重新核对窗口/焦点及本次输入内容，再通过现有 Computer Use 按 Return 一次；若不能可靠区别输入框和控制台输出区则停止。不得覆盖既有命令或向未知焦点发送按键。
4. 必须取得严格可解析且 requestId 匹配的身份行，才允许在同一会话重复上述过程提交第二条。最多两次 Return、两条固定只读查询；任何不匹配、焦点改变、退出、超时或未知结果均停止，不重试。请求实际执行、身份一致、构建模块及宿主可执行路径核对分别记录；可写或按键成功不等于查询成功。
5. 不读目标内存/堆栈、不使用目标表达式、任意 LLDB 命令、AppleScript、修改 lldbinit/scheme 或新 CGEvent 实现。仅提取固定前缀元数据行；不收集设备证据，其他输出不进入报告或模型。
6. 优先等待该自有 fixture 的既有 60 秒 alarm 退出，再关闭所属工程并正常退出本次 Xcode。检查自有宿主、debugger 与 Xcode 的退出；窗口/归属不明、保存提示或未退出则报告清理未确认，不按进程名杀进程、不强退共享 Xcode。取消立即停止新查询，并收口本次所属资源。总检查最多五分钟。

通过标准：两条请求各恰好一条匹配响应，同一 debugger/process instance、PID、主模块 UUID、宿主路径，且所属资源清理有证据。仍只证明一次 CUA 宿主提交语义，不证明物理目标身份或原生 helper 提交可靠性；不设 submissionVerified 为生产常量。若无法得到明确证据，保持不可验证，不扩展动作重试。

此次确认仅授权这一单次宿主探针及其正常关闭，不授权 helper 升级/权限变更、iOS 构建安装、真机工作负载、baseline、commit/push。T6.12 仍 in_progress。

2026-09-09。状态：已授权复检完成；宿主启动成功，公开 AX 提交动作未获证实；已清理。关联 ADR-044 与已确认 B 实现计划。

## 已完成的独立身份查询

新增固定 Python 元数据查询、TypeScript 控制台命令构造与严格响应解析。输入仅为请求 UUID，不接受任意脚本；不执行目标表达式、不读取目标内存、不启动或附加进程。查询读取所选 debugger/process 实例、PID、主模块 UUID、平台/triple、可执行路径，查询末尾复查所选进程；失败返回不可验证。响应为候选，未转换成设备已绑定或 capture ready。

公开 LLDB 宿主 fixture 验证：无进程/退出进程拒绝，同一进程两次身份一致，两次启动的实例 ID 不同；实际顶层控制台固定命令返回两条可解析响应，身份随重启改变；两个自有进程清理通过。独立函数首次验证通过，随后嵌套 `HandleCommand` 的输出收集未取得响应；改用真实顶层命令序列后通过。不能将测试中的嵌套通道假设推广到 Xcode。

接口依据为 [LLDB SBProcess 官方文档](https://lldb.llvm.org/cpp_reference/classlldb_1_1SBProcess.html)及本机 SDK/LLDB 帮助。GetUniqueID 区分同一调试器的进程实例，不是系统启动时间，不独立证明物理设备或构建来源。Xcode owner、选中设备及已确认构建的关联仍待独立实现和验证。

## 为何需要一次 Xcode 检查

已确认 B 计划限定“无设备原生 fixture 可执行；不申请额外 AX 权限或操作真实 Xcode/设备”。当前缺少 Xcode 控制台输入控件的公开 AX 动作证据。不能根据 LLDB 命令可用就猜测 AXConfirm、控件标识或使用键盘注入绕过未知能力。

本次提议仅补这项宿主 UI 能力证据，不做 iPhone 捕获，不升级固定 helper。检查可使用现有 Computer Use 读取公开控件和执行其公开动作来发现能力；此发现不是独立 Swift helper 已通过的证明，后续仍要由原生适配器复验。

## 具体范围

临时审阅工程由 `/private/tmp/itestagent-xcode-identity-review.json` 定位，名称 MemoryIdentityProbe，macOS 命令行目标。已用显式 macOS destination、独占 DerivedData 完成 Debug 构建，尚未在 Xcode App 打开或运行。源码仅设置 60 秒 alarm 并等待，不访问文件、网络、账户或设备。工程及产物不提交版本控制。

确认后只执行一次：

1. 检查 Xcode 是否未运行；若存在用户实例、恢复窗口或其他调试会话，停止，不接管。
2. 打开本临时工程，核对 MemoryIdentityProbe scheme 和 My Mac 目的地，使用现有 Debug 产物 Run Without Building 一次；不能修改目的地为 iPhone/Simulator，不能自动重建或再次启动。
3. 检查控制台输入控件公开角色和支持动作。只在存在明确提交动作且所选目标正确时执行固定身份查询两次，核对相同实例；不读取内存/堆栈，不使用任意 LLDB 命令或目标表达式。公开动作不可用则记录阻断，不能据此引入 CGEvent、AppleScript 或修改 lldbinit/scheme。
4. 停止本次宿主 fixture，关闭所属工程并退出本次 Xcode；出现用户窗口/保存提示或所有权变化则保留状态并报告，不强退共享实例。

全程最多一次宿主启动，60 秒自动退出边界；如查询前已退出，记录本次未完成，不自动再跑。原始 UI/控制台输出只留本地，向模型和文档仅返回白名单动作能力、布尔身份结果和退出状态。总检查限五分钟，取消停止后续动作并收口所属资源。

本次不授予或更改系统辅助功能权限，不构建/安装/启动 iOS App，不重复旧真机工作负载，不改变 baseline，不提交推送。即使成功，T6.12 仍 in_progress，B 原生 capture 与 C/D/E 门禁仍需完成。

## 2026-09-09 一次检查结果与复检准备

用户允许后确认 Xcode 未运行；启动后仅 Welcome 窗口，无恢复用户工程。打开临时工程，公开 AX 显示 MemoryIdentityProbe scheme / My Mac；执行一次 Run Without Building。Xcode 提示该 scheme 没有已构建产物并提供 Build & Run，已选择 Cancel。宿主启动 0 次，固定查询提交 0 次；未进入控制台，不能判断其 AX 提交动作是否存在。关闭所属工程并正常退出 Xcode，应用清单确认 isRunning=false。没有设备动作、权限变更或 helper 升级。

命令行预构建使用独占 DerivedData，而临时工程未声明相同产物目录，存在路径配置缺口。现仅在该临时工程增加 CONFIGURATION_BUILD_DIR=$(PROJECT_DIR)/DerivedData/Build/Products/$(CONFIGURATION)，没有修改 scheme、源码或二进制。只读 showBuildSettings 确认 BUILT_PRODUCTS_DIR / TARGET_BUILD_DIR 指向现有 Debug 产物；未重建或重启。第一次默认缓存目录检查受沙箱写权限限制，随后使用原独占 DerivedData 完成设置核验，不更改全局设置。

本地摘要：/private/tmp/itestagent-xcode-console-inspection-result.json；设置核验：/private/tmp/itestagent-xcode-console-build-settings.log。现有二进制 SHA256：71cd9e0be6099aaf95879e2034c393a13cc88625c212e3b5d4c8ce14f8d3bbd3。

复检具体范围保持上述四步不变：重新确认 Xcode 未运行，仅打开这个已修正临时工程，对 My Mac 执行一次 Run Without Building；若仍要求构建即取消。最多一次宿主启动、60 秒自动退出，仅在公开 AX 明确支持提交时执行两次固定查询，然后关闭自有工程并退出。不得自动再次重试。此前“确认后只执行一次”的额度已用完，因此本次修正后的 Xcode 复检需新的明确授权；当前尚未执行。T6.12 保持 in_progress。

## 2026-09-09 已授权复检结果

用户再次允许后确认 Xcode 未运行，启动仅 Welcome 窗口。打开同一已修正临时工程，核对 MemoryIdentityProbe/My Mac，执行一次 Run Without Building，观察到运行中的调试会话和 Pause/Stop 控件。此次无需重建，产物目录修正解除首次启动阻断。

展开 Debug Area 后，公开 AX 列出两个可写 text entry area：Console 和 debug console，但未列出明确提交动作。未写入命令、未猜测 AXConfirm、未使用键盘提交；固定查询提交 0 次。结论限于本次 CUA 公开 AX 表示，不能断言所有原生 AX 接口均不支持提交。下一实现缺口是独立 helper 对这些控件的公开 AX 属性/动作枚举及可验证提交协议；不得将可写控件视为查询已执行。

点击所属 Stop 后 Xcode 报告 LLDB RPC Server 被终止以便 detach，提示宿主可能需要手动结束。关闭提示后 Stop 禁用，关闭所属工程并正常退出 Xcode。随后只读 ps 检查本次提示的两个 PID，均不存在；应用清单确认 Xcode isRunning=false。没有手动杀进程，没有重启 fixture；无法区分宿主由 Stop 还是既有 60 秒 alarm 退出，不推断调试器异常的根因。

本地布尔摘要：/private/tmp/itestagent-xcode-console-inspection-retry-result.json。宿主启动 1 次，查询 0 次；未操作设备、权限、固定 helper、baseline，未提交推送。未新增生产代码，沿用此前 239 项性能包回归；本次文档与 JSON 校验通过。T6.12 仍 in_progress。此次单次复检已收口，不自动再次执行 Xcode 检查。
