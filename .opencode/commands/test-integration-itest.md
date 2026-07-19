---
description: 累进全量集成测试 — Phase 1→N 全部集成测试 + 跨 Phase 联调 + 单元测试全量回归
agent: build
---

## 🌐 累进全量集成测试

此命令运行**从 Phase 1 到当前 Phase** 的全部测试，包括跨 Phase 联调。
当前 Phase 的专项测试请用 `test-phase-itest`。

### 第一步：定位范围

1. 读取 `docs/05-planning/task-status.json`，获取 `current_phase`。
2. 确定测试范围：`Phase 1` 至 `Phase {current_phase}` 的所有集成测试。

### 第二步：检查跨 Phase 联调测试

3. 检查 `tests/integration/cross-phase/` 目录。
4. 如果目录**不存在**或为空：
   - 创建目录。
   - 基于各 Phase 之间的数据流依赖，生成跨 Phase 联调测试。
   - 跨 Phase 联调场景示例：
     - Phase 1 的 `SessionManager.createSession()` 产出的 `runId` 能否被 Phase 2 的 `TestPlan` 正确引用
     - Phase 1 的 `RunStateMachine` 状态转移能否被 Phase 3 的 `ToolDispatcher` 正确驱动
     - Phase 1 的 `ArtifactStore` 能否正确存储 Phase 4 的 `xcresult` 解析产物
5. 如果目录**已存在**：审查覆盖是否反映当前各 Phase 间的关键数据流。

### 第三步：运行全部 Phase 集成测试

6. 对 `N = 1..current_phase`，运行每个 Phase 的集成测试：
   ```bash
   bun test tests/integration/phase{N}/
   ```
7. 运行跨 Phase 联调测试：
   ```bash
   bun test tests/integration/cross-phase/
   ```
8. 运行全部单元测试：
   ```bash
   bun test packages/
   ```

### 第四步：质量门禁

9. 类型检查：`bun run typecheck`
10. Lint：`bun run lint`

### 第五步：累积回归报告

11. 汇总所有测试结果，输出报告：
    ```
    ## 🌐 累进全量测试报告（Phase 1→{N}）

    | 层级 | 测试数 | 通过 | 失败 | 状态 |
    | --- | --- | --- | --- | --- |
    | 单元测试 (packages/) | X | X | Y | ✅/❌ |
    | Phase 1 集成 | A | A | 0 | ✅/❌ |
    | Phase 2 集成 | B | B | 0 | ✅/❌ |
    | ... | ... | ... | ... | ... |
    | 跨 Phase 联调 | C | C | 0 | ✅/❌ |
    | **合计** | **Z** | **Z** | **F** | ✅/❌ |

    | 门禁 | 结果 |
    | --- | --- |
    | 类型检查 | ✅/❌ |
    | Lint | ✅/❌ |
    ```

### 第六步：失败处理

12. 任何失败必须分析根因：
    - 业务代码 regression → 修复业务代码
    - 集成测试逻辑有误 → 修正测试
    - 新增 Phase 引入的兼容性破坏 → 评估是否需要适配旧 Phase

### 第七步：后续操作

- **全部通过** → 确认当前累进质量基线
- **部分失败** → 修复后重跑，直到全绿
