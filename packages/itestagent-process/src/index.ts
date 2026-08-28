/**
 * itestagent-process — subprocess/process-group ownership leaf.
 *
 * Zero internal workspace dependencies (guide §8.1, ADR-023): this package
 * touches only Bun/OS process APIs. Exports mirror the surface previously
 * exposed by itestagent-server (same names), plus the owned-process-group
 * concern modules.
 */

export { spawn } from './subprocess-controller.js';
export { startSubprocess, type StartSubprocessCallbacks } from './subprocess-spawn.js';

export type {
  ExitInfo,
  SignalName,
  SubprocessHandle,
  SubprocessOptions,
} from './subprocess-types.js';

export {
  ownSubprocess,
  type OwnedProcessGroup,
  type OwnershipOptions,
} from './owned-process-group.js';
export { createCleanupDeadlines, DEFAULT_GRACE_MS } from './owned-process-group-cleanup.js';
export type { CleanupDeadlines } from './owned-process-group-cleanup.js';
export { identifyGroupLeader } from './owned-process-group-identity.js';
export type { ProcessGroupLeader } from './owned-process-group-identity.js';
export { reapOwnedProcess } from './owned-process-group-reaping.js';
export {
  decodeRawExitCode,
  defaultEnv,
  SAFE_ENV_KEYS,
  sendSignal,
} from './owned-process-group-system.js';
