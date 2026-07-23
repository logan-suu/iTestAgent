import type {
  AssertionEvaluateOutput,
  AssertionEvaluationResult,
  AssertionSource,
  UserAssertion,
} from 'itestagent-contracts';
import type { AssertionEvaluateInputSchema } from 'itestagent-contracts';
import type { z } from 'zod';

type EvaluateInput = z.input<typeof AssertionEvaluateInputSchema>;

/**
 * US-11.1 assertion strategy: 4-tier priority resolution (AC1).
 *
 * Tier 1: User-specified assertions (highest priority)
 * Tier 2: Profile-inferred expected outcomes
 * Tier 3: Agent-suggested assertions (confirmed by user)
 * Tier 4: Explore-only (no assertions → cannot pass)
 *
 * AC2: Explicit assertions → can judge passed/failed
 * AC3: No assertions → explored / inconclusive / needs_assertion only
 *
 * AGENTS.md §6:
 *   User-specified conditions > Profile targets > Agent suggestions (need confirmation) > exploration only;
 *   Without an assertion, cannot judge passed (explored / inconclusive / needs_assertion)
 */
export class AssertionEvaluator {
  /**
   * Evaluate assertions against exploration observations using AC1 priority tiers.
   *
   * Resolution order:
   *   1. If userAssertions exist → evaluate those (tier 1)
   *   2. Else if profileAssertions exist → evaluate those (tier 2)
   *   3. Else if agentConfirmed exist → evaluate those (tier 3)
   *   4. Else if policy is explore_only → explored (tier 4)
   *   5. Else if agentSuggestions exist (unconfirmed, tier 3 unconfirmed) → needs_assertion
   *   6. Else → explored (no assertions available)
   *
   * Within each tier, all conditions for a case must be satisfied for `passed`.
   * If any condition fails, the case is `failed`.
   * If conditions cannot be checked (unchecked), the case is `inconclusive`.
   */
  evaluate(input: EvaluateInput): AssertionEvaluateOutput {
    const { policy, observations } = input;
    const userAssertions = input.userAssertions ?? [];
    const profileAssertions = input.profileAssertions ?? [];
    const agentSuggestions = input.agentSuggestions ?? [];
    const agentConfirmed = input.agentConfirmed ?? [];

    // Determine which tier to use (AC1 priority)
    const tier = this.selectTier(
      policy,
      userAssertions,
      profileAssertions,
      agentConfirmed,
      agentSuggestions,
    );

    // evaluateAll is set only when a full tier of assertions is available
    if (tier.kind === 'assertions' && tier.assertions.length > 0) {
      return this.evaluateWithAssertions(tier.assertions, tier.source, observations ?? {});
    }

    if (tier.kind === 'suggestions' && tier.suggestions.length > 0) {
      // Agent has suggested assertions but user hasn't confirmed (AC4)
      return this.needsAssertionResult(
        'Agent has suggested assertions. User confirmation required.',
        tier.suggestions,
      );
    }

    if (tier.source === 'explore_only') {
      return this.exploredResult(
        policy === 'explore_only'
          ? 'Exploration only — no assertions configured (policy=explore_only).'
          : 'No assertions available. Run produced observations but no pass/fail criteria.',
      );
    }

    // Fallback: no assertions at all
    return this.exploredResult('No assertions available for any feature. Run status: explored.');
  }

  // ─── Tier Selection ──────────────────────────────────────────

  private selectTier(
    policy: string,
    userAssertions: UserAssertion[],
    profileAssertions: UserAssertion[],
    agentConfirmed: UserAssertion[],
    agentSuggestions: UserAssertion[],
  ): TierResult {
    // Tier 1: User assertions
    if (userAssertions.length > 0) {
      return { kind: 'assertions', assertions: userAssertions, source: 'user' };
    }

    // Tier 2: Profile-inferred
    if (profileAssertions.length > 0) {
      return { kind: 'assertions', assertions: profileAssertions, source: 'profile' };
    }

    // Tier 3: Agent-confirmed assertions
    if (agentConfirmed.length > 0) {
      return {
        kind: 'assertions',
        assertions: agentConfirmed,
        source: 'agent_confirmed',
      };
    }

    // Tier 3 unconfirmed: Agent suggestions exist but not confirmed
    if (agentSuggestions.length > 0) {
      return { kind: 'suggestions', suggestions: agentSuggestions, source: 'agent' };
    }

    // Tier 4: Explore only
    if (policy === 'explore_only') {
      return { kind: 'none', source: 'explore_only' };
    }

    return { kind: 'none', source: 'explore_only' };
  }

  // ─── Evaluation with Assertions ──────────────────────────────

  private evaluateWithAssertions(
    assertions: UserAssertion[],
    source: AssertionSource,
    observations: Record<string, Record<string, unknown>>,
  ): AssertionEvaluateOutput {
    const allEvaluations: AssertionEvaluationResult[] = [];
    let overallPassed = true;
    let anyFailed = false;
    let anyInconclusive = false;

    for (const assertion of assertions) {
      const evaluation = this.evaluateSingleAssertion(assertion, observations);
      allEvaluations.push(evaluation);
    }

    // Group evaluations by caseId to produce one entry per case
    const groupedByCase = new Map<string, AssertionEvaluationResult[]>();
    for (const ev of allEvaluations) {
      const existing = groupedByCase.get(ev.caseId) ?? [];
      existing.push(ev);
      groupedByCase.set(ev.caseId, existing);
    }

    const cases: AssertionEvaluateOutput['cases'] = [];
    for (const [caseId, evs] of groupedByCase) {
      // Aggregate: sum counts across all evaluations for this caseId
      let satisfied = 0;
      let unsatisfied = 0;
      let unchecked = 0;
      const allConditions: AssertionEvaluationResult['conditions'] = [];

      for (const ev of evs) {
        satisfied += ev.satisfiedCount;
        unsatisfied += ev.unsatisfiedCount;
        unchecked += ev.uncheckedCount;
        allConditions.push(...ev.conditions);
      }

      const merged: AssertionEvaluationResult = {
        assertionId: evs[0]?.assertionId ?? '',
        caseId,
        source,
        satisfiedCount: satisfied,
        unsatisfiedCount: unsatisfied,
        uncheckedCount: unchecked,
        totalCount: satisfied + unsatisfied + unchecked,
        conditions: allConditions,
      };

      const caseOk = unsatisfied === 0 && unchecked === 0 && satisfied > 0;
      const caseInconclusive = unchecked > 0;

      if (!caseOk) overallPassed = false;
      if (unsatisfied > 0) anyFailed = true;
      if (caseInconclusive) anyInconclusive = true;

      cases.push({
        caseId,
        status: this.caseStatus(
          merged,
          source,
        ) as AssertionEvaluateOutput['cases'][number]['status'],
        resolvedBy: source,
        evaluations: evs,
      });
    }

    const status = this.aggregateStatus(overallPassed, anyFailed, anyInconclusive);

    return {
      status,
      cases,
      summary: this.buildSummary(status, source, cases.length, allEvaluations),
    };
  }

  private evaluateSingleAssertion(
    assertion: UserAssertion,
    observations: Record<string, Record<string, unknown>>,
  ): AssertionEvaluationResult {
    const caseObs = observations[assertion.caseId] ?? {};
    const evaluatedConditions = assertion.conditions.map((cond) =>
      this.checkCondition(cond, caseObs),
    );

    const satisfiedCount = evaluatedConditions.filter((c) => c.satisfied === true).length;
    const unsatisfiedCount = evaluatedConditions.filter((c) => c.satisfied === false).length;
    const uncheckedCount = evaluatedConditions.filter((c) => c.satisfied === undefined).length;

    return {
      assertionId: assertion.id,
      caseId: assertion.caseId,
      source: assertion.source,
      satisfiedCount,
      unsatisfiedCount,
      uncheckedCount,
      totalCount: evaluatedConditions.length,
      conditions: evaluatedConditions,
    };
  }

  private checkCondition(
    condition: UserAssertion['conditions'][number],
    observations: Record<string, unknown>,
  ): UserAssertion['conditions'][number] {
    const { type, target, expected } = condition;

    if (!target && type !== 'no_crash') {
      // Can't check a condition without a target (except no_crash which is global)
      return {
        ...condition,
        satisfied: undefined,
        uncheckedReason: `Condition type "${type}" requires a target, but none was provided.`,
      };
    }

    switch (type) {
      case 'element_visible': {
        const key = target ? `${target}_visible` : '';
        if (key in observations) {
          return { ...condition, satisfied: observations[key] === true };
        }
        return {
          ...condition,
          satisfied: undefined,
          uncheckedReason: `Observation "${key}" not found in exploration results.`,
        };
      }

      case 'element_text': {
        const textKey = target ? `${target}_text` : '';
        if (textKey in observations) {
          const actual = String(observations[textKey]);
          const expectedStr = expected != null ? String(expected) : '';
          const matches = actual.toLowerCase().includes(expectedStr.toLowerCase());
          return { ...condition, satisfied: matches };
        }
        return {
          ...condition,
          satisfied: undefined,
          uncheckedReason: `Text observation "${textKey}" not found.`,
        };
      }

      case 'element_disabled': {
        const enabledKey = target ? `${target}_enabled` : '';
        if (enabledKey in observations) {
          return { ...condition, satisfied: observations[enabledKey] === false };
        }
        return {
          ...condition,
          satisfied: undefined,
          uncheckedReason: `Enabled observation "${enabledKey}" not found.`,
        };
      }

      case 'navigation_reached': {
        const navKey = target ? `${target}_reached` : '';
        if (navKey in observations) {
          return { ...condition, satisfied: observations[navKey] === true };
        }
        return {
          ...condition,
          satisfied: undefined,
          uncheckedReason: `Navigation observation "${navKey}" not found.`,
        };
      }

      case 'no_crash': {
        if ('crashDetected' in observations) {
          return { ...condition, satisfied: observations.crashDetected === false };
        }
        return {
          ...condition,
          satisfied: undefined,
          uncheckedReason: 'Crash detection observation not available.',
        };
      }

      case 'custom': {
        // Custom conditions require human judgment — always unchecked
        return {
          ...condition,
          satisfied: undefined,
          uncheckedReason: 'Custom assertion requires human evaluation.',
        };
      }

      default:
        return {
          ...condition,
          satisfied: undefined,
          uncheckedReason: `Unknown condition type: "${type}".`,
        };
    }
  }

  // ─── Status Resolution ───────────────────────────────────────

  private caseStatus(
    evaluation: AssertionEvaluationResult,
    source: AssertionSource,
  ): 'passed' | 'failed' | 'inconclusive' | 'needs_assertion' {
    // AC3: If no assertions were evaluable (all unchecked), cannot pass
    if (
      evaluation.satisfiedCount === 0 &&
      evaluation.unsatisfiedCount === 0 &&
      evaluation.uncheckedCount > 0
    ) {
      return source === 'agent' ? 'needs_assertion' : 'inconclusive';
    }

    // AC2: All conditions satisfied → passed
    if (
      evaluation.unsatisfiedCount === 0 &&
      evaluation.uncheckedCount === 0 &&
      evaluation.satisfiedCount > 0
    ) {
      return 'passed';
    }

    // Mixed: some unchecked, none failed
    if (evaluation.unsatisfiedCount === 0 && evaluation.uncheckedCount > 0) {
      return 'inconclusive';
    }

    // Any failure → failed
    return 'failed';
  }

  private aggregateStatus(
    allPassed: boolean,
    anyFailed: boolean,
    anyInconclusive: boolean,
  ): 'passed' | 'failed' | 'inconclusive' {
    if (allPassed) return 'passed';
    if (anyFailed) return 'failed';
    if (anyInconclusive) return 'inconclusive';
    return 'inconclusive';
  }

  // ─── Result Builders ─────────────────────────────────────────

  private needsAssertionResult(
    reason: string,
    suggestions: UserAssertion[],
  ): AssertionEvaluateOutput {
    return {
      status: 'needs_assertion',
      cases: [],
      summary: reason,
      suggestions,
    };
  }

  private exploredResult(reason: string): AssertionEvaluateOutput {
    return {
      status: 'explored',
      cases: [],
      summary: reason,
    };
  }

  private buildSummary(
    status: string,
    source: string,
    totalCases: number,
    evaluations: AssertionEvaluationResult[],
  ): string {
    const passed = evaluations.filter(
      (e) => e.unsatisfiedCount === 0 && e.uncheckedCount === 0 && e.satisfiedCount > 0,
    ).length;
    const failed = evaluations.filter((e) => e.unsatisfiedCount > 0).length;
    const inconclusive = evaluations.filter(
      (e) => e.unsatisfiedCount === 0 && e.uncheckedCount > 0,
    ).length;

    const parts = [
      `Status: ${status}`,
      `Source: ${source}`,
      `Cases: ${totalCases} total (${passed} passed, ${failed} failed, ${inconclusive} inconclusive)`,
    ];

    return parts.join('. ');
  }
}

// ─── Internal types ────────────────────────────────────────────

type TierResult =
  | { kind: 'assertions'; assertions: UserAssertion[]; source: AssertionSource }
  | { kind: 'suggestions'; suggestions: UserAssertion[]; source: AssertionSource }
  | { kind: 'none'; source: AssertionSource };
