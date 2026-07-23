/**
 * Recording types — interactive human-in-the-loop recording session.
 *
 * Task 3.13: Interactive Recording — Agent suggests next step + user confirms/corrects.
 * US-8.2 AC1-AC3: Agent suggestion → user confirm/modify/skip → execute → record RunStep.
 *
 * These types define the recording session state machine, the Agent's suggested
 * actions, and the output format (raw recording JSON) consumed by Task 3.15 Flow
 * compilation.
 */

import type { RunStep } from 'itestagent-contracts';
import type { ExplorationAction } from '../exploration/types.js';

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
  | 'idle' // Session created, not yet started
  | 'suggesting' // Agent is analyzing UI tree and generating suggestion
  | 'awaiting_confirmation' // Suggestion displayed, waiting for user response
  | 'executing' // Executing confirmed action on device
  | 'paused' // User paused the recording
  | 'completed' // Recording finished normally
  | 'cancelled'; // Recording cancelled by user

// ─── Suggested Action ─────────────────────────────────────────────

/**
 * An action suggested by the Agent based on current UI tree analysis.
 *
 * Extends ExplorationAction with:
 * - reasoning: why the Agent suggests this action
 * - confidence: how sure the Agent is (0-1)
 * - suggestedLocator: how the Agent proposes to locate the target element
 */
export interface SuggestedAction {
  /** The action the Agent recommends (tap, swipe, input, etc.) */
  action: ExplorationAction['action'];
  /** Human-readable target description */
  target: string;
  /** Input text (for 'input' action) */
  text?: string;
  /** Swipe direction (for 'swipe' action) */
  direction?: 'up' | 'down' | 'left' | 'right';
  /** Wait duration in ms (for 'wait' action) */
  waitMs?: number;
  /** Bundle ID to launch (for 'launch' action) */
  bundleId?: string;
  /** Agent's reasoning for this suggestion */
  reasoning: string;
  /** Agent's confidence in this suggestion (0-1, where 1 = highly confident) */
  confidence: number;
  /** How the Agent proposes to locate the target element */
  suggestedLocator?: {
    strategy: string;
    value: string;
  };
}

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

// ─── Recording Step ───────────────────────────────────────────────

/**
 * A recorded step in an interactive recording session.
 *
 * Wraps a RunStep with recording-specific metadata:
 * - whether the user modified the Agent's suggestion
 * - whether the user skipped this step
 * - any user comment added
 */
export interface RecordingStep {
  /** The underlying RunStep (may be null if skipped) */
  step: RunStep | null;
  /** The Agent's original suggestion (before any user modification) */
  originalSuggestion: SuggestedAction;
  /** Whether the user modified the original suggestion before execution */
  userModified: boolean;
  /** Whether the user chose to skip this step (no execution) */
  skipped: boolean;
  /** User's reason for skipping (only set when skipped) */
  skipReason?: string;
  /** User comment attached to this step */
  userComment?: string;
}

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

// ─── Recording Result (Raw Recording JSON) ────────────────────────

/**
 * The output of an interactive recording session.
 *
 * This is the "raw recording JSON" consumed by Task 3.15 for Flow compilation.
 * It contains all recorded steps plus session metadata.
 */
export interface RecordingResult {
  /** Unique session identifier */
  sessionId: string;
  /** The feature or flow that was recorded */
  featureName: string;
  /** Backend used for execution */
  backend: string;
  /** Target device info */
  device: {
    udid: string;
    targetKind: 'physical' | 'simulator';
  };
  /** App under test */
  app: {
    bundleId: string;
  };
  /** Session state when recording ended */
  endState: RecordingSessionState;
  /** All recorded steps in order */
  steps: RecordingStep[];
  /** ISO 8601 timestamp when recording started */
  startedAt: string;
  /** ISO 8601 timestamp when recording ended (if completed/cancelled) */
  completedAt?: string;
  /** Total number of confirmed steps executed */
  confirmedCount: number;
  /** Number of steps skipped by user */
  skippedCount: number;
  /** Whether the recording was cancelled before completion */
  cancelled: boolean;
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
