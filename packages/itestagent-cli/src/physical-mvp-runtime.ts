/** B19: physical MVP runtime state machine. */
export function createPhysicalMvpRuntime(): { state(): PhysicalMvpRuntimeState; phase: 'setup' } {
  return { state: () => ({ phase: 'setup' }), phase: 'setup' };
}
import type { PhysicalMvpRuntimeState } from './physical-mvp-runtime-types.js';
