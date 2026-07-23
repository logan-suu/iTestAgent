/**
 * Recording review — pure function helpers for the recording UI state.
 *
 * Task 3.13: Interactive Recording.
 * US-8.2 AC1: Agent suggests action → user confirms/modifies/skips.
 *
 * These are framework-independent pure functions consumed by
 * both the TuiShell reducer and the RecordingPanel renderer.
 * No imports from itestagent-engine or SolidJS — pure logic only.
 */

// ─── Status Display ──────────────────────────────────────────────

/**
 * Map recording state to a human-readable status label.
 */
export function formatRecordingStatus(state: string): string {
  switch (state) {
    case 'idle':
      return 'Initializing...';
    case 'suggesting':
      return 'Agent is thinking...';
    case 'awaiting_confirmation':
      return 'Awaiting your input';
    case 'executing':
      return 'Executing...';
    case 'paused':
      return '⏸ Paused';
    case 'completed':
      return 'Recording complete';
    case 'cancelled':
      return 'Recording cancelled';
    default:
      return state;
  }
}

/**
 * Whether the status indicates the recording is actively running.
 */
export function isRecordingActive(state: string): boolean {
  return ['suggesting', 'awaiting_confirmation', 'executing'].includes(state);
}

/**
 * Whether the user can currently interact (confirm/modify/skip).
 */
export function canUserRespond(state: string): boolean {
  return state === 'awaiting_confirmation';
}

/**
 * Whether the recording has ended (completed or cancelled).
 */
export function isRecordingEnded(state: string): boolean {
  return state === 'completed' || state === 'cancelled';
}

// ─── Step Summary ────────────────────────────────────────────────

/**
 * Human-readable label for an action type.
 */
export function formatActionLabel(action: string): string {
  switch (action) {
    case 'tap':
      return 'Tap';
    case 'swipe':
      return 'Swipe';
    case 'input':
      return 'Type';
    case 'screenshot':
      return 'Screenshot';
    case 'wait':
      return 'Wait';
    case 'launch':
      return 'Launch';
    default:
      return action;
  }
}

/**
 * Short summary of a single recorded step for display.
 */
export function summarizeStep(step: unknown): string {
  const s = step as Record<string, unknown>;
  if (!s) return '';

  if (s.skipped) {
    const ogSuggestion = s.originalSuggestion as Record<string, unknown> | undefined;
    return `⊘ Skipped: ${ogSuggestion?.target ?? 'unknown'}`;
  }

  const stepData = s.step as Record<string, unknown> | undefined;
  const ogSuggestion = s.originalSuggestion as Record<string, unknown> | undefined;
  const action = stepData?.action ?? ogSuggestion?.action ?? '?';
  const target = stepData?.target ?? ogSuggestion?.target ?? '';
  const modified = s.userModified ? ' [modified]' : '';

  return `✓ ${formatActionLabel(String(action))}: ${target}${modified}`;
}

// ─── Suggestion Display ──────────────────────────────────────────

/**
 * Extract displayable fields from a suggested action (unknown for TUI).
 */
export function formatSuggestions(action: unknown): string[] {
  const a = action as Record<string, unknown>;
  if (!a) return [];

  const parts: string[] = [];
  if (a.target) parts.push(`Target: ${a.target}`);
  if (a.text) parts.push(`Text: ${a.text}`);
  if (a.direction) parts.push(`Direction: ${a.direction}`);
  if (a.waitMs) parts.push(`Wait: ${a.waitMs}ms`);
  if (a.bundleId) parts.push(`App: ${a.bundleId}`);
  if (typeof a.confidence === 'number') {
    parts.push(
      `Confidence: ${Number.isNaN(a.confidence) ? 'N/A' : `${Math.round(a.confidence * 100)}%`}`,
    );
  }

  return parts;
}

// ─── Progress ────────────────────────────────────────────────────

/**
 * Build progress summary text for the recording session.
 */
export function formatRecordingProgress(
  stepIndex: number,
  totalSteps: number,
  featureName: string,
): string {
  return `Recording "${featureName}" — Step ${stepIndex + 1} (${totalSteps} recorded)`;
}

// ─── Keyboard Hints ──────────────────────────────────────────────

/**
 * Get contextual keyboard shortcut hints based on recording state.
 */
export function getRecordingKeyHints(state: string): string[] {
  if (state === 'awaiting_confirmation') {
    return ['Enter: Confirm', 'm: Modify', 's: Skip', 'p: Pause', 'q: Cancel'];
  }

  if (state === 'paused') {
    return ['r: Resume', 'q: Cancel'];
  }

  if (isRecordingEnded(state)) {
    return ['q: Exit'];
  }

  return [];
}
