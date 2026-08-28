import { z } from 'zod';

/**
 * Feed Memory scenario contracts — B05 scenario pack (promotion guide §6.2
 * "Feed Memory → compile-time scenario pack"; §6.3 denylist: real product
 * identifiers never enter the repo, so identity is INJECTED and the shipped
 * default is an obvious placeholder).
 */

export const FeedMemoryScenarioIdentitySchema = z
  .object({
    /** Target app bundle id — injected per environment, never baked in. */
    appBundleId: z.string().min(1),
    /** Entry route deep-link path (optional). */
    entryRoute: z.string().optional(),
  })
  .strict();

export type FeedMemoryScenarioIdentity = z.infer<typeof FeedMemoryScenarioIdentitySchema>;

/** Obviously-non-product placeholder; tests may rely on it being inert. */
export const FEED_MEMORY_PLACEHOLDER_IDENTITY: FeedMemoryScenarioIdentity = {
  appBundleId: 'com.example.feed.app',
};

export interface FeedMemoryScenarioOptions {
  rounds?: number;
  scrollsPerRound?: number;
}

export type FeedMemoryStepKind = 'launch_app' | 'scroll_feed' | 'sample_memory' | 'terminate_app';

export interface FeedMemoryScenarioStep {
  kind: FeedMemoryStepKind;
  /** Present on per-round steps. */
  roundIndex?: number;
  /** Present on scroll steps. */
  scrollIndex?: number;
}

export interface FeedMemoryScenarioPlan {
  identity: FeedMemoryScenarioIdentity;
  steps: FeedMemoryScenarioStep[];
}

/**
 * Emits the canonical feed-memory step sequence:
 * launch → (scroll × scrollsPerRound + sample) × rounds → terminate.
 */
export function buildFeedMemoryScenarioPlan(
  identity: FeedMemoryScenarioIdentity,
  options: FeedMemoryScenarioOptions = {},
): FeedMemoryScenarioPlan {
  FeedMemoryScenarioIdentitySchema.parse(identity);
  const rounds = options.rounds ?? 1;
  const scrollsPerRound = options.scrollsPerRound ?? 3;

  const steps: FeedMemoryScenarioStep[] = [{ kind: 'launch_app' }];
  for (let roundIndex = 0; roundIndex < rounds; roundIndex++) {
    for (let scrollIndex = 0; scrollIndex < scrollsPerRound; scrollIndex++) {
      steps.push({ kind: 'scroll_feed', roundIndex, scrollIndex });
    }
    steps.push({ kind: 'sample_memory', roundIndex });
  }
  steps.push({ kind: 'terminate_app' });

  return { identity, steps };
}
