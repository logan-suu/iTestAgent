/**
 * Recording types — interactive human-in-the-loop recording session.
 *
 * Task 3.13: Interactive Recording — Agent suggests next step + user confirms/corrects.
 * US-8.2 AC1-AC3: Agent suggestion → user confirm/modify/skip → execute → record RunStep.
 *
 * Shared types (SuggestedAction, RecordingStep, RecordingResult) are imported
 * from itestagent-contracts to avoid duplication (G2 contract validation).
 * Engine-specific types (state machine, callbacks, configuration) are defined here.
 */

import type { RecordingResult, RecordingStep, SuggestedAction } from 'itestagent-contracts';

// Re-export contracts types for convenience
export type { SuggestedAction, RecordingStep, RecordingResult };

// ─── Recording Session State ──────────────────────────────────────

/**
 * The state of an interactive recording session.
 *
 * Lifecycle:
 *   idle → suggesting → awaiting_confirmation → executing
 *     ↑                                          │
 *     └──────────── (loop back) ─────────────────┘
 *
 *   Any state → paused → (resume to previous state)
 *   Any state → cancelled | completed
 */
export type RecordingSessionState =
  | 'idle'
  | 'suggesting'
  | 'awaiting_confirmation'
  | 'executing'
  | 'paused'
  | 'completed'
  | 'cancelled';

// ─── User Response ────────────────────────────────────────────────

/**
 * User's response to an Agent suggestion.
 */
export type UserResponse =
  | { type: 'confirm' }
  | { type: 'modify'; modifiedAction: SuggestedAction }
  | { type: 'skip'; reason?: string }
  | { type: 'add_comment'; comment: string }
  | { type: 'pause' }
  | { type: 'resume' }
  | { type: 'cancel' };

// ─── Recording Session Config ─────────────────────────────────────

/**
 * Configuration for starting an interactive recording session.
 */
export interface RecordingSessionConfig {
  /** Device UDID */
  deviceId: string;
  /** App bundle ID under test */
  bundleId: string;
  /** Target kind per ADR-011 */
  targetKind: 'physical' | 'simulator';
  /** The feature or flow being recorded (e.g. "login", "checkout") */
  featureName: string;
  /** Backend name used for execution */
  backend: string;
  /** Maximum number of steps before auto-completing (optional, no limit if unset) */
  maxSteps?: number;
  /** Milliseconds to wait after each action for UI to settle */
  settleMs?: number;
}

// ─── Recording Events (Callback Communication) ────────────────────

/**
 * Events emitted by InteractiveRecorder to communicate with the TUI layer.
 *
 * These are callback-based events, not AgentEvent SSE events.
 * The TUI subscribes to these to update the RecordingPanel.
 */
export type RecordingEvent =
  | { type: 'state_changed'; state: RecordingSessionState }
  | { type: 'suggestion_ready'; suggestion: SuggestedAction; stepIndex: number }
  | { type: 'step_recorded'; recordingStep: RecordingStep; stepIndex: number }
  | { type: 'ui_tree_updated'; uiTree: string }
  | { type: 'error'; message: string; recoverable: boolean };
