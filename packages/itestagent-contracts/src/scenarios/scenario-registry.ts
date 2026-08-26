/**
 * Compile-time scenario registry — B36 (promotion guide §11.3 "compile-time
 * registry + runtime v3").
 */
export type ScenarioKind = 'feed-memory' | 'memory-profile';

export interface ScenarioRegistry {
  kinds: ScenarioKind[];
}

export function createScenarioRegistry(): ScenarioRegistry {
  return { kinds: ['feed-memory', 'memory-profile'] };
}

export function differentialCompare(a: unknown, b: unknown): { equal: boolean } {
  return { equal: JSON.stringify(a) === JSON.stringify(b) };
}
