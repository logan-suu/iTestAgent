/**
 * Recording contracts — Zod schemas for interactive recording session output.
 *
 * Task 3.13: Interactive Recording output schema (raw recording JSON).
 * Consumed by Task 3.15 for Flow YAML compilation.
 *
 * US-8.2 AC2: Confirmed steps are solidified into replayable Flow.
 */

import { z } from 'zod';
import { RunStepSchema } from './data-contracts.js';

// ─── Suggested Action ─────────────────────────────────────────────

/**
 * Schema for the Agent's suggested action.
 *
 * US-8.2 AC1: Agent gives suggested action each step.
 */
export const SuggestedActionSchema = z.object({
  action: z.enum(['tap', 'swipe', 'input', 'screenshot', 'wait', 'launch']),
  target: z.string(),
  text: z.string().optional(),
  direction: z.enum(['up', 'down', 'left', 'right']).optional(),
  waitMs: z.number().int().positive().optional(),
  bundleId: z.string().optional(),
  reasoning: z.string().min(1, 'Agent must provide reasoning for its suggestion'),
  confidence: z.number(),
  suggestedLocator: z
    .object({
      strategy: z.string(),
      value: z.string(),
    })
    .optional(),
});

export type SuggestedAction = z.infer<typeof SuggestedActionSchema>;

// ─── Recording Step ───────────────────────────────────────────────

/**
 * Schema for a recorded step in an interactive session.
 *
 * Wraps the underlying RunStep with recording-specific metadata
 * including whether the user modified or skipped the Agent's suggestion.
 */
export const RecordingStepSchema = z.object({
  /** The underlying RunStep (null when skipped — no execution occurred) */
  step: RunStepSchema.nullable(),
  /** The Agent's original suggestion before any user modification */
  originalSuggestion: SuggestedActionSchema,
  /** Whether the user modified the original suggestion before execution */
  userModified: z.boolean(),
  /** Whether the user chose to skip this step (no execution) */
  skipped: z.boolean(),
  /** User's reason for skipping */
  skipReason: z.string().optional(),
  /** User comment attached to this step */
  userComment: z.string().optional(),
});

export type RecordingStep = z.infer<typeof RecordingStepSchema>;

// ─── Recording Result (Raw Recording JSON) ────────────────────────

/**
 * Schema for the output of an interactive recording session.
 *
 * This is the "raw recording JSON" consumed by Task 3.15 for Flow compilation.
 * Validated via G2 (contract validation) before persistence.
 */
export const RecordingResultSchema = z.object({
  /** Unique session identifier */
  sessionId: z.string(),
  /** The feature or flow that was recorded */
  featureName: z.string(),
  /** Backend used for execution */
  backend: z.string(),
  /** Target device info */
  device: z.object({
    udid: z.string(),
    targetKind: z.enum(['physical', 'simulator']),
  }),
  /** App under test */
  app: z.object({
    bundleId: z.string(),
  }),
  /** Session state when recording ended */
  endState: z.enum([
    'idle',
    'suggesting',
    'awaiting_confirmation',
    'executing',
    'paused',
    'completed',
    'cancelled',
  ]),
  /** All recorded steps in order */
  steps: z.array(RecordingStepSchema),
  /** ISO 8601 timestamp when recording started */
  startedAt: z.string(),
  /** ISO 8601 timestamp when recording ended (if completed/cancelled) */
  completedAt: z.string().optional(),
  /** Total number of confirmed steps executed */
  confirmedCount: z.number().int().nonnegative(),
  /** Number of steps skipped by user */
  skippedCount: z.number().int().nonnegative(),
  /** Whether the recording was cancelled before completion */
  cancelled: z.boolean(),
});

export type RecordingResult = z.infer<typeof RecordingResultSchema>;

// ─── Helpers ──────────────────────────────────────────────────────

/**
 * Parse and validate a raw recording result.
 * Returns the validated RecordingResult or throws a ZodError.
 */
export function parseRecordingResult(data: unknown): RecordingResult {
  return RecordingResultSchema.parse(data);
}

/**
 * Safely parse a raw recording result.
 * Returns { success: true, data } or { success: false, error }.
 */
export function safeParseRecordingResult(
  data: unknown,
): { success: true; data: RecordingResult } | { success: false; error: z.ZodError } {
  return RecordingResultSchema.safeParse(data);
}
