# T6.12 查询IPC与关闭账本：下一离线实现批次

日期：2026-09-17。状态：用户已确认，离线实现与验证通过。决策：[ADR-046](../decisions/ADR-046-memory-query-ipc-and-resource-closure.md)。280 pass/8 skip是上一批证据；本批结果见文末。

## 实现顺序与范围

1. **帧和单次握手**：新增backend `src/xcode-memory-query-protocol.ts`、native `itestagent-memory-query-ipc.swift`；固定schema/version/状态/尺寸/时限/sequence，关联session/request/strategy/命令摘要和内存challenge；分帧、截断、重复、错请求、断连、权限等待取消均失败关闭。授权不写argv/env/磁盘或日志，UI原始值不进入IPC。
2. **无GUI桥和对端身份**：新增query专用launcher及transport，不复用旧preflight launcher的force路径。以Unix socket测试公开peer UID/PID、临时目录/endpoint权限与替换、单连接、迟到/错误peer及父EOF。NSWorkspace启动适配器仅编译；真App身份检查采用注入的fake owner测试，不冒充实际App已验证。stdio单读者解析控制消息并设置后台cancel latch，不能同时启用旧stdin lifetime reader。
3. **PermissionEngine桥**：在engine层新增 `memory-query-permission-wiring.ts`，只调用现PermissionEngine的interact_sensitive_ui；用户展示具体session/请求/固定命令摘要及影响，输出当次绑定决议，禁止remembered allow。Backend接收依赖函数，不反向import engine。未接入默认生产执行路由，测试用真实PermissionEngine而非直接return allow。
4. **资源关闭账本**：新增backend `xcode-memory-resource-closure.ts`，逐资源创建尝试即pending，已有owner观测才能closed；未知与not_created严格区分；helper退出与launcher退出由各自父owner观测。保留v2/owned_app_only，新增内部v3证明路径；有物理identity时保留原强匹配，无身份且AUT/debugger曾尝试创建时禁止释放。lease释放必须消费本轮匹配的、只由验证器产出的终态能力，不接受未经验证JSON。
5. **组合离线验证**：完整prepared→PermissionEngine决议→一次授权→假query→资源关闭→子进程退出；deny/pre-abort/授权期间EOF/发送后断连/缺关闭证明/错身份/迟到launch、重复授权均验证不发送或不重发、不提前释放锁。权限ask取消须清除pending，不能留悬挂Promise。

## 门禁

- Swift warnings-as-errors；TS typecheck/lint。
- 新模块定向测试；真实无GUI socket/pipe与仅自有子进程信号/退出测试。
- backend性能包默认回归、engine权限桥定向回归；App/LLDB opt-in关闭。
- v2 capture/owned_app_only、lease改名/替换、原query/AXConfirm/Return回归。
- 文档、ADR046状态和task notes更新；T6.12保持in_progress，日志只含白名单元数据，不记录grant/challenge原值。

本批不声称完整生产清理已完成：真实工程/调试器/AUT退出观察与物理generation来源仍缺失。新增账本负责拒绝不充分证据，而不是创造证据。本批完成后才能准备真实helper候选；不得升级已授信二进制或直接开展Xcode/设备动作。

## 需确认的技术决定

批准ADR046的独立stdio/Unix socket查询通道，以及v3逐资源关闭证明（允许确证not_created的提前失败、禁止unknown释放），并仅实施上述离线范围。若不批准新关闭证明，就保持现capture lease严格保留，不用App-only绕过。没有未确认前先编码或默认路由变更。


## 实施与验证结果

本批按用户“确认”执行，新增query专用TS/native协议、launcher、compile-only App launch与原生grant接线，engine真实PermissionEngine桥，v3资源账本和lease证明消费入口。新文件均为内部模块，未加入默认生产路由或已安装helper源清单。

- 正常prepared→真实ask→一次allow→假query→closing/closed→helper/launcher实际退出通过；deny不产生query结果。
- 分片、UTF-8非法、超限、截断、重复、错请求/序号、提前result、deny后result、grant复用、owner变化/过期均失败关闭。
- 权限等待期间真实EOF/部分帧使ask取消；预取消、超时、发布ask失败不悬挂；已有deny不弹ask，配置成implicit allow的engine不能批准查询。
- Unix socket真实UID/PID匹配与错误peer、目录/endpoint替换、父stdin EOF/SIGTERM/SIGINT通过。这里只运行临时命令行Process，公开AppKit适配器仅编译。
- pending/unknown、无identity的AUT/debugger、错误target/generation/instance、未观测退出、JSON伪proof及lease替换保留锁；确证未创建目标的提前退出可用本轮证明释放。

完整范围回归：307 pass / 8 skip / 0 fail、2200 assertions、48文件、58.08秒。最后Swift适配器/夹具改动复检：2 pass / 0 fail、57 assertions、18.65秒。Swift warnings-as-errors、typecheck、lint953文件与diff检查通过。8项skip是既有真实App/LLDB opt-in，本轮未开启。日志：`/private/tmp/itestagent-ipc-package.log`、`/private/tmp/itestagent-ipc-final-native.log`、`/private/tmp/itestagent-ipc-typecheck.log`、`/private/tmp/itestagent-ipc-lint.log`。

首轮测试遇到Bun内置mkdir不支持-m，改为node fs.mkdirSync；之后socket联调在沙箱内被拒，检查定位为创建endpoint失败，授权离线测试沙箱外运行后通过。未放宽协议以绕过失败。

### 接续边界

T6.12仍in_progress。真实helper完整入口、TUI展示与生产调用、完整manifest来源、Xcode/document/debugger/AUT关闭观测和physical generation证据仍待完成；本批fake query输出不作为设备候选或capture ready。下一步先准备可审阅的新helper候选及完整资源观测接线方案，再按明确范围实施/授权真实验证；不得复用已消费的Return动作额度或直接运行旧安装包声称验证新IPC。

本轮无App启动、Xcode/设备操作、AX/CGEvent、安装/重签、权限更改或commit/push。已安装Return controller0.1.1、console probe0.1.3和原helper0.2.0二进制SHA256只读复核与已有记录相同。

App adapter最终补强：worker等待main线程的原实例检查亦受deadline/cancel约束，迟到结果不能发送授权；此适配器改动重新以Swift warnings-as-errors仅编译通过。没有新增App运行证据。
