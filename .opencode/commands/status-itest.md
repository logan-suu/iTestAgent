---
description: 快速查看 iTestAgent 项目当前状态（阶段、任务、进度）
agent: build
---

## 📊 项目状态速览

请读取根目录下的 `task-status.json`，输出以下信息：

### 全局概览
- 当前阶段：Phase X - [阶段名称]
- 整体进度：已完成 X / 总任务数（所有阶段）— XX%
- 当前阶段状态：[in_progress / not_started / done]

### 当前阶段任务统计
| 状态 | 数量 |
| --- | --- |
| 总任务数 | X |
| ✅ done | X |
| 🔄 in_progress | X |
| ⏳ ready | X |
| ⬜ pending | X |

- 进度百分比：XX%

### 下一个 ready 任务
- **如果存在**：`[任务ID] - [任务标题]`
- **如果不存在**：
  - 检查是否有 `in_progress` 任务 → 提示"当前有进行中的任务：[任务ID]"
  - 如果所有任务已完成 → 提示"🎉 当前阶段所有任务已完成！"

### 里程碑出口标准
- 从 `docs/05-planning/开发计划安排文档.md` 提取当前阶段的里程碑要求

### 当前 Git 分支
- 执行 `git branch --show-current` 获取当前分支名

### 最近更新
- `last_updated` 时间戳
