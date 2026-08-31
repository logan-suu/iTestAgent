import type { ProjectAnalyzerBackend } from 'itestagent-contracts';
import { generateProjectProfile } from './profile-generator.js';
import type { ProjectProfile } from './profile-io.js';

export type ProjectAnalysisTier = 'tier1_static' | 'tier2_syntax' | 'tier3_semantic';

export interface ProjectAnalysisMetadata {
  readonly analysisTier: ProjectAnalysisTier;
  readonly enabledCapabilities: readonly string[];
  readonly limitations: readonly string[];
}

export interface ProjectAnalysisResult {
  readonly profile: ProjectProfile;
  readonly analysis: ProjectAnalysisMetadata;
}

export const XCODEPROJ_TIER1_ANALYSIS: ProjectAnalysisMetadata = {
  analysisTier: 'tier1_static',
  enabledCapabilities: [
    'xcodebuild_discovery',
    'pbxproj_graph',
    'build_settings',
    'static_source_candidates',
    'resource_scan',
  ],
  limitations: [
    'SwiftSyntax tier-2 structural analysis is not enabled.',
    'SourceKit tier-3 semantic analysis is not enabled because a reusable build/index is not guaranteed.',
    'Source findings are candidates with evidence and confidence, not confirmed runtime user journeys.',
  ],
};

/**
 * Produce the session-level analysis envelope defined by ADR-026 without
 * changing the persisted project-profile.v1 schema.
 */
export async function analyzeProject(
  backend: ProjectAnalyzerBackend,
  root: string,
  analysis: ProjectAnalysisMetadata = XCODEPROJ_TIER1_ANALYSIS,
): Promise<ProjectAnalysisResult> {
  return {
    profile: await generateProjectProfile(backend, root),
    analysis: {
      analysisTier: analysis.analysisTier,
      enabledCapabilities: [...analysis.enabledCapabilities],
      limitations: [...analysis.limitations],
    },
  };
}
