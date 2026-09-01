import type {
  ProjectAnalyzerBackend,
  TargetKind,
  XcuitestExecutionAssets,
  XcuitestExecutionCandidate,
} from 'itestagent-contracts';
import { generateProjectProfile } from './profile-generator.js';
import type { ProjectProfile } from './profile-io.js';

export type ProjectAnalysisTier = 'tier1_static' | 'tier2_syntax' | 'tier3_semantic';

export interface TargetExplicitXcuitestExecutionAssets {
  readonly statusByTargetKind: Readonly<Record<TargetKind, XcuitestExecutionAssets['status']>>;
  readonly configurations: readonly XcuitestExecutionCandidate[];
  readonly evidence: readonly string[];
  readonly limitations: readonly string[];
}

export interface ProjectAnalysisMetadata {
  readonly analysisTier: ProjectAnalysisTier;
  readonly enabledCapabilities: readonly string[];
  readonly limitations: readonly string[];
  readonly executionAssets?: TargetExplicitXcuitestExecutionAssets;
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
    'xcuitest_execution_candidates',
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
  const profile = await generateProjectProfile(backend, root);
  let executionAssets: TargetExplicitXcuitestExecutionAssets | undefined;
  if (backend.discoverXcuitestExecutionAssets) {
    try {
      const discovery = await backend.discover(root);
      const graph = await backend.graph(discovery);
      const xcuitestTargets = graph.xcuitestTargets ?? [];
      const snapshots = await Promise.all(
        (['physical', 'simulator'] as const).map((targetKind) =>
          backend.discoverXcuitestExecutionAssets?.({
            root,
            discovery,
            xcuitestTargets,
            targetKind,
          }),
        ),
      );
      const physical = snapshots[0];
      const simulator = snapshots[1];
      executionAssets = {
        statusByTargetKind: {
          physical: physical?.status ?? 'indeterminate',
          simulator: simulator?.status ?? 'indeterminate',
        },
        configurations: snapshots.flatMap((snapshot) =>
          snapshot?.status === 'available' ? snapshot.configurations : [],
        ),
        evidence: snapshots.flatMap((snapshot) => snapshot?.evidence ?? []),
        limitations: snapshots.flatMap((snapshot) => snapshot?.limitations ?? []),
      };
    } catch {
      executionAssets = {
        statusByTargetKind: { physical: 'indeterminate', simulator: 'indeterminate' },
        configurations: [],
        evidence: [],
        limitations: [
          'XCUITest candidate metadata discovery failed; inspect the local analyzer log.',
        ],
      };
    }
  }

  return {
    profile,
    analysis: {
      analysisTier: analysis.analysisTier,
      enabledCapabilities: [...analysis.enabledCapabilities],
      limitations: [...analysis.limitations],
      ...(executionAssets ? { executionAssets } : {}),
    },
  };
}
