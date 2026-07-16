import { z } from 'zod';

/**
 * ProjectAnalyzerBackend — 项目分析 Backend 接口 + Zod schemas
 *
 * AGENTS.md §4 架构：ProjectAnalyzerBackend 位于 Backend 接口层，
 * 负责分析 iOS 项目结构、获取构建配置、扫描源码与资源。
 *
 * 架构设计文档 §5.4 ProjectAnalyzerBackend：5 个方法
 *   - discover(root): 发现项目类型、scheme、configuration
 *   - graph(input): 分析模块依赖图（target、类型、依赖、测试存在性）
 *   - buildSettings(input): 查询指定 target+configuration 的构建设置
 *   - scanSources(input): 扫描源码统计（文件数、VC、协议、Storyboard/XIB）
 *   - scanResources(input): 扫描资源统计（Asset Catalog、字体、本地化、权限）
 */

// ─── 1. ProjectDiscovery ─────────────────────────────────────

export const ProjectDiscoverySchema = z
  .object({
    /** 项目根目录 */
    root: z.string(),
    /** 项目名称（workspace 下可有多个 project） */
    name: z.string().optional(),
    /** 项目类型 */
    type: z.enum(['xcode_project', 'xcode_workspace', 'swift_package', 'unknown']),
    /** .xcworkspace 路径（workspace 类型时必有） */
    xcworkspacePath: z.string().optional(),
    /** .xcodeproj 路径（project 类型时必有） */
    xcodeprojPath: z.string().optional(),
    /** 可用 scheme 列表 */
    schemes: z.array(z.string()),
    /** 可用 configuration 列表（Debug/Release 等） */
    configurations: z.array(z.string()),
  })
  .strict();

export type ProjectDiscovery = z.infer<typeof ProjectDiscoverySchema>;

// ─── 2. ProjectGraph ─────────────────────────────────────────

export const ProjectGraphSchema = z
  .object({
    /** 编译目标列表 */
    targets: z.array(
      z.object({
        name: z.string(),
        /** 目标类型 */
        type: z.enum(['app', 'framework', 'test', 'bundle', 'other']),
        /** 依赖的目标名称列表 */
        dependencies: z.array(z.string()),
        /** Swift/ObjC 源文件数量（不含测试） */
        sourceCount: z.number().int().nonnegative().optional(),
        /** 测试文件数量 */
        testCount: z.number().int().nonnegative().optional(),
      }),
    ),
    /** 是否存在 XCUITest target */
    hasXCUITests: z.boolean(),
    /** 是否存在 Unit Test target */
    hasUnitTests: z.boolean(),
  })
  .strict();

export type ProjectGraph = z.infer<typeof ProjectGraphSchema>;

// ─── 3. BuildSettingsQuery / ResolvedBuildSettings ───────────

export const BuildSettingsQuerySchema = z
  .object({
    /** 项目根目录 */
    root: z.string(),
    /** 目标 target 名称 */
    target: z.string(),
    /** 构建配置（Debug / Release 等） */
    configuration: z.string().optional(),
  })
  .strict();

export type BuildSettingsQuery = z.infer<typeof BuildSettingsQuerySchema>;

export const ResolvedBuildSettingsSchema = z
  .object({
    /** CFBundleIdentifier */
    bundleIdentifier: z.string().optional(),
    /** CFBundleName（显示名称） */
    bundleName: z.string().optional(),
    /** IPHONEOS_DEPLOYMENT_TARGET */
    deploymentTarget: z.string().optional(),
    /** SWIFT_VERSION */
    swiftVersion: z.string().optional(),
    /** ARCHS / VALID_ARCHS */
    architectures: z.array(z.string()),
    /** INFOPLIST_FILE */
    infoPlistPath: z.string().optional(),
  })
  .strict();

export type ResolvedBuildSettings = z.infer<typeof ResolvedBuildSettingsSchema>;

// ─── 4. SourceScanInput / SourceFacts ─────────────────────────

export const SourceScanInputSchema = z
  .object({
    /** 项目根目录 */
    root: z.string(),
    /** 限定扫描的 target 列表；不传则扫描所有 */
    targets: z.array(z.string()).optional(),
    /** 是否包含测试文件 */
    includeTestFiles: z.boolean().optional(),
  })
  .strict();

export type SourceScanInput = z.infer<typeof SourceScanInputSchema>;

export const SourceFactsSchema = z
  .object({
    /** Swift 源文件数量 */
    swiftFiles: z.number().int().nonnegative(),
    /** ObjC 源文件数量 */
    objcFiles: z.number().int().nonnegative(),
    /** ViewController 列表（名称 + 源文件路径） */
    viewControllers: z.array(
      z.object({
        name: z.string(),
        file: z.string(),
      }),
    ),
    /** 发现的 Protocol 名称列表 */
    protocols: z.array(z.string()),
    /** Storyboard 引用路径列表 */
    storyboardRefs: z.array(z.string()),
    /** XIB 引用路径列表 */
    xibRefs: z.array(z.string()),
  })
  .strict();

export type SourceFacts = z.infer<typeof SourceFactsSchema>;

// ─── 5. ResourceScanInput / ResourceFacts ────────────────────

export const ResourceScanInputSchema = z
  .object({
    /** 项目根目录 */
    root: z.string(),
  })
  .strict();

export type ResourceScanInput = z.infer<typeof ResourceScanInputSchema>;

export const ResourceFactsSchema = z
  .object({
    /** Asset Catalog 数量 */
    assetCatalogs: z.number().int().nonnegative(),
    /** 字体文件路径列表 */
    fontFiles: z.array(z.string()),
    /** 本地化字符串文件路径列表 */
    localizedStrings: z.array(z.string()),
    /** entitlements 权限声明 */
    entitlements: z.record(z.string(), z.unknown()).optional(),
    /** Info.plist 中的 key 列表 */
    infoPlistKeys: z.array(z.string()),
  })
  .strict();

export type ResourceFacts = z.infer<typeof ResourceFactsSchema>;

// ─── 6. Backend 接口 ─────────────────────────────────────────

/**
 * ProjectAnalyzerBackend — 项目分析 Backend 接口（架构设计文档 §5.4）
 *
 * 职责：分析 iOS 项目结构、获取构建配置、扫描源码与资源。
 * 实现方：analyzer-xcodeproj（成熟方案）、analyzer-xcodequery（optional future）。
 */
export interface ProjectAnalyzerBackend {
  /** 发现项目类型、scheme、configuration */
  discover(root: string): Promise<ProjectDiscovery>;

  /** 分析模块依赖图 */
  graph(input: ProjectDiscovery): Promise<ProjectGraph>;

  /** 查询指定 target + configuration 的构建设置 */
  buildSettings(input: BuildSettingsQuery): Promise<ResolvedBuildSettings>;

  /** 扫描源码统计（文件数、VC、协议、Storyboard/XIB） */
  scanSources(input: SourceScanInput): Promise<SourceFacts>;

  /** 扫描资源统计（Asset Catalog、字体、本地化、权限） */
  scanResources(input: ResourceScanInput): Promise<ResourceFacts>;
}
