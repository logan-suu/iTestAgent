/**
 * feed-memory-outcomes.test.ts — B05 scenario pack: typed outcomes for the
 * Feed Memory scenario (§6.2: the CORE keeps "typed outcome"; this file
 * types the scenario-specific verdicts on top).
 */
import { describe, expect, it } from 'bun:test';
import {
  FeedMemoryOutcomeSchema,
  summarizeRoundOutcomes,
} from '../src/scenarios/feed-memory-outcomes.js';

function roundOutcome(
  overrides: Partial<{ roundIndex: number; peakMB: number; breached: boolean }>,
) {
  return {
    kind: 'feed_memory_round' as const,
    roundIndex: overrides.roundIndex ?? 0,
    peakMB: overrides.peakMB ?? 18,
    thresholdMB: 20,
    breached: overrides.breached ?? false,
  };
}

describe('FeedMemoryOutcomeSchema', () => {
  it('accepts a well-formed round outcome', () => {
    const parsed = FeedMemoryOutcomeSchema.parse(roundOutcome({}));
    expect(parsed.kind).toBe('feed_memory_round');
  });

  it('rejects negative peaks or rounds', () => {
    expect(FeedMemoryOutcomeSchema.safeParse(roundOutcome({ peakMB: -1 })).success).toBe(false);
    expect(FeedMemoryOutcomeSchema.safeParse(roundOutcome({ roundIndex: -2 })).success).toBe(false);
  });
});

describe('summarizeRoundOutcomes', () => {
  it('reports regression when any round breaches its threshold', () => {
    const summary = summarizeRoundOutcomes([
      roundOutcome({ roundIndex: 0 }),
      roundOutcome({ roundIndex: 1, peakMB: 24, breached: true }),
    ]);
    expect(summary.verdict).toBe('regressed');
    expect(summary.breachedRounds).toEqual([1]);
    expect(summary.roundsObserved).toBe(2);
  });

  it('reports pass when all rounds stay within thresholds', () => {
    const summary = summarizeRoundOutcomes([roundOutcome({}), roundOutcome({ roundIndex: 1 })]);
    expect(summary.verdict).toBe('passed');
    expect(summary.breachedRounds).toEqual([]);
  });

  it('returns inconclusive for an empty series (R5: no fabricated verdict)', () => {
    expect(summarizeRoundOutcomes([]).verdict).toBe('inconclusive');
  });
});
