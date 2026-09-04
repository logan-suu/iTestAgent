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
import { redactUiTreeForModel } from '../context-builder.js';
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
  /** Input shapes align with the contracts DeviceBackend (deviceId required). */
  getUiTree(
    input: { deviceId: string },
    signal?: AbortSignal,
  ): Promise<{
    raw: string;
    format: string;
    capturedAt: string;
  }>;
  screenshot(
    input: { deviceId: string },
    signal?: AbortSignal,
  ): Promise<{ id: string; type: string; path: string }>;
  launchApp(input: { bundleId: string }, signal?: AbortSignal): Promise<BackendActionResult>;
  /** Interaction primitives — optional; backends declare capability support. */
  tap?(
    input: {
      deviceId: string;
      x: number;
      y: number;
      accessibilityId?: string;
    },
    signal?: AbortSignal,
  ): Promise<BackendActionResult>;
  swipe?(
    input: {
      deviceId: string;
      fromX: number;
      fromY: number;
      toX: number;
      toY: number;
      durationMs?: number;
    },
    signal?: AbortSignal,
  ): Promise<BackendActionResult>;
  typeText?(
    input: { deviceId: string; text: string },
    signal?: AbortSignal,
  ): Promise<BackendActionResult>;
  pressButton?(
    input: { deviceId: string; button: string },
    signal?: AbortSignal,
  ): Promise<BackendActionResult>;
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
  /** Ordered precomputed actions (primarily tests and explicit replay-like callers). */
  readonly actions?: readonly ExplorationAction[];
  /** Dynamic low-risk Agent exploration inside confirmed TestPlan feature boundaries. */
  readonly dynamicActions?: {
    readonly cases: readonly string[];
    readonly maxStepsPerCase?: number;
    readonly suggest: (input: {
      caseId: string;
      uiTree: string;
      history: readonly RunStep[];
      signal?: AbortSignal;
    }) => Promise<ExplorationAction | 'done'>;
    readonly authorizeSensitiveAction?: (input: {
      callId: string;
      action: 'interact_sensitive_ui';
      resource: string;
    }) => Promise<boolean>;
  };
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
    generate: (prompt: string, signal?: AbortSignal) => Promise<string>;
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
      | 'syslog'
      | 'crashlog'
      | 'trace'
      | 'xcresult'
      | 'json'
      | 'text';
    path: string;
  }[];
  /** Exploration tuning (settleMs etc). */
  readonly exploration?: Partial<ExplorationOptions>;
  /** Transitional legacy index publication. Production composition must leave this false. */
  readonly publishLegacyArtifactIndex?: boolean;
  /** One cancellation signal shared with dispatcher, backend, and caller-owned cleanup. */
  readonly signal?: AbortSignal;
}

export interface RealDeviceRunResult {
  readonly runDir: string;
  readonly steps: readonly RunStep[];
  readonly assertion: AssertionEvaluateOutput;
  readonly artifactIndexPath: string | null;
  readonly artifactCount: number;
  readonly artifacts: readonly ArtifactIndex['artifacts'][number][];
  /** LLM-proposed tier-3 suggestions when llmSuggest was used (AC4). */
  readonly llmSuggestions?: readonly UserAssertion[];
  readonly llmReason?: string;
}

const SENSITIVE_UI_TARGET =
  /\b(delete|remove|erase|purchase|buy|pay|checkout|subscribe|account|sign[ -]?out|log[ -]?out|security|privacy|permission|authorize|allow access|password|passcode|otp|token|card)\b/i;

/** Classify semantic side effects independently of the low-level action verb. */
export function isSensitiveUiAction(action: ExplorationAction): boolean {
  return (
    (action.action === 'tap' || action.action === 'input') &&
    SENSITIVE_UI_TARGET.test(action.target ?? '')
  );
}

/** Ask the configured model for one low-risk action within a confirmed case. */
export async function suggestExplorationAction(input: {
  generate: (prompt: string, signal?: AbortSignal) => Promise<string>;
  caseId: string;
  uiTree: string;
  history: readonly RunStep[];
  signal?: AbortSignal;
}): Promise<ExplorationAction | 'done'> {
  const response = await input.generate(
    [
      'You are exploring an iOS app inside a confirmed TestPlan case.',
      `CASE: ${input.caseId}`,
      `COMPLETED ACTIONS: ${input.history.map((step) => `${step.action}:${step.target ?? ''}:${step.status}`).join(', ') || '(none)'}`,
      'CURRENT UI TREE:',
      redactUiTreeForModel(input.uiTree).slice(0, 12000),
      '',
      'Return exactly one JSON object. Allowed low-risk actions are tap, swipe, input, screenshot, wait.',
      'Use {"action":"done"} when the case goal is reached or no safe progress is possible.',
      'For an action include target and, when applicable, text, direction, or waitMs.',
    ].join('\n'),
    input.signal,
  );
  const match = response.match(/\{[\s\S]*\}/);
  if (!match) throw new Error(`exploration_suggestion_invalid: no JSON action for ${input.caseId}`);
  const parsed = JSON.parse(match[0]) as Record<string, unknown>;
  if (parsed.action === 'done') return 'done';
  if (!['tap', 'swipe', 'input', 'screenshot', 'wait'].includes(String(parsed.action))) {
    throw new Error(
      `exploration_suggestion_blocked: unsupported or high-risk action "${String(parsed.action)}"`,
    );
  }
  if (typeof parsed.target !== 'string' || parsed.target.length === 0) {
    throw new Error(`exploration_suggestion_invalid: target is required for ${input.caseId}`);
  }
  return {
    action: parsed.action as ExplorationAction['action'],
    target: parsed.target,
    ...(typeof parsed.text === 'string' ? { text: parsed.text } : {}),
    ...(parsed.direction === 'up' ||
    parsed.direction === 'down' ||
    parsed.direction === 'left' ||
    parsed.direction === 'right'
      ? { direction: parsed.direction }
      : {}),
    ...(typeof parsed.waitMs === 'number' && Number.isFinite(parsed.waitMs)
      ? { waitMs: Math.max(1, Math.trunc(parsed.waitMs)) }
      : {}),
  };
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
  signal?: AbortSignal,
): ExplorerToolDispatcher & ArtifactRefsProvider {
  const artifactRefs: { id: string; type: 'screenshot'; path: string }[] = [];
  return {
    getArtifactRefs() {
      return artifactRefs;
    },
    async dispatch(call) {
      const args = call.arguments as Record<string, string | undefined>;
      if (call.name === 'get_ui_tree') {
        const tree = await backend.getUiTree({ deviceId: String(args.deviceId ?? '') }, signal);
        return { callId: call.id, status: 'ok', output: { raw: tree.raw, format: tree.format } };
      }
      if (call.name === 'launch_app') {
        const launched = await backend.launchApp({ bundleId: args.bundleId ?? '' }, signal);
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
        const result = await backend.tap(
          {
            deviceId: String(args.deviceId ?? ''),
            x: Number(args.x ?? 0),
            y: Number(args.y ?? 0),
            accessibilityId: args.accessibilityId,
          },
          signal,
        );
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
        const result = await backend.swipe(
          {
            deviceId: String(args.deviceId ?? ''),
            fromX: Number(args.fromX ?? 0),
            fromY: Number(args.fromY ?? 0),
            toX: Number(args.toX ?? 0),
            toY: Number(args.toY ?? 0),
            durationMs: args.durationMs ? Number(args.durationMs) : undefined,
          },
          signal,
        );
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
        const result = await backend.typeText(
          {
            deviceId: String(args.deviceId ?? ''),
            text: String(args.text ?? ''),
          },
          signal,
        );
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
        const result = await backend.pressButton(
          {
            deviceId: String(args.deviceId ?? ''),
            button: String(args.button ?? 'home'),
          },
          signal,
        );
        return { callId: call.id, status: result.success ? 'ok' : 'error', output: result };
      }
      if (call.name === 'screenshot') {
        const ref = await backend.screenshot({ deviceId: String(args.deviceId ?? '') }, signal);
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
          artifacts: [
            { id: ref.id, type: 'screenshot', path: ref.path, redactionStatus: 'raw-local-only' },
          ],
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
  options.signal?.throwIfAborted();
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

  if (options.dynamicActions) {
    // The first model observation must describe the confirmed AUT, not whichever app was active.
    await explorer.explore([]);
    const maxSteps = options.dynamicActions.maxStepsPerCase ?? 12;
    for (const caseId of options.dynamicActions.cases) {
      for (let index = 0; index < maxSteps; index += 1) {
        options.signal?.throwIfAborted();
        const tree = await options.backend.getUiTree(
          { deviceId: options.deviceId },
          options.signal,
        );
        const suggestion = await options.dynamicActions.suggest({
          caseId,
          uiTree: redactUiTreeForModel(tree.raw),
          history: explorer.getSteps().filter((step) => step.caseId === caseId),
          signal: options.signal,
        });
        options.signal?.throwIfAborted();
        if (suggestion === 'done') break;
        if (isSensitiveUiAction(suggestion)) {
          const authorize = options.dynamicActions.authorizeSensitiveAction;
          if (!authorize) {
            throw new Error(
              `exploration_permission_required: sensitive UI action blocked for "${suggestion.target ?? 'unknown'}"`,
            );
          }
          const allowed = await authorize({
            callId: `exploration_sensitive_${caseId}_${index + 1}`,
            action: 'interact_sensitive_ui',
            resource: `${caseId}:${suggestion.target ?? 'unknown'}`,
          });
          if (!allowed) {
            throw new Error(
              `exploration_permission_denied: sensitive UI action denied for "${suggestion.target ?? 'unknown'}"`,
            );
          }
        }
        await explorer.explore([{ ...suggestion, caseId }]);
      }
    }
  } else {
    await explorer.explore([...(options.actions ?? [])]);
  }
  const steps = explorer.getSteps();

  const assertions = options.assertions ?? [];
  const latestCheckpointByCase = new Map<string, UiTreeCapture>();
  for (const checkpoint of explorer.getCheckpoints()) {
    const owner = steps.find((step) => step.stepId === checkpoint.stepId);
    if (owner?.status !== 'completed') continue;
    latestCheckpointByCase.set(checkpoint.caseId, {
      caseId: checkpoint.caseId,
      raw: checkpoint.raw,
    });
  }
  const uiTrees = [...latestCheckpointByCase.values()];
  if (uiTrees.length === 0 && options.llmSuggest) {
    const tree = await options.backend.getUiTree({ deviceId: options.deviceId }, options.signal);
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
        uiTree: redactUiTreeForModel(uiTrees[0]?.raw ?? ''),
        featureName: options.llmSuggest.featureName,
      },
      { generate: options.llmSuggest.generate },
      options.signal,
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
  const artifacts: ArtifactIndex['artifacts'] = refs.map((a) => {
    const owner = steps.find((step) => step.artifacts.includes(a.id));
    return {
      id: a.id,
      type: a.type,
      path: a.path,
      relatedStep: owner?.stepId,
      relatedCase: owner?.caseId,
      redactionStatus: 'raw-local-only' as const,
    };
  });
  if (refs.length > 0 && options.publishLegacyArtifactIndex === true) {
    const index: ArtifactIndex = {
      schemaVersion: '2.0',
      runId: options.runId,
      artifacts,
      collectionOutcomes: refs.map((artifact) => {
        const owner = steps.find((step) => step.artifacts.includes(artifact.id));
        return {
          type: artifact.type,
          status: 'collected' as const,
          reasonCode: 'collected',
          artifactId: artifact.id,
          relatedStep: owner?.stepId,
          relatedCase: owner?.caseId,
        };
      }),
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
    artifacts,
    ...(options.llmSuggest ? { llmSuggestions, llmReason } : {}),
  };
}
