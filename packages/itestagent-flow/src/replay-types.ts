/**
 * Replay type contracts — B08 module split (promotion guide §11.3 "Flow
 * replay/redaction"). Moved verbatim from the former replay.ts monolith;
 * this module is the shared vocabulary for the replay module family:
 *
 *   replay-types (here) → replay-locator / replay-action-utils /
 *   replay-evidence-writer → replay-interaction / replay-observation /
 *   replay-assertion → replay-step (dispatcher) → replay-engine (loop)
 *   → replay.ts (facade)
 */
import type { DeviceBackend, TargetKind } from 'itestagent-contracts';
import type { FlowStepV2 } from './schema.js';

/** Options for FlowReplayEngine.replayFlow(). */
export interface ReplayOptions {
  /** Explicit target kind; never inferred from Flow array order (ADR-033). */
  targetKind: TargetKind;
  /** Device identifier (UDID for iOS, serial for Android) */
  deviceId: string;
  /** Stable replay identifier used to derive step IDs. */
  runId?: string;
  /** Directory for raw local replay evidence before T6.8 RunStore integration. */
  evidenceDirectory?: string;
  /** Bundle ID for launchApp/terminateApp actions (fallback when step has no value) */
  bundleId?: string;
  /** AbortSignal for cancellation (ADR-010) */
  signal?: AbortSignal;
  /** Called before each step executes */
  onStepStart?: (stepIndex: number, step: FlowStepV2) => void;
  /** Called when a step has safetyGate: 'ask'. Return true to proceed, false to skip. */
  onSafetyGate?: (step: FlowStepV2) => Promise<boolean>;
  /** Resolve test-data and secret references in memory; resolved values are never persisted. */
  resolveValueRef?: (reference: string) => Promise<string | undefined>;
  /** Collect screenshot + page source evidence after each step (default: true) */
  collectEvidence?: boolean;
}

/** Target compatibility check result (ADR-011). */
export interface TargetCompatibilityResult {
  ok: boolean;
  /** If ok=false, the reason the target is incompatible */
  reason?: string;
  /** The requested targetKind */
  requested: TargetKind;
  /** The matching supported targetKinds */
  supported: TargetKind[];
}

/** Backend/session context shared by every per-step handler module. */
export interface StepHandlerContext {
  backend: DeviceBackend;
  deviceId: string;
  bundleId: string | undefined;
  signal: AbortSignal | undefined;
  evidenceDirectory?: string;
  stepId?: string;
  caseId?: string;
  resolveValueRef?: (reference: string) => Promise<string | undefined>;
}
