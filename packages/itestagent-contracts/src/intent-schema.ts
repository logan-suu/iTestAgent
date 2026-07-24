import { z } from 'zod';
import { TargetKindSchema } from './device-types.js';

/**
 * Intent schema — S1 phase: natural language → structured intent.
 *
 * Data Flow Specification §4:
 *   Intent { goal, targetHint, targetKind?, deviceHint, features?, metricsHint?, scope }
 *
 * Key points:
 *   - Intent is a draft; it does NOT trigger execution
 *   - Missing critical info (device/target) triggers TUI clarification prompts
 *   - Intent is decoupled from TestPlan, enabling multi-turn refinement
 */

// ─── Scope ────────────────────────────────────────────────────

/**
 * Test scope enumeration.
 * smoke:    smoke test (quick critical path verification)
 * explore:  exploratory testing (no preset path)
 * full:     full regression
 * perf:     performance-only
 * custom:   user-defined combination
 */
export const ScopeSchema = z.enum(['smoke', 'explore', 'full', 'perf', 'custom']);

export type Scope = z.infer<typeof ScopeSchema>;

// ─── Intent ───────────────────────────────────────────────────

/**
 * Structured test intent.
 *
 * Required fields:
 *   - goal: denoised natural-language summary of the testing goal (not raw sourceText).
 *   - features: matched feature names from ProjectProfile.features (by name or keyword).
 *   - metricsRequested: whether the user asked for performance metrics.
 *   - scope: test scope.
 *   - sourceText: original user input (for audit trail, immutable).
 *
 * Optional fields:
 *   - targetKind: physical | simulator (missing → clarification prompt).
 *   - deviceHint: device description from user (e.g., "iPhone 14 Plus").
 */
export const IntentSchema = z.object({
  /** Denoised testing goal, e.g., "run login smoke test" */
  goal: z.string().min(1),
  /** Human-readable target description (e.g., "my iPhone", "iPhone Simulator") */
  targetHint: z.string().optional(),
  /** Execution target kind; missing means clarification is needed */
  targetKind: TargetKindSchema.optional(),
  /** Device hint from user input */
  deviceHint: z.string().optional(),
  /** Matched features from ProjectProfile (optional — empty = no features matched) */
  features: z.array(z.string()).optional().default([]),
  /** Whether performance metrics were requested */
  metricsRequested: z.boolean(),
  /** Detailed metrics hint from user input (e.g. 'fps+hitches' vs 'memory only') */
  metricsHint: z.string().optional(),
  /** Test scope */
  scope: ScopeSchema,
  /** Original user input (immutable audit trail) */
  sourceText: z.string().min(1),
});

export type Intent = z.infer<typeof IntentSchema>;

// ─── Clarification ────────────────────────────────────────────

/**
 * Clarification item — displayed in TUI when Intent is missing critical info.
 */
export const ClarificationSchema = z.object({
  /** Human-readable prompt text */
  question: z.string().min(1),
  /** Intent field to populate */
  field: z.enum(['targetKind', 'deviceHint', 'features', 'scope', 'metricsRequested']),
  /** Suggested answer options (displayed as shortcuts in TUI) */
  options: z.array(z.string()).optional(),
});

export type Clarification = z.infer<typeof ClarificationSchema>;

// ─── IntentParseResult ────────────────────────────────────────

/**
 * Complete parse result — all required info is present.
 */
export const CompleteResultSchema = z.object({
  status: z.literal('complete'),
  intent: IntentSchema,
});

/**
 * Incomplete parse result — missing critical info; TUI should prompt user.
 */
export const IncompleteResultSchema = z.object({
  status: z.literal('incomplete'),
  intent: IntentSchema,
  clarificationsNeeded: z.array(ClarificationSchema).min(1),
});

/**
 * Intent parse result (discriminated union).
 *
 * complete:   all critical fields filled; ready for S3 (TestPlan compilation).
 * incomplete: targetKind or features missing; TUI displays clarification prompts.
 */
export const IntentParseResultSchema = z.discriminatedUnion('status', [
  CompleteResultSchema,
  IncompleteResultSchema,
]);

export type IntentParseResult = z.infer<typeof IntentParseResultSchema>;
export type CompleteResult = z.infer<typeof CompleteResultSchema>;
export type IncompleteResult = z.infer<typeof IncompleteResultSchema>;

// ─── Parse helper ─────────────────────────────────────────────

/**
 * Safely parse an IntentParseResult.
 * Invalid fields throw ZodError.
 */
export function parseIntentResult(raw: unknown): IntentParseResult {
  return IntentParseResultSchema.parse(raw);
}
