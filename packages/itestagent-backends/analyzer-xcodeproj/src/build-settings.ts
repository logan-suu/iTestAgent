import { resolve } from 'node:path';
import type { BuildSettingsQuery, ResolvedBuildSettings } from 'itestagent-contracts';
import { ResolvedBuildSettingsSchema } from 'itestagent-contracts';
import { runShowBuildSettings } from './xcodebuild-exec.js';

/**
 * buildSettings(query) — Resolves build settings for a target and configuration.
 *
 * Per the tech selection document: xcodebuild -showBuildSettings is Apple's
 * official source of truth for bundleId, deploymentTarget, swiftVersion,
 * architectures, and infoPlist.
 *
 * Flow:
 *   1. Run xcodebuild -showBuildSettings -target <target> [-configuration <config>]
 *   2. Extract key build settings from output
 *   3. Validate via ResolvedBuildSettingsSchema
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
