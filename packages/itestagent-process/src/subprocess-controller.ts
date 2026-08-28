/**
 * SubprocessController — spawn/kill/timeout/reap for external processes.
 *
 * ADR-010 § "Abort, timeout and child processes":
 *   TUI cancel → server command → AgentRuntime.abort → ToolDispatcher cancel
 *   → backend AbortSignal → child SIGTERM → grace timeout → SIGKILL if needed
 *   → release WDA ports/tunnels/files → RunStateMachine cancelled/failed
 *   → preserve partial evidence index
 *
 * Invariants:
 *   - abort is idempotent
 *   - no orphan child processes
 *   - no pending tools after session ends
 *   - generated evidence remains indexable
 *
 * Backends managed via SubprocessController:
 *   - Appium server (appium)
 *   - xcodebuild test/build/archive
 *   - xctrace recording
 *   - (future) mobile-mcp server
 *
 * Moved from itestagent-server (B06, ADR-023): the controller is now a thin
 * facade over the owned-process-group concern modules in this package.
 */

import type { Subprocess } from 'bun';
import { DEFAULT_GRACE_MS, createCleanupDeadlines } from './owned-process-group-cleanup.js';
import { ownSubprocess } from './owned-process-group.js';
import { startSubprocess } from './subprocess-spawn.js';
import type { SubprocessHandle, SubprocessOptions } from './subprocess-types.js';

/**
 * Spawn a subprocess and return a handle for lifecycle management.
 *
 * Wraps Bun.spawn with:
 *   - Timeout-based auto-kill
 *   - AbortSignal integration (SIGTERM → graceMs → SIGKILL)
 *   - Grace period between SIGTERM and SIGKILL
 *   - Idempotent kill
 *
 * @example
 *   const proc = spawn('appium', ['--port', '4723'], { timeoutMs: 600_000 });
 *   const result = await proc.exited;
 */
export function spawn(
  command: string,
  args?: string[],
  options?: SubprocessOptions,
): SubprocessHandle {
  const resolvedArgs = args ?? [];
  const graceMs = options?.graceMs && options.graceMs > 0 ? options.graceMs : DEFAULT_GRACE_MS;

  // Cleanup deadlines must exist before the child starts: Bun's onExit
  // releases them as soon as the process exits.
  const deadlines = createCleanupDeadlines();

  let subprocess: Subprocess | undefined;

  try {
    subprocess = startSubprocess(command, resolvedArgs, options, {
      onExit: () => {
        // Bun's onExit callback — clean up timers.
        deadlines.clearKillTimer();
        deadlines.clearTimeoutTimer();
      },
    });
  } catch (err) {
    // Spawn failed synchronously (e.g., command not found).
    // Return a handle with an immediately-rejected exited promise.
    return {
      get pid() {
        return undefined;
      },
      exited: Promise.reject(err),
      kill: () => {},
      isAlive: () => false,
    };
  }

  return ownSubprocess(
    subprocess,
    {
      graceMs,
      timeoutMs: options?.timeoutMs,
      signal: options?.signal,
    },
    deadlines,
  ).handle;
}
