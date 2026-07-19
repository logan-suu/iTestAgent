# tests/integration

> 跨包集成测试（Phase 验收级）

每个 Phase 的集成测试任务对应的测试文件放在对应的子目录中。

## 约定

- 目录结构：`phase{N}/phase{N}-{name}.test.ts`（如 `phase1/phase1-session-lifecycle.test.ts`）
- 集成测试验证跨模块联调，不局限于单一包
- 运行：`bun test tests/integration/`
- 依赖 fixtures/ 的测试数据可通过相对路径 `../../fixtures/` 引用

## 与单元测试的区别

| 类型 | 位置 | 范围 |
|---|---|---|
| 单元测试 | `packages/<pkg>/test/*.test.ts` | 本包内部逻辑 |
| 集成测试 | `tests/integration/phase{N}/*.test.ts` | 跨包联调（Phase 验收级）|

详见 AGENTS.md §10。
