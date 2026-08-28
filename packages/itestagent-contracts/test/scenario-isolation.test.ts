/**
 * scenario-isolation.test.ts — B05 boundary gate (promotion guide §9 Stage 1
 * "场景 contracts 放入 scenarios/**，只通过 itestagent-contracts/scenarios
 * subpath 导出；root barrel 不导出 scenario symbols").
 *
 * Locks the subpath boundary in BOTH directions:
 *   1. the root barrel must NOT re-export any scenario symbol;
 *   2. the scenarios subpath must be importable and export its own surface.
 */
import { describe, expect, it } from 'bun:test';

describe('scenario isolation (guide §9 Stage 1)', () => {
  it('root barrel does not leak scenario symbols', async () => {
    const root = (await import('../src/index.js')) as Record<string, unknown>;
    const forbidden = [
      'FeedMemoryScenarioIdentitySchema',
      'FEED_MEMORY_PLACEHOLDER_IDENTITY',
      'buildFeedMemoryScenarioPlan',
      'FeedMemoryOutcomeSchema',
      'summarizeRoundOutcomes',
      'MemoryProfileScenarioParamsSchema',
      'MEMORY_PROFILE_CALIBRATION',
      'buildMemoryProfilePlan',
    ];
    for (const symbol of forbidden) {
      expect(symbol in root).toBe(false);
    }
  });

  it('scenarios subpath exports the pack surface', async () => {
    const pack = (await import('../src/scenarios/index.js')) as Record<string, unknown>;
    for (const symbol of [
      'FeedMemoryScenarioIdentitySchema',
      'buildFeedMemoryScenarioPlan',
      'FeedMemoryOutcomeSchema',
      'summarizeRoundOutcomes',
      'MemoryProfileScenarioParamsSchema',
      'buildMemoryProfilePlan',
    ]) {
      expect(typeof pack[symbol]).not.toBe('undefined');
    }
  });

  it('core analysis module stays product-neutral (no scenario imports)', async () => {
    const { readFileSync } = await import('node:fs');
    const analysisSource = readFileSync(new URL('../src/analysis.ts', import.meta.url), 'utf-8');
    expect(analysisSource.includes('scenarios/')).toBe(false);
    expect(analysisSource.includes("from './scenarios")).toBe(false);
  });
});
