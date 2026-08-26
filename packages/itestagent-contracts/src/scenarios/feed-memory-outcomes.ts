import { z } from 'zod';

/**
 * Typed outcomes for the Feed Memory scenario — B05 scenario pack (§6.2:
 * the CORE keeps "typed outcome"; this module types the scenario-specific
 * per-round verdicts on top of core analysis results).
 */

export const FEED_MEMORY_OUTCOME_KINDS = ['feed_memory_round'] as const;

export const FeedMemoryOutcomeSchema = z
  .object({
    kind: z.literal('feed_memory_round'),
    roundIndex: z.number().int().nonnegative(),
    peakMB: z.number().nonnegative(),
    thresholdMB: z.number().positive(),
    breached: z.boolean(),
  })
  .strict();

export type FeedMemoryOutcome = z.infer<typeof FeedMemoryOutcomeSchema>;

export interface FeedMemoryScenarioSummary {
  verdict: 'passed' | 'regressed' | 'inconclusive';
  roundsObserved: number;
  /** Round indices whose threshold was breached, ascending. */
  breachedRounds: number[];
  worstPeakMB: number | null;
}

/**
 * Folds per-round outcomes into a scenario verdict.
 * Empty input is inconclusive — never a fabricated pass (R5).
 */
export function summarizeRoundOutcomes(
  outcomes: readonly FeedMemoryOutcome[],
): FeedMemoryScenarioSummary {
  if (outcomes.length === 0) {
    return { verdict: 'inconclusive', roundsObserved: 0, breachedRounds: [], worstPeakMB: null };
  }

  const breachedRounds = outcomes
    .filter((outcome) => outcome.breached)
    .map((outcome) => outcome.roundIndex)
    .sort((a, b) => a - b);

  return {
    verdict: breachedRounds.length > 0 ? 'regressed' : 'passed',
    roundsObserved: outcomes.length,
    breachedRounds,
    worstPeakMB: Math.max(...outcomes.map((outcome) => outcome.peakMB)),
  };
}
