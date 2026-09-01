import type { RunnableXcuitestConfiguration, XcuitestTarget } from 'itestagent-contracts';

export type ExecutionRoutePreference = 'auto' | 'xcuitest' | 'device_backend';

export type ExecutionRouteResolution =
  | {
      status: 'resolved';
      prefer: ExecutionRoutePreference;
      resolvedPath: 'xcuitest' | 'device_backend';
      selectionReason:
        | 'explicit_preference'
        | 'runnable_xcuitest'
        | 'no_runnable_xcuitest'
        | 'user_selected_after_ambiguity';
      xcuitest?: XcuitestTarget;
      configuration?: RunnableXcuitestConfiguration;
    }
  | {
      status: 'ambiguous';
      prefer: 'auto';
      candidates: RunnableXcuitestConfiguration[];
    }
  | {
      status: 'blocked';
      prefer: 'auto' | 'xcuitest';
      code: 'xcuitest_unavailable' | 'xcuitest_ambiguous';
      candidates: RunnableXcuitestConfiguration[];
    };

export interface ResolveExecutionRouteInput {
  preference: ExecutionRoutePreference;
  targetKind: 'physical' | 'simulator';
  configurations: readonly RunnableXcuitestConfiguration[];
  selectedScheme?: string;
  selectedTestPlan?: string;
  selectedAfterAmbiguity?: boolean;
}

function toXcuitest(configuration: RunnableXcuitestConfiguration): XcuitestTarget {
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
          : 'runnable_xcuitest',
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
  if (candidates.length === 0) {
    return {
      status: 'resolved',
      prefer: input.preference,
      resolvedPath: 'device_backend',
      selectionReason: 'no_runnable_xcuitest',
    };
  }
  return { status: 'ambiguous', prefer: 'auto', candidates: [...candidates] };
}
