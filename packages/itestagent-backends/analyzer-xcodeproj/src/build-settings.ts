import { resolve } from 'node:path';
import type { BuildSettingsQuery, ResolvedBuildSettings } from 'itestagent-contracts';
import { ResolvedBuildSettingsSchema } from 'itestagent-contracts';
import { runShowBuildSettings } from './xcodebuild-exec.js';

/**
 * buildSettings(query) — 查询指定 target + configuration 的构建设置。
 *
 * 技术选型文档 §10：xcodebuild -showBuildSettings 是 Apple 官方事实源，
 * 用于获取 bundleId / deploymentTarget / swiftVersion / architectures / infoPlist。
 *
 * 流程：
 *   1. 运行 xcodebuild -showBuildSettings -target <target> [-configuration <config>]
 *   2. 从输出中提取关键 build settings
 *   3. 组装 ResolvedBuildSettings 并过 Zod schema 校验
 */

/**
 * Resolve build settings for a target.
 *
 * @param query - Target and optional configuration
 * @returns Validated ResolvedBuildSettings
 * @throws XcodebuildError if xcodebuild fails
 */
export async function buildSettings(query: BuildSettingsQuery): Promise<ResolvedBuildSettings> {
  const { root, target, configuration } = query;
  const absRoot = resolve(root);

  const result = runShowBuildSettings(absRoot, target, configuration);

  const s = result.settings;

  // Parse architectures: could be "arm64 x86_64" or "arm64"
  const archsStr = s.ARCHS || s.ARCHS_STANDARD || '';
  const architectures = archsStr ? archsStr.split(/\s+/).filter(Boolean) : [];

  const settings: ResolvedBuildSettings = {
    bundleIdentifier: s.PRODUCT_BUNDLE_IDENTIFIER || undefined,
    bundleName: s.PRODUCT_NAME || undefined,
    deploymentTarget: s.IPHONEOS_DEPLOYMENT_TARGET || undefined,
    swiftVersion: s.SWIFT_VERSION || undefined,
    architectures,
    infoPlistPath: s.INFOPLIST_FILE || undefined,
  };

  // Validate against Zod schema
  return ResolvedBuildSettingsSchema.parse(settings);
}
