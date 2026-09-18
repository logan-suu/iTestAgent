# T6.12 launcher退出回执离线实现计划

日期：2026-09-17。状态：用户确认整批计划后，离线实现与验证完成。决策：[ADR-047](../decisions/ADR-047-query-launcher-owned-closure-receipt.md)。

## 范围与顺序

1. **v4角色与终态**：backend新增`xcode-memory-query-closure-receipt.ts`及native对应receipt模块；扩展协议/transport的显式v4入口，保留v3。严格区分helper可发帧与launcher终态，禁止helper伪造回执、重复/额外帧、缺EOF或版本降级。
2. **实际观察者接线**：launcher将自身保留的launch对象、实例关联值、签名清单绑定到终态观察器；仅原helper确证退出后发回执，Bun仍独立wait launcher。不用exit0替代回执，不将超时当退出。
3. **固定no-target profile**：候选清单与resolver把受审阅入口映射为无resource-provider profile，绑定源码/入口/完整文件摘要。无provider入口不得prepared/query或创建下游资源；不能通过调用方传bool/profile切换到可释放路径。真实Xcode provider保持不支持该证明。
4. **组合到ledger**：内部验证器接收受控channel的完整终态，生成只属于本轮的一次性能力。协调器只在证据齐备时更新helper/launcher并消费既有lease proof；invalid/unknown/取消保留锁。原capture identity强匹配不变。
5. **测试与文档**：正常no-target→真实无GUI owned child退出→本轮临时lease释放；缺失/伪造/过期/错manifest/错实例/错会话/错角色/截断/额外字节/非零退出/有stderr/lease替换保留锁。验证存在physical identity或任一目标创建尝试时no_target不能释放。补实际取消、迟到回调、证明重复消费及v3回归。

## 质量门禁

Swift warnings-as-errors；新增定向测试；性能包默认回归与engine/TUI已有权限关键回归；typecheck/lint/diff。App/LLDB真实opt-in关闭。测试的fake owner与not_created事实不得冒充真实Xcode/G5证据。

本批只离线编码、无GUI子进程测试和候选源码编译，既有签名候选与安装不变，不更改权限，不启动App/Xcode/设备/AX/Return，不commit/push。确认此整批计划后可连续完成全部单元；不逐文件重复询问。真实App验证另在新候选可审阅后明确次数和清理范围。

## 保留的后续缺口

本批解决“确证没有创建目标的正常提前退出如何释放自身lease”。真实Xcode/document/debugger/AUT创建、完整关闭观察、physical generation和生产TUI真机验收仍待完成。不得把本批当完整T6.12完成，也不要求用户手动导出证据。

## 实现与验证结果

新增单独v4 no-target入口、launcher所属终态回执及候选一次性能力。helper角色decoder拒绝launcher回执/新增绑定字段；v4拒绝prepared/decision/result，v3保持独立。launcher在原helper关闭socket且原owner退出后才发回执，TS验证首次ack至回执的实例/清单一致性、完整EOF和自有launcher真实退出，再消费本轮ledger proof释放lease。固定无provider源码摘要需要明确审阅后更新，不能从任意候选动态生成受信任profile。

| 条件 | 离线证据与结果 |
| --- | --- |
| 正常无目标关闭 | 真实自有无GUI child及Unix socket、原owner退出；本轮临时lease删除，status=unsupported，targetVerified=false |
| 重复消费 | native receipt只可发送一次；TS候选能力和executeOnce不可复用；ledger proof消费后冻结 |
| 来源与绑定不符 | helper伪造回执、prepared、错owner/实例/会话/请求/challenge/manifest、清单漂移均保留锁 |
| 协议不完整 | 缺回执、重复、错版本/序号/scope/字段类型、截断、额外帧、超限、非法UTF-8、空帧均保留锁 |
| 终止不完整 | 原owner退出未知、取消、父EOF导致迟到启动回调路径取消、运行中自有child取消、实际launcher退出延迟/非零退出/stderr均保留锁 |
| 资源/锁边界 | 已创建并关闭的下游资源、物理identity均不能使用no-target scope；替换后的lease保留，原inode防护生效 |
| 候选与兼容 | v4 App适配器warnings-as-errors编译；拒绝未验证签名及重新生成清单后的未审阅源码；v3组合/权限回归通过 |

最终性能包默认回归+engine权限桥：**317 pass / 8 existing opt-in skip / 0 fail，2377 assertions，51文件**。TUI会话/权限回归：**75 pass / 0 fail，299 assertions，2文件**。typecheck、lint（962文件）、git diff --check通过。没有运行全仓库测试或G5。一次中间回归因测试进程已加载旧摘要时源码发生修改而被profile门禁拒绝；固定源码和摘要后全量性能包重跑通过。

日志：`/private/tmp/itestagent-v4-package-final.log`、`/private/tmp/itestagent-v4-tui.log`、`/private/tmp/itestagent-v4-typecheck-final.log`、`/private/tmp/itestagent-v4-lint-final.log`。测试仅使用临时目录中的候选编译和无GUI fixture；签名校验的成功分支使用受信任测试adapter，不宣称新v4候选已实际签名或运行。未安装/修改既有App、系统授权、Xcode、设备、AX/Return，也未commit/push。

下一步为准备可审阅的新v4签名候选及正常App关闭/锁释放的限定实测范围。真实App运行仍需按具体候选确认；旧v3两次运行额度已消费，不复用。T6.12保持in_progress。
