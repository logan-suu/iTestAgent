import { z } from 'zod';

/**
 * Assertion schemas — US-11.1 assertion strategy types.
 *
 * AGENTS.md §6:
 *   用户明确条件 > Profile 目标 > Agent 建议(需确认) > 仅探索
 *   无断言不判 passed(explored/inconclusive/needs_assertion)
 *
 * Data Flow Specification §10 S7:
 *   cases: [{id, status, durationMs}]
 *
 * Data Flow Specification §16:
 *   探索不可判定 → case.status=explored/inconclusive/needs_assertion
 */

// ─── Assertion Condition Types ─────────────────────────────────

/**
 * Types of conditions that can be asserted against a device/app state.
 *
 * element_visible  — A specific UI element is visible on screen
 * element_text     — A UI element contains specific text
 * element_disabled — A UI element exists but is not interactable
 * navigation_reached — A specific screen/view was reached (e.g. "home screen")
 * no_crash         — The app did not crash during the test
 * custom           — Free-form condition expressed in natural language
 */
export const AssertionConditionTypeSchema = z.enum([
  'element_visible',
  'element_text',
  'element_disabled',
  'navigation_reached',
  'no_crash',
  'custom',
]);

export type AssertionConditionType = z.infer<typeof AssertionConditionTypeSchema>;

// ─── Single Assertion Condition ────────────────────────────────

/**
 * A single assertion condition with its evaluation result.
 *
 * AC2: 有明确断言时可判 passed
 * AC3: 无明确断言时不能判 passed
 *
 * A condition is `satisfied` when evidence confirms the expectation,
 * `unsatisfied` when evidence contradicts it, and `unchecked` when
 * evidence is insufficient to determine either way (R5: never fabricate).
 */
export const AssertionConditionSchema = z.object({
  /** Type of this assertion condition */
  type: AssertionConditionTypeSchema,
  /** Human-readable description of what is being asserted */
  description: z.string(),
  /** Target: element identifier, screen name, or other context */
  target: z.string().optional(),
  /** Expected value (e.g. text content, boolean true/false) */
  expected: z.unknown().optional(),
  /** Whether this condition was verified and satisfied */
  satisfied: z.boolean().optional(),
  /** When satisfied is absent, reason why it couldn't be checked (R5) */
  uncheckedReason: z.string().optional(),
});

export type AssertionCondition = z.infer<typeof AssertionConditionSchema>;

// ─── Assertion Source (AC1 priority tier) ──────────────────────

/**
 * Priority tier of an assertion's origin (AC1).
 *
 * user           — 用户明确成功条件（最高优先级，AC1 tier 1）
 * profile        — Project Profile 推断目标（AC1 tier 2）
 * agent          — Agent 建议（待用户确认，AC1 tier 3）
 * agent_confirmed — Agent 建议并经用户确认（AC1 tier 3 confirmed）
 * explore_only   — 仅探索不判定（AC1 tier 4）
 */
export const AssertionSourceSchema = z.enum([
  'user',
  'profile',
  'agent',
  'agent_confirmed',
  'explore_only',
]);

export type AssertionSource = z.infer<typeof AssertionSourceSchema>;

// ─── User Assertion (per-feature assertion set) ────────────────

/**
 * A set of assertion conditions associated with a specific feature or test case.
 *
 * Each UserAssertion bundles one or more AssertionConditions for a feature.
 * Multiple UserAssertions can exist for the same caseId at different priority tiers.
 *
 * AC1: When resolving, the highest-tier assertion's conditions take precedence.
 * AC4: Agent-suggested assertions carry evidence to justify the suggestion.
 */
export const UserAssertionSchema = z.object({
  /** Unique identifier for this assertion set */
  id: z.string(),
  /** Associated feature name or test case identifier */
  caseId: z.string(),
  /** Human-readable label */
  label: z.string().optional(),
  /** Assertion source priority tier (AC1) */
  source: AssertionSourceSchema,
  /** Individual assertion conditions */
  conditions: z.array(AssertionConditionSchema).min(1),
  /** Evidence that supports this assertion (especially for agent-suggested, AC4) */
  evidence: z.array(z.string()).optional(),
});

export type UserAssertion = z.infer<typeof UserAssertionSchema>;

// ─── Assertion Evaluation Result ───────────────────────────────

/**
 * Result of evaluating a UserAssertion against observed exploration outcomes.
 *
 * satisfiedCount   — Number of conditions that passed
 * unsatisfiedCount — Number of conditions that failed
 * uncheckedCount   — Number of conditions that couldn't be checked (R5)
 * totalCount       — Total number of conditions
 */
export const AssertionEvaluationResultSchema = z.object({
  assertionId: z.string(),
  caseId: z.string(),
  source: AssertionSourceSchema,
  satisfiedCount: z.number().int().nonnegative(),
  unsatisfiedCount: z.number().int().nonnegative(),
  uncheckedCount: z.number().int().nonnegative(),
  totalCount: z.number().int().nonnegative(),
  /** Individual condition evaluations */
  conditions: z.array(AssertionConditionSchema),
});

export type AssertionEvaluationResult = z.infer<typeof AssertionEvaluationResultSchema>;

// ─── Aggregate Status Resolution Input ─────────────────────────

/**
 * Input to the AssertionEvaluator.evaluate() method.
 * Bundles all assertion sources together with exploration observations.
 */
export const AssertionEvaluateInputSchema = z.object({
  /** Assertion policy from TestPlan (user_goal_then_profile_then_agent_confirmed | explore_only) */
  policy: z.enum(['user_goal_then_profile_then_agent_confirmed', 'explore_only']),
  /** User-specified assertions (AC1 tier 1 — highest priority) */
  userAssertions: z.array(UserAssertionSchema).optional().default([]),
  /** Profile-inferred assertions (AC1 tier 2) */
  profileAssertions: z.array(UserAssertionSchema).optional().default([]),
  /** Agent-suggested assertions awaiting confirmation (AC1 tier 3, unconfirmed) */
  agentSuggestions: z.array(UserAssertionSchema).optional().default([]),
  /** Agent-suggested assertions that user confirmed (AC1 tier 3, confirmed) */
  agentConfirmed: z.array(UserAssertionSchema).optional().default([]),
  /** Flat map of observed facts from exploration, keyed by caseId.
   *  Each value is a record of fact names to observed values.
   *  Example: { "login": { "homeScreenVisible": true, "loginButtonTapped": true } }
   */
  observations: z.record(z.string(), z.record(z.string(), z.unknown())).optional().default({}),
});

export type AssertionEvaluateInput = z.infer<typeof AssertionEvaluateInputSchema>;

// ─── Assertion Evaluate Output ─────────────────────────────────

/**
 * Output from AssertionEvaluator.evaluate().
 * Returns the resolved RunStatus and per-case evaluation details.
 */
export const AssertionEvaluateOutputSchema = z.object({
  /** Resolved status applying AC1 priority tiers */
  status: z.enum(['passed', 'failed', 'explored', 'inconclusive', 'needs_assertion']),
  /** Per-case evaluation results */
  cases: z.array(
    z.object({
      caseId: z.string(),
      status: z.enum(['passed', 'failed', 'explored', 'inconclusive', 'needs_assertion']),
      /** The source tier that determined this case's status */
      resolvedBy: AssertionSourceSchema,
      /** Detailed assertion condition evaluations */
      evaluations: z.array(AssertionEvaluationResultSchema).optional(),
    }),
  ),
  /** Human-readable summary of the overall result */
  summary: z.string(),
  /** When status is `needs_assertion`: suggested assertions the user may want to add (AC4) */
  suggestions: z.array(UserAssertionSchema).optional(),
});

export type AssertionEvaluateOutput = z.infer<typeof AssertionEvaluateOutputSchema>;
