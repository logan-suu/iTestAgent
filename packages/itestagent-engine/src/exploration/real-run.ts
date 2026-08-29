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
import { type SuggestionResult, suggestAssertions } from './assertion-suggester.js';
import { DeviceExplorer, type ExplorerToolDispatcher } from './device-explorer.js';
import type { ExplorationAction, ExplorationOptions } from './types.js';

/** Minimal backend surface the run needs (DeviceBackend subset). */
export interface BackendActionResult {
  success: boolean;
  message?: string;
  error?: string;
}

export interface RealRunBackend {
  getUiTree(input: { udid?: string }): Promise<{ raw: string; format: string; capturedAt: string }>;
  screenshot(input: { udid?: string }): Promise<{ id: string; type: string; path: string }>;
  launchApp(input: { bundleId: string }): Promise<BackendActionResult>;
  /** Interaction primitives — optional; backends declare capability support. */
  tap?(input: {
    udid?: string;
    x: number;
    y: number;
    accessibilityId?: string;
  }): Promise<BackendActionResult>;
  swipe?(input: {
    udid?: string;
    fromX: number;
    fromY: number;
    toX: number;
    toY: number;
    durationMs?: number;
  }): Promise<BackendActionResult>;
  typeText?(input: { udid?: string; text: string }): Promise<BackendActionResult>;
  pressButton?(input: { udid?: string; button: string }): Promise<BackendActionResult>;
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
  /**
   * Optional LLM suggestion hook: when no user/profile assertions are given,
   * the captured UI tree is offered to the LLM to propose tier-3 suggestions
   * (US-11.1 AC4 — suggestions surface as needs_assertion, confirmed via the
   * TUI panel).
   */
  readonly llmSuggest?: {
    generate: (prompt: string) => Promise<string>;
    goal: string;
    featureName?: string;
  };
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
  /** LLM-proposed tier-3 suggestions when llmSuggest was used (AC4). */
  readonly llmSuggestions?: readonly UserAssertion[];
  readonly llmReason?: string;
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
      if (call.name === 'tap') {
        if (!backend.tap) {
          return {
            callId: call.id,
            status: 'error',
            output: { error: 'backend does not support tap' },
          };
        }
        const result = await backend.tap({
          udid: args.deviceId,
          x: Number(args.x ?? 0),
          y: Number(args.y ?? 0),
          accessibilityId: args.accessibilityId,
        });
        return { callId: call.id, status: result.success ? 'ok' : 'error', output: result };
      }
      if (call.name === 'swipe') {
        if (!backend.swipe) {
          return {
            callId: call.id,
            status: 'error',
            output: { error: 'backend does not support swipe' },
          };
        }
        const result = await backend.swipe({
          udid: args.deviceId,
          fromX: Number(args.fromX ?? 0),
          fromY: Number(args.fromY ?? 0),
          toX: Number(args.toX ?? 0),
          toY: Number(args.toY ?? 0),
          durationMs: args.durationMs ? Number(args.durationMs) : undefined,
        });
        return { callId: call.id, status: result.success ? 'ok' : 'error', output: result };
      }
      if (call.name === 'type_text') {
        if (!backend.typeText) {
          return {
            callId: call.id,
            status: 'error',
            output: { error: 'backend does not support typeText' },
          };
        }
        const result = await backend.typeText({
          udid: args.deviceId,
          text: String(args.text ?? ''),
        });
        return { callId: call.id, status: result.success ? 'ok' : 'error', output: result };
      }
      if (call.name === 'press_button') {
        if (!backend.pressButton) {
          return {
            callId: call.id,
            status: 'error',
            output: { error: 'backend does not support pressButton' },
          };
        }
        const result = await backend.pressButton({
          udid: args.deviceId,
          button: String(args.button ?? 'home'),
        });
        return { callId: call.id, status: result.success ? 'ok' : 'error', output: result };
      }
      if (call.name === 'screenshot') {
        const ref = await backend.screenshot({ udid: args.deviceId });
        if (!ref.path) {
          // A capture failure must not surface as a successful artifact (R5).
          return {
            callId: call.id,
            status: 'error',
            output: { error: `Screenshot capture produced no artifact (id: ${ref.id})` },
          };
        }
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
      // Tuning overrides first — run identity must never be overridable.
      ...options.exploration,
      deviceId: options.deviceId,
      bundleId: options.bundleId,
      targetKind: options.targetKind,
      runDir: options.runDir,
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
  if (caseIds.length === 0 && options.llmSuggest) {
    const tree = await options.backend.getUiTree({ udid: options.deviceId });
    uiTrees.push({ caseId: 'exploration', raw: tree.raw });
  }

  const observations = observationsFromUiTrees(assertions, uiTrees);

  let llmSuggestions: readonly UserAssertion[] = [];
  let llmReason: string | undefined;
  if (
    !assertions.some((a) => a.source === 'user' || a.source === 'profile') &&
    options.llmSuggest
  ) {
    const suggestion = await suggestAssertions(
      {
        goal: options.llmSuggest.goal,
        uiTree: uiTrees[0]?.raw ?? '',
        featureName: options.llmSuggest.featureName,
      },
      { generate: options.llmSuggest.generate },
    );
    llmSuggestions = suggestion.suggestions;
    llmReason = suggestion.reason;
  }

  const evaluator = new AssertionEvaluator();
  const assertion = evaluator.evaluate({
    policy: options.policy ?? 'user_goal_then_profile_then_agent_confirmed',
    userAssertions: assertions.filter((a) => a.source === 'user'),
    profileAssertions: assertions.filter((a) => a.source === 'profile'),
    agentSuggestions: [...assertions.filter((a) => a.source === 'agent'), ...llmSuggestions],
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
    ...(options.llmSuggest ? { llmSuggestions, llmReason } : {}),
  };
}
