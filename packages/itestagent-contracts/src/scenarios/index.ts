/**
 * Scenario pack barrel — B05 (promotion guide §9 Stage 1: scenario
 * contracts are exported ONLY through the `itestagent-contracts/scenarios`
 * subpath; the root barrel never re-exports these symbols — enforced by
 * test/scenario-isolation.test.ts).
 *
 * Compile-time registration only (§9 Stage 2B): no dynamic discovery.
 */
export {
  FEED_MEMORY_PLACEHOLDER_IDENTITY,
  FeedMemoryScenarioIdentitySchema,
  buildFeedMemoryScenarioPlan,
} from './feed-memory.js';
export type {
  FeedMemoryScenarioIdentity,
  FeedMemoryScenarioOptions,
  FeedMemoryScenarioPlan,
  FeedMemoryScenarioStep,
  FeedMemoryStepKind,
} from './feed-memory.js';

export { FeedMemoryOutcomeSchema, summarizeRoundOutcomes } from './feed-memory-outcomes.js';
export type { FeedMemoryOutcome, FeedMemoryScenarioSummary } from './feed-memory-outcomes.js';

export {
  MEMORY_PROFILE_CALIBRATION,
  MemoryProfileScenarioParamsSchema,
  buildMemoryProfilePlan,
} from './memory-profile.js';
export type {
  MemoryProfileRoundPlan,
  MemoryProfileScenarioParams,
  MemoryProfileScenarioPlan,
} from './memory-profile.js';
