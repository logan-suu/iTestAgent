/**
 * feed-memory.test.ts — B05 scenario pack: Feed Memory scenario contracts
 * (promotion guide §6.2 "Feed Memory → compile-time scenario pack"; product
 * identity is INJECTED/PLACEHOLDER — the pack never ships real app
 * identifiers, denylist §6.3).
 */
import { describe, expect, it } from 'bun:test';
import {
  FEED_MEMORY_PLACEHOLDER_IDENTITY,
  FeedMemoryScenarioIdentitySchema,
  buildFeedMemoryScenarioPlan,
} from '../src/scenarios/feed-memory.js';

describe('FeedMemoryScenarioIdentitySchema', () => {
  it('accepts an injected identity', () => {
    const parsed = FeedMemoryScenarioIdentitySchema.parse({
      appBundleId: 'com.yourco.feedapp',
      entryRoute: '/home/feed',
    });
    expect(parsed.appBundleId).toBe('com.yourco.feedapp');
  });

  it('rejects an empty bundle id (identity must be explicit)', () => {
    expect(FeedMemoryScenarioIdentitySchema.safeParse({ appBundleId: '' }).success).toBe(false);
  });

  it('rejects unknown keys — no free-form metadata smuggling into the pack', () => {
    expect(
      FeedMemoryScenarioIdentitySchema.safeParse({ appBundleId: 'x', udid: 'REAL-UDID' }).success,
    ).toBe(false);
  });
});

describe('FEED_MEMORY_PLACEHOLDER_IDENTITY', () => {
  it('is an obviously non-product placeholder, not a real bundle id', () => {
    expect(FEED_MEMORY_PLACEHOLDER_IDENTITY.appBundleId).toBe('com.example.feed.app');
    expect(FEED_MEMORY_PLACEHOLDER_IDENTITY.appBundleId).not.toContain('yourco');
  });
});

describe('buildFeedMemoryScenarioPlan', () => {
  const identity = { appBundleId: 'com.example.feed.app' };

  it('emits scroll-observe rounds with typed step ids', () => {
    const plan = buildFeedMemoryScenarioPlan(identity, { rounds: 2, scrollsPerRound: 2 });
    expect(plan.identity.appBundleId).toBe('com.example.feed.app');
    expect(plan.steps.map((step) => step.kind)).toEqual([
      'launch_app',
      'scroll_feed',
      'scroll_feed',
      'sample_memory',
      'scroll_feed',
      'scroll_feed',
      'sample_memory',
      'terminate_app',
    ]);
    const scrolls = plan.steps.filter((step) => step.kind === 'scroll_feed');
    expect(scrolls).toHaveLength(4);
    for (const scroll of scrolls) {
      expect(scroll.roundIndex).toBeDefined();
    }
  });

  it('defaults to a single round with the calibration scroll count when no options given', () => {
    const plan = buildFeedMemoryScenarioPlan(identity, {});
    const scrolls = plan.steps.filter((step) => step.kind === 'scroll_feed');
    expect(scrolls.length).toBeGreaterThanOrEqual(1);
  });
});
