/**
 * Owned process group — leader identity.
 *
 * The leader of an owned process group is the OS pid captured at ownership
 * acquisition (spawn time). The identity is resolved once and stays stable
 * for the whole lifetime of the handle, including after the process exits —
 * a dead group keeps reporting the pid it was born with.
 *
 * Extracted from the pid handling of
 * itestagent-server/src/subprocess-controller.ts (B06, ADR-023).
 */

/** Identity of the process that leads an owned process group. */
export interface ProcessGroupLeader {
  /** OS process ID (undefined if spawn failed synchronously). */
  readonly pid: number | undefined;
}

/**
 * Resolve the leader identity of an owned process group.
 * Captured once at spawn time; remains stable after the process exits.
 */
export function identifyGroupLeader(pid: number | undefined): ProcessGroupLeader {
  return { pid };
}
