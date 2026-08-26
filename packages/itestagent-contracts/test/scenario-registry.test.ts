import { describe, expect, it } from 'bun:test';
import { createScenarioRegistry } from '../src/scenarios/scenario-registry.js';

describe('createScenarioRegistry', () => {
  it('registers the core scenario kinds', () => {
    const registry = createScenarioRegistry();
    expect(registry.kinds).toContain('feed-memory');
    expect(registry.kinds).toContain('memory-profile');
  });
});
