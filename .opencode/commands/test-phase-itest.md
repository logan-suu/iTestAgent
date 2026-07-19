---
description: 当前 Phase 的集成测试 — 生成、审查完整性、补全缺口、运行回归
agent: build
---

## 🔗 Phase 集成测试（当前阶段专用）

此命令只关注**当前 Phase** 的跨包集成测试。累进全量回归请用 `test-integration-itest`。

### 第一步：定位当前 Phase

1. 读取 `docs/05-planning/task-status.json`，获取 `current_phase`。
2. 读取 `docs/INDEX.md` 建立全局文档认知。

### 第二步：检查集成测试目录

3. 检查 `tests/integration/phase{current_phase}/` 目录是否存在。
4. 如果目录**不存在**：创建目录，**跳到第五步**（生成集成测试）。
5. 如果目录**已存在**：列出所有 `.test.ts` 文件，**进入第三步**（审查完整性）。

### 第三步：审查现有集成测试完整性

6. 读取 `docs/05-planning/task-status.json` 中当前 Phase 的所有已完成任务。
7. 读取每个已完成任务的 `notes` 字段，了解模块职责和关键 API。
8. 列出当前 Phase **所有已有的跨包交互链路**（基于各包 public API 和任务依赖关系）。
9. 对比现有测试文件覆盖的链路，标记缺失项。

### 第四步：补全缺口

10. 对每个缺失链路，编写新测试或扩展现有文件。按优先级：
    - **P0**：核心编排链路（如 SessionManager→RSM→SSEHub→DB）
    - **P1**：各 Backend 接口 + 真实实现
    - **P2**：类型/契约验证（schema round-trip）

11. **测试失败处理红线**：
    - ❌ 禁止弱化断言或 mock 绕过真实代码来让测试通过
    - ✅ 必须分析业务代码和测试代码两边逻辑，判定根因在哪边
    - 业务代码 bug → 修复业务代码
    - 测试逻辑有误 → 修正测试
    - 测试环境限制 → 显式标注 `.skip(reason)` 并记录

12. 真实依赖优先：`createDb` / `createServer` / `Bun.spawn` / 文件系统。mock 需在文件头部显式说明原因。

### 第五步：生成集成测试（目录不存在时）

13. 遍历当前 Phase 所有已完成任务，提取跨包交互。
14. 按 P0→P1→P2 优先级生成测试文件，命名 `phase{N}-{name}.test.ts`。

### 第六步：运行当前 Phase 测试

15. 类型检查：`bun run typecheck`
16. Lint：`bun run lint`
17. 当前 Phase 集成测试：`bun test tests/integration/phase{current_phase}/`
18. 输出报告：
    ```
    ## 🔗 Phase {N} 集成测试
    | 指标 | 结果 |
    | --- | --- |
    | Phase {N} 集成测试 | X pass / Y fail |
    | 类型检查 | ✅/❌ |
    | Lint | ✅/❌ |
    | 跨包链路覆盖 | X/Y (P0: A/Y1, P1: B/Y2, P2: C/Y3) |
    ```

### 第七步：更新任务状态

19. 如果当前 Phase 的集成测试任务（如 `1.16`）存在且为 `ready`：
    - 更新 `status` → `in_progress`
    - 在 `notes` 中记录测试文件列表和测试数量
20. 任务保持 `in_progress`，等待 `commit-pr-itest`。

### 第八步：后续操作

- **全部通过** → `commit-pr-itest` 提交
- **部分失败** → 分析根因，修复后重跑
- **覆盖率不足** → 列出缺失链路，继续补全
