import type { XcuitestExecutionCandidate, XcuitestTarget } from 'itestagent-contracts';

export type ExecutionRoutePreference = 'auto' | 'xcuitest' | 'device_backend';

export type ExecutionRouteResolution =
  | {
      status: 'resolved';
      prefer: ExecutionRoutePreference;
      resolvedPath: 'xcuitest' | 'device_backend';
      selectionReason:
        | 'explicit_preference'
        | 'evidence_backed_xcuitest'
        | 'confirmed_no_xcuitest_candidate'
        | 'user_selected_after_ambiguity';
      xcuitest?: XcuitestTarget;
      configuration?: XcuitestExecutionCandidate;
    }
  | {
      status: 'ambiguous';
      prefer: 'auto';
      candidates: XcuitestExecutionCandidate[];
    }
  | {
      status: 'blocked';
      prefer: 'auto' | 'xcuitest';
      code: 'xcuitest_unavailable' | 'xcuitest_ambiguous' | 'xcuitest_discovery_indeterminate';
      candidates: XcuitestExecutionCandidate[];
    };

export interface ResolveExecutionRouteInput {
  preference: ExecutionRoutePreference;
  targetKind: 'physical' | 'simulator';
  discoveryStatus: 'available' | 'none' | 'indeterminate';
  configurations: readonly XcuitestExecutionCandidate[];
  selectedScheme?: string;
  selectedTestPlan?: string;
  selectedAfterAmbiguity?: boolean;
}

function toXcuitest(configuration: XcuitestExecutionCandidate): XcuitestTarget {
  return {
    scheme: configuration.scheme,
    ...(configuration.testPlan ? { testPlan: configuration.testPlan } : {}),
    targets: [...configuration.targets],
    evidence: [...configuration.evidence],
    limitations: [...configuration.limitations],
  };
}

export function resolveExecutionRoute(input: ResolveExecutionRouteInput): ExecutionRouteResolution {
  if (input.preference === 'device_backend') {
    return {
      status: 'resolved',
      prefer: input.preference,
      resolvedPath: 'device_backend',
      selectionReason: 'explicit_preference',
    };
  }

  if (input.discoveryStatus === 'indeterminate') {
    return {
      status: 'blocked',
      prefer: input.preference,
      code: 'xcuitest_discovery_indeterminate',
      candidates: [],
    };
  }

  let candidates = input.configurations.filter(
    (configuration) => configuration.targetKind === input.targetKind,
  );
  if (input.selectedScheme) {
    candidates = candidates.filter((candidate) => candidate.scheme === input.selectedScheme);
  }
  if (input.selectedTestPlan) {
    candidates = candidates.filter((candidate) => candidate.testPlan === input.selectedTestPlan);
  }

  const defaultCandidates = candidates.filter((candidate) => candidate.isDefault);
  const selected =
    candidates.length === 1
      ? candidates[0]
      : defaultCandidates.length === 1
        ? defaultCandidates[0]
        : undefined;

  if (selected) {
    return {
      status: 'resolved',
      prefer: input.preference,
      resolvedPath: 'xcuitest',
      selectionReason: input.selectedAfterAmbiguity
        ? 'user_selected_after_ambiguity'
        : input.preference === 'xcuitest'
          ? 'explicit_preference'
          : 'evidence_backed_xcuitest',
      xcuitest: toXcuitest(selected),
      configuration: selected,
    };
  }

  const hasExplicitConfigurationSelection = Boolean(input.selectedScheme || input.selectedTestPlan);
  if (input.preference === 'xcuitest' || hasExplicitConfigurationSelection) {
    return {
      status: 'blocked',
      prefer: input.preference,
      code: candidates.length === 0 ? 'xcuitest_unavailable' : 'xcuitest_ambiguous',
      candidates: [...candidates],
    };
  }
  if (input.discoveryStatus === 'none') {
    return {
      status: 'resolved',
      prefer: input.preference,
      resolvedPath: 'device_backend',
      selectionReason: 'confirmed_no_xcuitest_candidate',
    };
  }
  return candidates.length === 0
    ? {
        status: 'blocked',
        prefer: 'auto',
        code: 'xcuitest_unavailable',
        candidates: [],
      }
    : { status: 'ambiguous', prefer: 'auto', candidates: [...candidates] };
}
