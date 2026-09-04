import { RunIdSchema } from '../run-id.js';

/**
 * Scenario v3 codecs — B36 (promotion guide §11.3 "compile-time registry +
 * runtime v3").
 */
export function encodeScenarioV3(input: { kind: string; runId: string }): {
  schemaVersion: 'itestagent.scenario.v3';
  kind: string;
  runId: string;
} {
  return {
    schemaVersion: 'itestagent.scenario.v3',
    kind: input.kind,
    runId: RunIdSchema.parse(input.runId),
  };
}
