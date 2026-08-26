/** B20: simulator runtime environment facts. */
export function resolveSimulatorRuntimeEnvironment(input: { booted: boolean }): {
  booted: boolean;
} {
  return { booted: input.booted };
}
