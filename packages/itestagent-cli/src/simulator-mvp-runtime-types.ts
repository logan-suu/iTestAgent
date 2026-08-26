/** B20: simulator MVP runtime shared types. */
export interface SimulatorRuntimeState {
  phase: 'setup' | 'running' | 'teardown';
}
