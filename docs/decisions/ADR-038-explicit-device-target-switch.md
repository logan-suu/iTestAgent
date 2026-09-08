# ADR-038：分组设备选择与显式跨类型草案重编译

- 状态：Accepted（用户确认实施）
- 日期：2026-09-07
- 关联：US-2.3、T6.12、ADR-011、ADR-027

## 背景

设备发现已有真机和 Simulator，但列表、键盘索引和会话选择均按旧计划类型过滤。用户提出“用这台真机”后无法看到 Simulator，也无法显式改选。US-2.3 要求两类同级支持，同时 AC4 禁止静默跨类型 fallback。

## 方案对比

1. 保留过滤，仅提示修改 prompt：不满足同页发现与可选性。
2. 只取消过滤并替换 selector：会保留旧类型路由及 baselineDomain，违反目标显式与计划确认边界。
3. 分组展示、独立确认、重新发现和草案重编译：采用。

## 决策

- 本地 inventory 按 physical、simulator 稳定顺序分组，固定区显示数量和当前计划类型。未就绪设备不隐藏，不自动启动 Simulator。
- 同类型仍重查 ready 后绑定。其他类型先由生产会话生成绑定精确目标、原草案快照及规划实例的一次性确认 token；UI 的 Enter 不等于确认，`y` 同意，`n` 保留原草案。
- 同意后经现有串行发现队列复查 UDID 和目标类型；失败时保留原草案，显示连接/启动后刷新提示。较新选择、刷新、规划变化和终态阻止过期提交。
- PlanningSession 显式转换只接受待确认草案；在独立草案上解析新 targetKind 路由和编译配置，然后提交结果。原目标/sourceText、显式断言、已确认候选和 run identity 保留；目标相关 execution metadata、device selector 和 baselineDomain 重新计算。
- 新类型缺少权威路由证据时进入原有阻断/选路流程。成功绑定仅进入新的 TestPlan Review，绝不直接执行。既有逐动作高风险授权不变。

## 后果与验证边界

- 不新增持久化 schema、模型工具或 backend 依赖；一次性 token 仅在会话内使用，不入报告/模型上下文。
- 新增 engine/facade/reducer/keymap/renderer 回归，覆盖两向切换、拒绝、重放、刷新竞争、设备失效、滚动和终态。模拟测试与原生字符帧不替代真实目标执行的 G5/G5-SIM。
- T6.12 保持 in_progress；不自动提交、推送或合并，T6.13 与 DEF-034 保持原状态。
