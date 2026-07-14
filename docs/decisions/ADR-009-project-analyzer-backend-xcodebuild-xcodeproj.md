# ADR-009: ProjectAnalyzerBackend 选型——raw xcodebuild + Tuist/XcodeProj

**状态**: 已接受
**日期**: 2026-07-15
**决策人**: AI Agent（基于 T0.5 横评实测）
**关联**: ADR-002、ADR-005、T0.5 横评文档

## 背景

iTestAgent 需要分析 iOS 项目结构，生成 Project Profile（app/features/testAssets/suggestedSmoke）。ADR-002 确定了"候选链路不自动断定——候选+证据+用户确认"原则。ADR-005 确定了可插拔 ProjectAnalyzerBackend 架构。

候选：raw xcodebuild、Tuist/XcodeProj、XcodeQuery CLI。

## 横评结果

| Candidate | 可用性 | 证据 | 优点 | 缺点 | 评分 |
|---|---|---|---|---|---|
| **raw xcodebuild** | ✅ Available | `-list -json` / `-showBuildSettings -json` exit 0 | Apple 官方事实源；反映 resolve 后的 scheme/config/build settings | graph 能力弱；输出含本地路径 | 9/10 |
| **Tuist/XcodeProj** | ✅ Available | SwiftPM resolve/build/run 成功；输出 graph JSON | Project graph 强；target/config/source/resource phase metadata | 第三方依赖，需确认版本 pin 策略 | 8/10 |
| **XcodeQuery** | ❌ Unavailable | `which xcodequery` exit 1；`--version` exit 127 | 若可用可能有更好的 TS/Bun JSON ergonomics | 本机未安装；不可验证 | 3/10 |

### 关键发现

1. **xcodebuild 是 Apple 官方事实源**：`xcodebuild -list -json` 和 `-showBuildSettings -json` 反映 Xcode 实际解析和 resolve 后的状态，比只读 `.pbxproj` 更可信。

2. **Tuist/XcodeProj graph 提取成功**：真实项目（QwenCloud.xcodeproj）提取到 4 targets、9 source build phase refs、16 resource build phase refs。能补齐 xcodebuild 不具备的 project graph 能力。

3. **XcodeQuery 本机不可用**：`which xcodequery` exit 1。不是"输出不稳定"，而是"未安装"。不能作为 MVP 必需 backend。

4. **candidate links 全部合规**（R4）：所有候选都带 `evidencePath` + `confidence` + `requiresUserConfirmation: true`，不自动断定核心链路。

## 决策

```
ProjectAnalyzerBackend = raw xcodebuild（discover + buildSettings）
                      + Tuist/XcodeProj（graph + source/resource phase facts）
XcodeQuery = optional future spike，非 MVP 必需
```

### 职责划分

| ProjectAnalyzerBackend capability | 推荐来源 |
|---|---|
| `discover(root)` | raw `xcodebuild -list -json` |
| `buildSettings(query)` | raw `xcodebuild -showBuildSettings -json` |
| `graph(discovery)` | Tuist/XcodeProj |
| `scanSources(input)` | Tuist/XcodeProj build phases first；source-file content scan 只在用户明确确认后 |
| `scanResources(input)` | Tuist/XcodeProj resource build phases first |

## 备选方案

| 方案 | 优点 | 缺点 | 结论 |
|---|---|---|---|
| **xcodebuild + XcodeProj** | 官方事实源 + 成熟 graph 解析 | 两套工具组合 | ✅ 选择 |
| XcodeQuery 为主 | 若可用，JSON ergonomics 更好 | 本机不可用、未验证 | ❌ optional future |
| 纯 xcodebuild | 最简单 | graph 能力弱，无法提取 source/resource phase | ❌ 不够 |
| 纯 XcodeProj | graph 强 | 非官方事实源，build settings 不如 xcodebuild 可信 | ❌ 不够 |

## 实施

### Phase 2 T2.1/T2.3 实现

```
RawXcodebuildAnalyzer: discover + buildSettings
XcodeProjGraphAnalyzer: graph + source/resource phase facts
ProjectProfileCompiler: merge official facts + graph facts → schemaVersioned Project Profile
XcodeQueryAnalyzer: optional adapter behind feature flag，安装+输出稳定后重开 spike
```

### 产品化前需确认

1. Tuist/XcodeProj 依赖策略和版本 pin
2. build settings raw output 的脱敏策略（含本地路径）
3. source scan 边界：默认不读 `.gitignore` 命中项、DerivedData、secrets
4. Project Profile 的 Zod schema 校验

## 后果

### 正面
- xcodebuild 是 Apple 官方事实源，最可信
- XcodeProj 补齐 graph 能力，两者互补
- 符合 US-3.1 AC1：`XcodeProj + xcodebuild -list/-showBuildSettings`
- candidate links 全部带 evidence + confidence + user confirmation（R4 合规）

### 负面
- 两套工具组合，需处理输出归一化
- XcodeProj 是第三方依赖，需确认版本 pin 策略
- build settings 输出含本地路径，需脱敏

## 参考

- `docs/02-architecture/架构设计文档.md` §5.4 — ProjectAnalyzerBackend 接口与候选
- `docs/02-architecture/技术选型文档.md` §10 — 项目分析技术栈
- `~/Desktop/横评/T0.5 Project analyzer backend 横评.md` — 两路横评
- `docs/decisions/ADR-002` — 核心链路不自动断定
- `docs/decisions/ADR-005` — 可插拔 Backend 架构
