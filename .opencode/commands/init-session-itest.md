---
description: iTestAgent 新会话初始化 — 读取规约、定位进度、锁定 AC、等待确认后开工
agent: build
---

## 🚀 新会话启动：iTestAgent 项目初始化

你好，我是 iTestAgent 项目的开发者。这是一个全新的会话，之前的对话历史不在上下文中。

请严格按照以下步骤执行初始化（AGENTS.md 要求的 EPCC-V 流程），在确认状态前**不要**开始编写任何代码：

### 第一步：读取核心规约与地图
1. 读取项目根目录下的 `AGENTS.md`（项目宪法，定义所有红线 R1-R10 与架构）。
2. 读取 `docs/INDEX.md`（文档地图，了解所有文档位置和模块分布）。
3. 如果 `docs/INDEX.md` 不存在，读取 `docs/` 目录自行建立文档地图。规格文档列表：
   - `docs/01-spec/全量用户故事与验收标准规格书.md`：US-x.y + AC
   - `docs/02-architecture/架构设计文档.md`：分层/组件/编排内核/数据模型/流程
   - `docs/02-architecture/技术选型文档.md`：各层选型与采用/借鉴/自研/不用
   - `docs/02-architecture/数据流全链路技术说明文档.md`：S1-S9 数据契约与落盘
   - `docs/04-ai-native/AI Native 开发理念与实战技巧手册.md`：EPCC-V 工作流、质量门禁 G1-G7
   - `docs/03-implementation/开发避坑与关键注意点手册.md`：红线、高风险坑、提交前自检
   - `docs/05-planning/开发计划安排文档.md`：阶段/里程碑/单人排期

### 第二步：定位当前进度（任务溯源）
4. 读取 `docs/05-planning/task-status.json`。
   - **级联更新 pending → ready**：遍历所有阶段中 `status: pending` 的任务，若其 `dependencies` 全部为 `done`，则翻转为 `ready`。
   - **如果用户指定了任务 ID**（在会话中说了"我想做 0.2"），优先使用该任务。
   - **如果用户未指定**：
     - 找出 `current_phase`。
     - 找到该阶段中第一个 `status: "ready"` 的任务。
     - 如果找不到 ready 任务，检查是否有 `in_progress` 的任务（可能是中断的）。
     - 如果都没有，列出当前阶段的所有 `pending` 任务，让用户选择。
   - 确认该任务的所有 `dependencies` 是否已标记为 `done`。
   - 输出当前阶段、任务 ID、标题及关联的用户故事编号。

### 第三步：锁定规格上下文（防幻觉）
5. 根据上述任务，读取该任务 `documents_required` 字段中列出的文档。
6. 按以下格式输出上下文摘要：

```markdown
## 📋 任务上下文锁定

### 任务信息
- **任务 ID**：[任务ID]
- **标题**：[任务标题]
- **关联用户故事**：[US-XXX]
- **阶段**：Phase X - [阶段名称]

### 验收标准（AC）原文
> [逐字粘贴对应 AC 原文]

### 关键架构约束
> [引用 AGENTS.md 中的相关规则，红线 R1-R10]

### 依赖状态
- [依赖任务1]：✅ done
- [依赖任务2]：⏳ pending

### 参考文档
- `docs/...`
```

7. **快速一致性检查**：
   - 检查该任务是否在 AGENTS.md 的"红线 R1-R10"或"数据契约"中有对应规则。
   - 如果存在冲突，立即标记并等待用户确认。

### 第四步：状态确认与开工
8. 总结你当前的认知。
9. 等待我确认"开始执行"后：
   - 将 `docs/05-planning/task-status.json` 中该任务的 `status` 更新为 `in_progress`。
   - 再遵循 EPCC-V 流程：Explore → Plan → Code → Check → Verify。

请开始执行初始化。
