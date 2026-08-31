# ADR-026：项目源码分析采用分层能力，不以 SwiftSyntax/SourceKit 阻塞生产会话

**状态**：已接受
**日期**：2026-08-31
**决策人**：项目负责人（确认采用 Agent 建议）
**关联**：US-3.1、T2.2、T6.2、ADR-002、ADR-009、R4、R5、R11

## 背景

US-3.1 AC2 原文要求：

> AC2 Swift 结构使用 swift-syntax；符号/语义使用 sourcekit-lsp/SourceKitten

但当前已合入的 T2.2 使用受控的 Swift/ObjC 静态模式扫描生成候选事实；完整 SwiftSyntax AST 分析被设计为可插拔增强，SourceKit 依赖可用 build/index，因此也被技术选型文档定义为可选增强。旧 AC 把增强工具写成无条件硬依赖，与现有实现、技术选型和“项目分析不得阻塞 TUI 启动”的产品目标冲突。

T6.2 的目标是让生产 AgentSession 调用真实 ProjectAnalyzer 和设备发现，而不是在生产组合任务中重写源码分析底座。

## 方案对比

### 方案 A：在 T6.2 强制补齐 SwiftSyntax + SourceKit

- 优点：逐字满足旧 AC。
- 缺点：扩大真机闭环收口范围；SourceKit 受构建、签名和 index store 状态影响；不可用时会阻塞项目分析和 TUI；与技术选型中的可选增强定位冲突。

### 方案 B：保留现状但不暴露降级

- 优点：无需改动。
- 缺点：调用方无法区分结构化 AST/语义分析与 tier-1 静态扫描，违反 R5；旧验收报告会继续把 regex 扫描误写成完整 AC2 能力。

### 方案 C（决策）：分层分析 + 显式能力声明

- 确定性工程层强制使用 `xcodebuild -list/-showBuildSettings` 与 XcodeProj/pbxproj graph。
- tier 1 源码层允许使用受控静态扫描，但只能输出候选事实，并携带 evidence、confidence。
- SwiftSyntax 是首选 tier 2 结构增强，不是生产会话启动的硬依赖。
- SourceKit-LSP/SourceKitten 是 tier 3 语义增强，仅在已有可用 build/index 时启用，不得阻塞基础分析。
- 当次分析结果必须显式暴露 `analysisTier`、已启用能力和 `limitations`；未启用增强不得被表述为已完成。

## 决策

采用方案 C。

建议的会话级结果形态：

```text
ProjectAnalysisResult {
  profile: ProjectProfile,
  analysis: {
    analysisTier: "tier1_static" | "tier2_syntax" | "tier3_semantic",
    enabledCapabilities: string[],
    limitations: string[]
  }
}
```

`analysis` 是当次分析/Agent Session 的能力元数据。ADR-026 不直接修改持久化的 `project-profile.v1`；若未来需要将其写入 Project Profile，必须按 ADR-022 执行 schema 版本迁移。

## 实施边界

- T6.2：接入现有真实 analyzer，并在生产工具输出中暴露分析层级和限制。
- 后续增强：只有证据证明 tier 1 无法满足候选链路质量时，才排期 SwiftSyntax；只有可复用 build/index 时才启用 SourceKit。
- 验收与报告：不得再把 regex-based scan 描述为“已使用 SwiftSyntax/SourceKit”。
- R4/R5：候选链路仍需 evidence + confidence + 用户确认；降级和缺失能力必须显式。

## 后果

### 正面

- 生产 TUI 不因 AST/索引增强不可用而阻塞。
- 确定性工程事实仍由 Apple 官方工具和工程图提供。
- 调用方可以辨别分析精度，不会把候选推断当成完整语义事实。
- T6.2 保持生产组合边界，避免无关的解析器重写。

### 负面

- tier 1 对复杂 Swift 语法、宏和跨模块引用的覆盖有限。
- 在 SwiftSyntax/SourceKit 未启用时，候选链路召回率和精度可能降低。
- T6.2 需要增加会话级能力元数据，并更新相应测试。
