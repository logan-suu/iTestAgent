import type { ProjectAnalyzerBackend, ResourceFacts, SourceFacts } from 'itestagent-contracts';
import { buildSettings } from './build-settings.js';
import { discover } from './discover.js';
import { graph } from './graph.js';

/**
 * XcodeProjAnalyzerBackend — ProjectAnalyzerBackend interface implementation.
 *
 * Uses xcodebuild (Apple's official CLI) + a lightweight self-contained
 * pbxproj parser (zero external dependencies).
 *
 * This implementation covers the deterministic layer (3 methods):
 *   discover / graph / buildSettings.
 *
 * The inference layer (scanSources / scanResources) is deferred to
 * task 2.2 (Swift structure/symbols).
 *
 * Per the tech selection document:
 *   - xcodebuild -list/-showBuildSettings is mandatory (Apple official)
 *   - XcodeProj / Tuist XcodeProj is the primary candidate for project graph
 *
 * Red line R2: Do not re-implement reused foundations (xcodebuild)
 * Red line R4: Inference fields output only candidates + evidence + confidence
 */

/**
 * Create an XcodeProjAnalyzerBackend instance.
 *
 * scanSources and scanResources throw "not implemented" errors
 * (these are deferred to task 2.2).
 */
export function createXcodeProjAnalyzerBackend(): ProjectAnalyzerBackend {
  return {
    discover,

    graph,

    buildSettings,

    async scanSources(): Promise<SourceFacts> {
      throw new Error(
        'scanSources not yet implemented — deferred to task 2.2 (Swift structure/symbols)',
      );
    },

    async scanResources(): Promise<ResourceFacts> {
      throw new Error(
        'scanResources not yet implemented — deferred to task 2.2 (Swift structure/symbols)',
      );
    },
  };
}
