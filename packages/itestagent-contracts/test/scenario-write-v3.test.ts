import { describe, expect, it } from 'bun:test';
import { encodeScenarioV3 } from '../src/scenarios/scenario-codecs.js';

describe('encodeScenarioV3', () => {
  it('encodes a scenario payload as v3', () => {
    expect(encodeScenarioV3({ kind: 'feed-memory', runId: 'r1' }).schemaVersion).toBe(
      'itestagent.scenario.v3',
    );
  });
});
