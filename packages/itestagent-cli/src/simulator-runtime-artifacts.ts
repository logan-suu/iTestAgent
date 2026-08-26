/** B20: simulator runtime artifacts. */
export function resolveSimulatorRuntimeArtifacts(input: { artifacts: string[] }): {
  artifacts: string[];
} {
  return { artifacts: input.artifacts };
}
