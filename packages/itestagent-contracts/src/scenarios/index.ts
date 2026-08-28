/** Scenarios subpath barrel — B05/B36 (scenario symbols stay behind this
 * subpath, ADR-020; the root barrel never re-exports them). */
// B05 scenario contracts (guide §9 Stage 1 pack surface).
export { FeedMemoryScenarioIdentitySchema, buildFeedMemoryScenarioPlan } from './feed-memory.js';
export { FeedMemoryOutcomeSchema, summarizeRoundOutcomes } from './feed-memory-outcomes.js';
export { MemoryProfileScenarioParamsSchema, buildMemoryProfilePlan } from './memory-profile.js';
// B36 compile-time registry + v3 codecs.
export { createScenarioRegistry, differentialCompare } from './scenario-registry.js';
export { encodeScenarioV3 } from './scenario-codecs.js';
export { scenarioPluginProbe } from './scenario-plugin.js';
export type { ScenarioKind, ScenarioRegistry } from './scenario-registry.js';
