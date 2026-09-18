# T6.12 受限原生 Return：第一阶段离线实现计划

日期：2026-09-17。状态：用户确认第一阶段，离线实现完成。决策依据：[ADR-045 实验决策](../decisions/ADR-045-bounded-native-console-return.md)。现有0.1.3只读结果已证实AXConfirm不公开，不再重复相同能力探针。

## 本次实现范围

1. 新增 `native/itestagent-memory-console-return.swift`：显式固定Return策略与可注入状态接口；只消费PreparedMemoryIdentityQuery，不接受任意按键/修饰键/命令。状态区分未消费、前置检查、写入已尝试、down已尝试、up已尝试、等待响应和终止。失败前置也消费对象，不自动选择另一策略。
2. 复用并按需抽取 `itestagent-memory-console-submit.swift` 中的空prompt/末尾选区/插入后全文与源码验证，避免两份规则漂移。AXConfirm路径测试和行为保持；pidReturn须显式创建，仅取消对AXConfirm可用的依赖，不削弱其他条件。
3. 原生适配器只提供公开权限preflight、构造固定Return和绑定launch返回实例的定向发送。生命周期/前台/焦点/文档绑定由显式检查提供，不通过随意PID构造production owner。只编译此适配器；单元测试使用计数器/合成事件替身，无实际事件投递或权限请求。
4. 连接既有query exchange/响应接收边界时，保留候选与严格解析边界；不把发送API返回当成功。复用单次消费/取消/期限，不在接收失败后补发。若需要改变现有工厂，以内部显式策略参数/专用工厂实现，不向CLI暴露新自动默认。
5. 更新native README、ADR-045的实际批准范围、ADR-044交叉引用、交接与task-status notes，T6.12保持in_progress；不修改用户故事或降低AC。

## 必要离线用例

- 缺少AX或事件权限、错误owner/PID/前台、额外窗口/错误文档或焦点、非空输入/选区、源码变化：0插入/0事件。
- 正常固定单行请求：输出边界先于插入；插入一次，核对后down一次/up一次，需响应候选与严格解析；不能有任意键码/全局发送参数。
- 插入部分成功/错误/超时、写后输入/源码/上下文漂移：不发送，禁止擦除与重试。
- 取消/超时分别发生在检查、插入后、down前、down后、up后、等待响应：停止新语义动作；down后仅原实例仍可验证时进行一次配对up，身份不明则清理未证实，不向新实例发送。
- 发送没有回执、丢失/重复/旧请求响应：执行不可验证，不切回AXConfirm、不重发。重复调用对象必须拒绝。
- 原AXConfirm路径现有负例继续通过；源码/请求匹配、只读artifact边界和owner上下文持续复查。

## 门禁与交付

warnings-as-errors Swift编译；定向Bun/Swift合成测试；性能包不启用App/LLDB opt-in；typecheck、lint、git diff --check。公开系统通知测试可按既有方式在沙箱外执行，但这不授权GUI或键盘事件。记录未执行的验证项，不把离线测试计作G5/G5-SIM。

本次确认仅批准上述实现和离线测试，不批准安装/重签已授权App、申请权限、向任何App发送CGEvent、真实Xcode或设备操作、commit/push。实际键盘方案涉及新的风险：指定PID仍不能消除该进程内部焦点竞争、PID复用窗口或事件被忽略；后续实证前持续标实验性/不可用。

## 第一阶段实现记录

新增MemoryConsoleReturnExchange与显式prepareLocatedMemoryReturnExchange工厂，复用MemoryConsoleSubmission的单次插入及写后核对。原AXConfirm调用仍要求公开动作；没有自动fallback或CLI默认变化。新工厂保留目录描述符贯穿exchange，继续重复解析原窗口/焦点/input/output。CGEvent适配器仅编译，未构造或调用。

合成用例覆盖24种提交状态、输出收缩、匹配/旧请求/重复响应及写入前后源码漂移。key-down尝试后，即使取消或超时，仅在原实例仍可验证时最多尝试一次key-up；up错误不再尝试。releaseDeliveryVerified始终false，表示void发送不能证明系统收到释放；也不能据此释放生产lease。候选响应仍须经既有TS严格解析。

生产owner/全局lease、会话token及一次性授权绑定尚未与此工厂接线；NSRunningApplication参数必须来自自有launch callback，类型本身不证明该来源。事件发送与实例/焦点检查之间仍有不可消除的原子性缺口。下一阶段先准备独立可审阅的自有App验证候选，再单独授权安装/权限/真实事件；本阶段不进入宿主或设备。

门禁：性能包255 pass/8 opt-in skip/0 fail、1574 assertions/41文件；Swift warnings-as-errors、typecheck、lint940文件及diff检查通过。未运行全仓库测试或新增G5/G5-SIM。日志位于 `/private/tmp/itestagent-return-{package,typecheck,lint}.log`。

## 受控App候选准备

后续测试候选已编译并锁定哈希；尚未安装/执行。详见[受控App候选及首次执行范围](physical-memgraph-return-fixture-plan-6.12.md)。测试发送器独立于生产Xcode门禁，仅验证公开事件传输，不能宣称完整提交链路可用。
