# ADR-041：已审阅 baseline 替换与文件并发保护

日期：2026-09-08。状态：用户已确认实施；2026-09-08本地时间获具体一次性授权后，真实生产TUI数据替换验收通过（验证报告§27）。关联：T6.12、US-12.2 AC4、US-12.3 AC3、ADR-032/036/040。

## 背景

规格原文：“AC4 用户可在 TUI 接受某次结果为新 baseline（高风险操作需确认）”。ADR-040要求同项目、目标、设备/系统、操作和采集配置才能比较，失败或缺失指标不得污染baseline。

核查发现：生产TUI没有接受入口；既有BaselineManager.acceptNewBaseline只变更来源run和时间，不替换指标。BaselineStore直接writeFile，首次建立的get→save和确认后覆盖均存在竞争窗口。用户批准补齐TUI入口、完整报告验证、一次性权限、真实指标替换、确认期间变化检测及原子写入。

## 方案对比与决策

- 仅把旧acceptNewBaseline接入TUI：拒绝，来源变了而指标未变，会产生错误趋势。
- 只在写入前再次get：拒绝，读取和写入之间仍可竞争；检查必须与其他writer协调。
- 使用已确认完整报告、逐动作权限和文件级compare-and-swap：采用。复用当前PermissionEngine、RunStore、BaselineManager与文件存储，不新增数据库、依赖或事件溯源。

## 执行协议

1. 用户输入`/baseline accept <run-id>`。命令在自然语言规划/模型调用前处理，不重新运行设备工作负载。
2. 通过RunStore.loadRunBundle验证canonical schema、跨文件引用、artifact大小与SHA256。当前项目引用必须一致；本增量限定passed的physical DeviceBackend内存报告，MiB单位一致，确认的全部指标均collected，增长覆盖完整且满足观察区间，已知crash或缺失事实均拒绝。
3. 与首次建立/自动比较共享memory baseline的资格和key计算；保留memory-observation-v2。查找兼容既有记录，显示physical域、来源run及新旧峰值/增长（MiB，近似）。无兼容baseline、未知存储原子能力、其他项目/场景/设备、Simulator或其他路线明确拒绝。
4. PermissionEngine以update_baseline请求一次性确认，resource绑定baseline key的摘要与选定run。allow不跨操作或会话保存；已有deny仍有效且沿用现有撤销机制。拒绝、超时、取消、会话退出均不写入，重复命令再次请求确认。
5. 允许后重新校验完整run bundle与当前项目引用，并与审阅快照比对；baseline本身通过同一key锁内的compare-and-swap复核。变化时要求重新审阅，不沿用之前的allow。
6. 以新run的实际summary替换指标；新结果没有的指标清除，不能沿用旧值。保留createdAt和目标元数据，更新updatedAt/updatedFromRun及去重的reachableRuns。历史run的result、summary、artifact-index均不改写，不回填旧baselineDelta。

## 文件提交边界

原生BaselineStore的save、delete、compareAndSwap使用相同的每key独占文件锁。写入到同目录唯一的短临时文件名（不在长hash key后继续追加UUID），sync/close后rename提交；文件为0600。compareAndSwap在持锁期间比较完整已审阅记录，null表示create-if-absent。生产首次成功baseline也走该入口，不能在并发首次创建时覆盖先到记录。

锁占用立即返回baseline_busy；不按时间猜测锁失效或自动删除他人的锁。进程异常退出留下锁时需先诊断owner再处理，本增量不提供自动抢锁。正常失败和取消释放本次锁/临时文件；不接受路径分隔符、控制字符作为baseline文件key，已有损坏记录不当作不存在而覆盖。

rename是不可回滚的提交点：之前观察到取消则不发布，之后取消不能承诺撤销已经完成的替换。该协议协调itestagent writer；不宣称能控制任意外部程序的无锁写入。注入旧FileSystem的测试替身不提供原子替换能力，生产接受入口在缺失compareAndSwap时失败关闭。

## 验证与后果

单元/跨包测试覆盖新指标替换与旧指标清除、来源历史、完整报告/项目/目标/场景/覆盖资格、允许/拒绝/超时/取消/持久deny、报告或baseline变化、独立进程首次竞争、锁占用及损坏文件。真实PTY使用正常startTui、AgentSession、renderer和权限输入，配置/凭证/设备读取为测试边界，报告与baseline为临时fixture；验证允许、拒绝和pending退出。startTui退出会dispose当前session，取消待处理权限。

这些测试不是新G5/G5-SIM。真实baseline替换需展示具体旧值、新值及run后另获本次授权；不沿用之前构建/安装/录制的allow。零扫描、多轮可复现操作、Simulator/XCUITest新增采集与完整环境指纹等剩余项仍归ADR-040/T6.12，不以本增量关闭任务。

真实数据验收：用户针对已展示来源和新旧数值授权后，正常生产CLI/OpenTUI通过一次update_baseline allow完成替换，峰值47.813026428222656MiB、增长37.796897888183594MiB。只有兼容的一个baseline改变，创建时间/来源历史保留，两次历史run的10份canonical报告文件哈希不变；完整性验证通过，无锁/临时文件残留，CLI与driver正常exit0。本次复用既有真机报告，没有新设备工作负载或采集，不扩张G5/G5-SIM结论。具体一次性授权已消费；后续其他替换仍需独立确认。


T6.12基线草稿编辑补充（2026-09-09，用户确认）：正常TUI的Modify输入支持精确baseline=skip或baseline=local_auto，只修改未确认计划；显式选择在本planning session的重新编译/目标选择/多轮配置后保留，新会话不继承。Simulator native内存仍强制skip、拒绝开启local_auto。策略编辑不写baseline，既有执行与高风险替换权限保持。真实PTY已验证skip进入canonical且无测试基线新增；无schema/Intent扩展。证据见性能报告§41。
