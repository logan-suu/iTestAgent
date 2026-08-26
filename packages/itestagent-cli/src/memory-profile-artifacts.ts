/** B23: memory-profile artifact helpers. */
export function collectMemoryProfileArtifacts(input: { artifacts: string[] }): {
  artifacts: string[];
} {
  return { artifacts: input.artifacts };
}
