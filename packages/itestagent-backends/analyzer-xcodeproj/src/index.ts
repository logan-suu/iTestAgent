import type { ProjectAnalyzerBackend } from 'itestagent-contracts';
import { buildSettings } from './build-settings.js';
import { discover } from './discover.js';
import { graph } from './graph.js';
import { scanResources } from './scan-resources.js';
import { scanSources } from './scan-sources.js';

/**
 * XcodeProjAnalyzerBackend — ProjectAnalyzerBackend interface implementation.
 *
 * Uses xcodebuild (Apple's official CLI) + a lightweight self-contained
 * pbxproj parser (zero external dependencies).
 *
 * Covers all 5 ProjectAnalyzerBackend methods:
 *   - Deterministic layer: discover / graph / buildSettings (task 2.1)
 *   - Inference layer: scanSources / scanResources (task 2.2)
 *
 * Per the tech selection document:
 *   - xcodebuild -list/-showBuildSettings is mandatory (Apple official)
 *   - XcodeProj / Tuist XcodeProj is the primary candidate for project graph
 *   - swift-syntax is the primary candidate for Swift structure (tier 2 enhancement)
 *
 * Red line R2: Do not re-implement reused foundations (xcodebuild)
 * Red line R4: Inference fields output only candidates + evidence + confidence
 */

/**
 * Create an XcodeProjAnalyzerBackend instance.
 *
 * All 5 methods are now implemented:
 *   - discover / graph / buildSettings (task 2.1)
 *   - scanSources (task 2.2 — regex-based pattern matching, tier 1)
 *   - scanResources (task 2.2 — filesystem scanning)
 */
export function createXcodeProjAnalyzerBackend(): ProjectAnalyzerBackend {
  return {
    discover,
    graph,
    buildSettings,
    scanSources,
    scanResources,
  };
}
