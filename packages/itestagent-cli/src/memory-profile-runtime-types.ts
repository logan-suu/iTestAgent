/** B23: memory-profile runtime shared types. */
export interface MemoryProfileCliRuntimeState {
  phase: 'setup' | 'running' | 'teardown';
}
