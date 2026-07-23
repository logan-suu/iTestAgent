/**
 * Flow compiler — converts RecordingResult (task 3.13 output) into FlowV2.
 *
 * Task 3.15: RecordingResult → FlowV2 transformation pipeline.
 * US-8.2 AC2: Confirmed steps are solidified into replayable Flow.
 * US-9.2 AC1: Level 2 Replayable Flow — self-owned iTestAgent Flow YAML.
 *
 * Architecture §6.7 requirements:
 *   (1) Normalize element locators (no Appium-specific locator)
 *   (2) Capture requiredCapabilities and supportedTargetKinds
 *   (3) Record lastValidatedTargets
 *   (4) Flow schema validation
 *   (5) Add safetyGate for irreversible operations
 *   (6) Mark unsupported targets as blocked
 */
import type { RecordingResult, RecordingStep } from 'itestagent-contracts';
import type { FlowStepV2, FlowV2, LocatorV2, ValidatedTarget } from './schema.js';

// ─── Action Normalization Table ───────────────────────────────────

/**
 * Maps raw RunStep/SuggestedAction action strings to normalized Flow action enum.
 *
 * Handles both:
 *   - SuggestedAction.action (already normalized: tap, swipe, input, launch, wait, screenshot)
 *   - RunStep.action (raw Appium strings: mobile: tap, executeScript, etc.)
 *
 * Unknown actions are preserved as "comment" steps with the original action
 * in the comment field. This prevents silent data loss (R5: no silent degradation).
 */
const ACTION_MAP: Record<string, FlowStepV2['action']> = {
  tap: 'tap',
  'mobile: tap': 'tap',
  doubletap: 'tap',
  swipe: 'swipe',
  'mobile: swipe': 'swipe',
  'mobile: dragFromToForDuration': 'swipe',
  input: 'typeText',
  typeText: 'typeText',
  'mobile: type': 'typeText',
  sendKeys: 'typeText',
  screenshot: 'screenshot',
  'mobile: screenshot': 'screenshot',
  takeScreenshot: 'screenshot',
  wait: 'wait',
  'mobile: waitFor': 'wait',
  launch: 'launchApp',
  launchApp: 'launchApp',
  'mobile: launchApp': 'launchApp',
  terminate: 'terminateApp',
  terminateApp: 'terminateApp',
  'mobile: terminateApp': 'terminateApp',
  longPress: 'longPress',
  'mobile: longPress': 'longPress',
  pressButton: 'pressButton',
  'mobile: pressButton': 'pressButton',
  openUrl: 'openUrl',
  'mobile: openUrl': 'openUrl',
  getUiTree: 'getUiTree',
  'mobile: source': 'getUiTree',
  startRecording: 'startRecording',
  'mobile: startScreenRecording': 'startRecording',
  stopRecording: 'stopRecording',
  'mobile: stopScreenRecording': 'stopRecording',
  collectLogs: 'collectLogs',
  'mobile: pullFile': 'collectLogs',
  assertVisible: 'assertVisible',
  assertNotVisible: 'assertNotVisible',
  assertText: 'assertText',
};

/**
 * Normalize a raw action string to a FlowStepV2 action.
 *
 * Known actions are mapped directly.
 * Unknown actions become "comment" steps — the original action
 * is preserved in the comment field for auditability.
 *
 * Returns null if the action should become a comment step
 * (caller should create a comment step with the original action).
 */
function normalizeAction(rawAction: string): FlowStepV2['action'] | null {
  const normalized = rawAction.trim();
  const lower = normalized.toLowerCase();
  const mapped = ACTION_MAP[normalized] ?? ACTION_MAP[lower];
  if (mapped) {
    // "comment" is a valid action but should not be returned as a mapped result
    // — it's the fallback for unmapped actions.
    return mapped === 'comment' ? null : mapped;
  }
  return null;
}

// ─── Locator Normalization ────────────────────────────────────────

/**
 * Normalize a SuggestedAction locator to a Flow LocatorV2.
 *
 * Removes Appium-specific strategy values (e.g. "accessibility id" → "identifier").
 */
function normalizeLocator(suggestedLocator?: {
  strategy: string;
  value: string;
}): LocatorV2 | undefined {
  if (!suggestedLocator) return undefined;

  const strategyMap: Record<string, LocatorV2['strategy']> = {
    label: 'label',
    'accessibility label': 'label',
    'accessibility id': 'identifier',
    identifier: 'identifier',
    id: 'identifier',
    name: 'identifier',
    xpath: 'xpath',
    coordinate: 'coordinate',
    image: 'image',
  };

  const strategy = strategyMap[suggestedLocator.strategy.toLowerCase()] ?? 'label';

  return { strategy, value: suggestedLocator.value };
}

// ─── Capability Inference ─────────────────────────────────────────

/**
 * Backend-name → required capabilities mapping.
 *
 * Architecture §6.7: "requiredCapabilities — normalized, not Appium-specific".
 * The capabilities describe WHAT the flow needs, not HOW a specific backend provides it.
 */
const BACKEND_CAPABILITY_MAP: Record<string, string[]> = {
  appium: ['uiTree', 'coordinateTap', 'swipe', 'screenshot', 'textInput'],
  'appium-wda': ['uiTree', 'coordinateTap', 'swipe', 'screenshot', 'textInput'],
  'mobile-mcp': ['uiTree', 'coordinateTap', 'screenshot', 'location', 'push'],
  'iphone-use': ['visualScreenshot', 'visualTap'],
};

/**
 * Infer required capabilities from the backend name.
 *
 * Falls back to a conservative list for unknown backends.
 */
function inferCapabilities(backendName: string): string[] {
  const lower = backendName.toLowerCase();
  for (const [key, caps] of Object.entries(BACKEND_CAPABILITY_MAP)) {
    if (lower.includes(key)) return caps;
  }
  return ['uiTree', 'coordinateTap']; // conservative default
}

// ─── kebab-case Generator ─────────────────────────────────────────

/**
 * Generate a flowId from a feature name.
 *
 * Converts human-readable names like "Login Smoke Test" to
 * kebab-case identifiers like "login-smoke-test".
 */
function toFlowId(featureName: string): string {
  return (
    featureName
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, '')
      .trim()
      .replace(/\s+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '') || 'untitled-flow'
  );
}

// ─── Step Compiler ────────────────────────────────────────────────

/**
 * Compile a single RecordingStep into a FlowStepV2.
 *
 * Filtering rules:
 *   - Skipped steps are excluded (return null).
 *   - Steps without an underlying RunStep (step is null) are excluded.
 *   - Steps with unmapped actions become comment steps.
 */
function compileStep(recStep: RecordingStep, stepIndex: number): FlowStepV2 | null {
  // Skip: excluded from flow (US-8.2 AC2: only confirmed steps are solidified)
  if (recStep.skipped) return null;

  // No underlying RunStep: nothing to replay
  if (!recStep.step) return null;

  const runStep = recStep.step;
  const rawAction = runStep.action ?? 'unknown';

  const normalizedAction = normalizeAction(rawAction);

  // Unmapped action: preserve as comment step
  if (!normalizedAction) {
    return {
      action: 'comment',
      comment: `[unmapped: ${rawAction}] target="${runStep.target ?? 'unknown'}" — original step ${stepIndex}`,
    };
  }

  const locator = normalizeLocator(recStep.originalSuggestion?.suggestedLocator);

  const flowStep: FlowStepV2 = {
    action: normalizedAction,
    target: runStep.target,
    locator,
    durationMs: runStep.durationMs,
    safetyGate: runStep.safetyGate,
  };

  // Copy optional fields from SuggestedAction
  if (recStep.originalSuggestion) {
    const sug = recStep.originalSuggestion;
    if (sug.text) flowStep.value = sug.text;
    if (sug.direction) flowStep.direction = sug.direction;
    if (sug.waitMs) flowStep.durationMs = flowStep.durationMs ?? sug.waitMs;
    if (sug.bundleId && normalizedAction === 'launchApp') {
      flowStep.value = sug.bundleId;
    }
  }

  // Attach user comment if present
  if (recStep.userComment) {
    flowStep.comment = recStep.userComment;
  }

  return flowStep;
}

// ─── Main Compiler ────────────────────────────────────────────────

/**
 * Compile a RecordingResult into a FlowV2 object.
 *
 * Pipeline:
 *   1. Generate flowId from featureName
 *   2. Filter skipped/null steps
 *   3. Normalize actions and locators
 *   4. Infer capabilities from backend name
 *   5. Build validated target from device info
 *   6. Set flow status based on recording endState
 *
 * US-9.2 AC3: Flow contains flowId/source/status/steps.
 * US-8.2 AC3: Exploration is NOT replayable until solidified as Flow.
 *
 * @param recording - The RecordingResult from task 3.13 interactive recording
 * @returns A validated FlowV2 object
 * @throws If no steps remain after filtering (flow must have at least 1 step)
 */
export function compileFlow(recording: RecordingResult): FlowV2 {
  // Step 1: Generate flowId
  const flowId = toFlowId(recording.featureName);

  // Step 2: Compile steps (filter skipped, normalize actions)
  const compiledSteps: FlowStepV2[] = [];
  for (let i = 0; i < recording.steps.length; i++) {
    const recStep = recording.steps[i];
    if (!recStep) continue;
    const flowStep = compileStep(recStep, i);
    if (flowStep) {
      compiledSteps.push(flowStep);
    }
  }

  if (compiledSteps.length === 0) {
    throw new Error(
      `Cannot compile flow "${flowId}": no executable steps remain after filtering. ` +
        `Recording had ${recording.steps.length} total steps ` +
        `(${recording.confirmedCount} confirmed, ${recording.skippedCount} skipped).`,
    );
  }

  // Step 3: Build validated target
  const validatedTarget: ValidatedTarget = {
    kind: recording.device.targetKind,
    udid: recording.device.udid,
    // Full device info (deviceTypeIdentifier, runtimeIdentifier, model, osVersion)
    // is populated lazily by the replay engine — compiler does not shell out.
  };

  // Step 4: Map endState to flow status
  const status: FlowV2['status'] = recording.endState === 'completed' ? 'draft' : 'draft';
  // R7: Flow is always "draft" until user explicitly confirms.
  // Even cancelled recordings can be compiled — they just won't be confirmed.

  // Step 5: Build notes with recording context
  const skippedInfo = recording.skippedCount > 0 ? `${recording.skippedCount} steps skipped` : null;
  const modifiedInfo =
    recording.steps.filter((s) => s.userModified).length > 0
      ? `${recording.steps.filter((s) => s.userModified).length} steps user-modified`
      : null;
  const cancelledNote = recording.cancelled ? '(recording was cancelled before completion)' : null;

  const contextNotes = [
    `Compiled from recording session ${recording.sessionId}`,
    `Recording started: ${recording.startedAt}`,
    recording.completedAt ? `Recording ended: ${recording.completedAt}` : null,
    `Backend: ${recording.backend}`,
    `App: ${recording.app.bundleId}`,
    `Confirmed: ${recording.confirmedCount} steps`,
    skippedInfo,
    modifiedInfo,
    cancelledNote,
  ]
    .filter(Boolean)
    .join('. ');

  return {
    schemaVersion: 'itestagent.flow.v2' as const,
    flowId,
    source: 'agent-recorded',
    status,
    supportedTargetKinds: [recording.device.targetKind],
    requiredCapabilities: inferCapabilities(recording.backend),
    lastValidatedTargets: [validatedTarget],
    steps: compiledSteps,
    notes: contextNotes,
  };
}
