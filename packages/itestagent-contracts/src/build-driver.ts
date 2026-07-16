import { z } from 'zod';

/**
 * iTestAgent BuildDriver 契约 — Build/Test/Archive 操作类型与 Zod schemas
 *
 * 架构设计文档 §5.3：BuildDriver 接口包含 6 个方法：
 *   doctor / listSchemes / showBuildSettings / build / test / archive
 *
 * 技术选型 §9：BuildDriver MVP 默认使用 xcodebuild + fastlane（签名复杂时启用）。
 * AGENTS.md §3：Backend 之间不互调，由 engine 编排。
 */

// ─── Doctor ─────────────────────────────────────────────────

export const BuildDoctorResultSchema = z
  .object({
    xcodeInstalled: z.boolean(),
    xcodeVersion: z.string().optional(),
    commandLineTools: z.boolean(),
    signingIdentities: z.array(z.string()),
    issues: z.array(z.string()),
    suggestions: z.array(z.string()),
  })
  .strict();

export type BuildDoctorResult = z.infer<typeof BuildDoctorResultSchema>;

// ─── Scheme Info ────────────────────────────────────────────

export const SchemeInfoSchema = z
  .object({
    name: z.string(),
    type: z.enum(['app', 'test', 'other']),
    buildConfigurations: z.array(z.string()),
  })
  .strict();

export type SchemeInfo = z.infer<typeof SchemeInfoSchema>;

// ─── Build Settings ─────────────────────────────────────────

export const BuildSettingsInputSchema = z
  .object({
    root: z.string(),
    scheme: z.string(),
    configuration: z.string().optional(),
  })
  .strict();

export type BuildSettingsInput = z.infer<typeof BuildSettingsInputSchema>;

export const BuildSettingsSchema = z
  .object({
    settings: z.record(z.string(), z.unknown()),
    derivedDataPath: z.string().optional(),
    builtProductsDir: z.string().optional(),
  })
  .strict();

export type BuildSettings = z.infer<typeof BuildSettingsSchema>;

// ─── Build ──────────────────────────────────────────────────

export const BuildInputSchema = z
  .object({
    root: z.string(),
    scheme: z.string(),
    configuration: z.enum(['Debug', 'Release']).optional(),
    deviceId: z.string(),
    derivedDataPath: z.string().optional(),
    extraArgs: z.array(z.string()).optional(),
  })
  .strict();

export type BuildInput = z.infer<typeof BuildInputSchema>;

export const BuildResultSchema = z
  .object({
    success: z.boolean(),
    appPath: z.string().optional(),
    xcresultPath: z.string().optional(),
    log: z.string(),
    durationMs: z.number().int().nonnegative(),
  })
  .strict();

export type BuildResult = z.infer<typeof BuildResultSchema>;

// ─── Test ───────────────────────────────────────────────────

export const TestInputSchema = z
  .object({
    root: z.string(),
    scheme: z.string(),
    deviceId: z.string(),
    testPlan: z.string().optional(),
    only: z.array(z.string()).optional(),
    skip: z.array(z.string()).optional(),
  })
  .strict();

export type TestInput = z.infer<typeof TestInputSchema>;

export const TestResultSchema = z
  .object({
    success: z.boolean(),
    totalTests: z.number().int().nonnegative(),
    passed: z.number().int().nonnegative(),
    failed: z.number().int().nonnegative(),
    xcresultPath: z.string().optional(),
    log: z.string(),
    durationMs: z.number().int().nonnegative(),
  })
  .strict();

export type TestResult = z.infer<typeof TestResultSchema>;

// ─── Archive ────────────────────────────────────────────────

export const ArchiveInputSchema = z
  .object({
    root: z.string(),
    scheme: z.string(),
    configuration: z.enum(['Debug', 'Release']).optional(),
    outputDir: z.string(),
  })
  .strict();

export type ArchiveInput = z.infer<typeof ArchiveInputSchema>;

export const ArchiveResultSchema = z
  .object({
    success: z.boolean(),
    archivePath: z.string().optional(),
    ipaPath: z.string().optional(),
    log: z.string(),
    durationMs: z.number().int().nonnegative(),
  })
  .strict();

export type ArchiveResult = z.infer<typeof ArchiveResultSchema>;

// ─── BuildDriver Interface ──────────────────────────────────

/**
 * BuildDriver — 构建/测试/归档操作 Backend 接口（架构设计文档 §5.3）
 *
 * 所有 build backend（xcodebuild、fastlane）均实现此接口。
 * 方法返回 Promise，Engine 侧统一编排。
 */
export interface BuildDriver {
  /** 环境诊断 */
  doctor(): Promise<BuildDoctorResult>;

  /** 列出项目 schemes（含 scheme 类型和构建配置） */
  listSchemes(root: string): Promise<SchemeInfo[]>;

  /** 获取指定 scheme 的构建设置 */
  showBuildSettings(input: BuildSettingsInput): Promise<BuildSettings>;

  /** 构建 App */
  build(input: BuildInput): Promise<BuildResult>;

  /** 运行测试 */
  test(input: TestInput): Promise<TestResult>;

  /** 归档（Archive + 可选 IPA 导出） */
  archive(input: ArchiveInput): Promise<ArchiveResult>;
}
