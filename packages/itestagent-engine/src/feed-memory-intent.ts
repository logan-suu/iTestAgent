/**
 * Feed Memory intent — B16 module split (promotion guide §11.3 "engine
 * analysis/intents"; B05 scenario pack).
 *
 * Builds the engine-side intent for a feed-memory scenario from an injected
 * app identity (product-neutral; never baked-in, §6.2).
 */

export interface FeedMemoryIntentInput {
  appBundleId: string;
}

export interface FeedMemoryIntent {
  scope: 'feed-memory';
  appBundleId: string;
}

export function buildFeedMemoryIntent(input: FeedMemoryIntentInput): FeedMemoryIntent {
  return { scope: 'feed-memory', appBundleId: input.appBundleId };
}
