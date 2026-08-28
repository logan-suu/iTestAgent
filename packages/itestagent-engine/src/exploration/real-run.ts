/**
 * Real-device run — compose the verified G5 chain into one engine entry:
 *
 *   AppiumDeviceBackend (physical, Route B) → DeviceExplorer exploration
 *   → UI-tree observation mapping → AssertionEvaluator → artifact-index.
 *
 * Every dependency is injectable so the composition is unit-testable without
 * a device; the real-device integration test exercises the live chain.
 */
import type {
  ArtifactIndex,
  AssertionEvaluateOutput,
  RunStep,
  UserAssertion,
} from 'itestagent-contracts';
import type { ArtifactStore } from 'itestagent-contracts';
import { writeArtifactIndex } from 'itestagent-store';
import { AssertionEvaluator } from '../assertion/assertion-evaluator.js';
import { type UiTreeCapture, observationsFromUiTrees } from './assertion-observations.js';
import { DeviceExplorer, type ExplorerToolDispatcher } from './device-explorer.js';
import type { ExplorationAction, ExplorationOptions } from './types.js';

/** Minimal backend surface the run needs (DeviceBackend subset). */
export interface RealRunBackend {
  getUiTree(input: { udid?: string }): Promise<{ raw: string; format: string; capturedAt: string }>;
  screenshot(input: { udid?: string }): Promise<{ id: string; type: string; path: string }>;
  launchApp(input: { bundleId: string }): Promise<{
    success: boolean;
    message?: string;
    error?: string;
  }>;
}

export interface RealDeviceRunOptions {
  /** Backend adapter (e.g. AppiumDeviceBackend configured for physical + Route B). */
  readonly backend: RealRunBackend;
  /** Tool dispatcher routing explorer tool calls to the backend. */
  readonly toolDispatcher: ExplorerToolDispatcher;
  /** Run directory (plan.yaml / artifacts / artifact-index.json land here). */
  readonly runDir: string;
  /** Run identifier recorded in artifact-index. */
  readonly runId: string;
  /** AUT bundle id. */
  readonly bundleId: string;
  /** Device UDID. */
  readonly deviceId: string;
  /** Target kind for the explorer (physical|simulator). */
  readonly targetKind: 'physical' | 'simulator';
  /** Ordered exploration actions. */
  readonly actions: readonly ExplorationAction[];
  /** User/profile assertions to evaluate against the captured trees (tier 1/2). */
  readonly assertions?: readonly UserAssertion[];
  /** Assertion policy override. Default: user_goal_then_profile_then_agent_confirmed. */
  readonly policy?: 'user_goal_then_profile_then_agent_confirmed' | 'explore_only';
  /** Artifact store for explorer evidence (optional). */
  readonly artifactStore?: ArtifactStore;
  /** Artifact refs captured by the dispatcher during the run (for artifact-index). */
  readonly artifactRefs?: readonly {
    id: string;
    type:
      | 'screenshot'
      | 'video'
      | 'uitree'
      | 'log'
      | 'crashlog'
      | 'trace'
      | 'xcresult'
      | 'json'
      | 'text';
    path: string;
  }[];
  /** Exploration tuning (settleMs etc). */
  readonly exploration?: Partial<ExplorationOptions>;
}

export interface RealDeviceRunResult {
  readonly runDir: string;
  readonly steps: readonly RunStep[];
  readonly assertion: AssertionEvaluateOutput;
  readonly artifactIndexPath: string | null;
  readonly artifactCount: number;
}

/** Wrap a DeviceBackend subset as the explorer's tool dispatcher. */
/** Dispatcher side-channel collecting artifact refs during the run. */
export interface ArtifactRefsProvider {
  getArtifactRefs(): readonly { id: string; type: 'screenshot'; path: string }[];
}

/** Pull dispatcher-collected refs when the dispatcher supports it. */
export function collectDispatcherArtifactRefs(
  dispatcher: ExplorerToolDispatcher,
): readonly { id: string; type: 'screenshot'; path: string }[] {
  const provider = dispatcher as Partial<ArtifactRefsProvider>;
  return provider.getArtifactRefs?.() ?? [];
}

export function createBackendToolDispatcher(
  backend: RealRunBackend,
): ExplorerToolDispatcher & ArtifactRefsProvider {
  const artifactRefs: { id: string; type: 'screenshot'; path: string }[] = [];
  return {
    getArtifactRefs() {
      return artifactRefs;
    },
    async dispatch(call) {
      const args = call.arguments as Record<string, string | undefined>;
      if (call.name === 'get_ui_tree') {
        const tree = await backend.getUiTree({ udid: args.deviceId });
        return { callId: call.id, status: 'ok', output: { raw: tree.raw, format: tree.format } };
      }
      if (call.name === 'launch_app') {
        const launched = await backend.launchApp({ bundleId: args.bundleId ?? '' });
        return { callId: call.id, status: launched.success ? 'ok' : 'error', output: launched };
      }
      if (call.name === 'screenshot') {
        const ref = await backend.screenshot({ udid: args.deviceId });
        artifactRefs.push({ id: ref.id, type: 'screenshot', path: ref.path });
        return {
          callId: call.id,
          status: 'ok',
          output: ref,
          artifacts: [{ id: ref.id, type: 'screenshot', path: ref.path, redactionStatus: 'safe' }],
        };
      }
      return {
        callId: call.id,
        status: 'error',
        output: { error: `Real-run dispatcher does not support tool "${call.name}"` },
      };
    },
  };
}

/**
 * Execute the real-device closed-loop slice: explore on device, evaluate
 * assertions on captured trees, persist artifact-index.json.
 */
export async function runRealDeviceExploration(
  options: RealDeviceRunOptions,
): Promise<RealDeviceRunResult> {
  const explorer = new DeviceExplorer(
    options.toolDispatcher,
    {
      deviceId: options.deviceId,
      bundleId: options.bundleId,
      targetKind: options.targetKind,
      runDir: options.runDir,
      ...options.exploration,
    },
    options.artifactStore,
  );

  const steps = await explorer.explore([...options.actions]);

  // Capture a fresh tree per case for observation mapping.
  const assertions = options.assertions ?? [];
  const caseIds = [...new Set(assertions.map((a) => a.caseId))];
  const uiTrees: UiTreeCapture[] = [];
  for (const caseId of caseIds) {
    const tree = await options.backend.getUiTree({ udid: options.deviceId });
    uiTrees.push({ caseId, raw: tree.raw });
  }

  const observations = observationsFromUiTrees(assertions, uiTrees);
  const evaluator = new AssertionEvaluator();
  const assertion = evaluator.evaluate({
    policy: options.policy ?? 'user_goal_then_profile_then_agent_confirmed',
    userAssertions: assertions.filter((a) => a.source === 'user'),
    profileAssertions: assertions.filter((a) => a.source === 'profile'),
    agentSuggestions: assertions.filter((a) => a.source === 'agent'),
    observations,
  });

  // Persist artifact-index.json from the refs collected by the dispatcher.
  let artifactIndexPath: string | null = null;
  let artifactCount = 0;
  const refs = options.artifactRefs ?? collectDispatcherArtifactRefs(options.toolDispatcher);
  artifactCount = refs.length;
  if (refs.length > 0) {
    const index: ArtifactIndex = {
      schemaVersion: 'itestagent.artifact-index.v1',
      runId: options.runId,
      artifacts: refs.map((a) => ({
        id: a.id,
        type: a.type,
        path: a.path,
        redactionStatus: 'safe',
      })),
    };
    const result = writeArtifactIndex(`${options.runDir}/artifacts`, index);
    artifactIndexPath = result.indexPath;
  }

  return {
    runDir: options.runDir,
    steps,
    assertion,
    artifactIndexPath,
    artifactCount,
  };
}
