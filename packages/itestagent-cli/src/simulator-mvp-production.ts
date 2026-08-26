/** B20: simulator MVP production state + drift detection. */
export interface SimulatorProduction {
  built: boolean;
}
export function resolveSimulatorProduction(input: { built?: boolean } = {}): SimulatorProduction {
  return { built: input.built ?? false };
}
export function detectProductionDrift(input: { expected: string; installed: string }): {
  drifted: boolean;
} {
  return { drifted: input.expected !== input.installed };
}
