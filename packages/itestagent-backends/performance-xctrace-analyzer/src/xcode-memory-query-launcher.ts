import type { MemoryQueryDuplex } from './xcode-memory-query-transport.js';

/** Internal owned-child adapter. Caller verifies the reviewed launcher manifest.
 * No shell, grant argument, retry, process lookup, or force termination is used.
 */
export function spawnMemoryQueryLauncher(command: readonly string[]): MemoryQueryDuplex {
  if (command.length === 0) throw new Error('query.launcher_invalid');
  const child = Bun.spawn([...command], { stdin: 'pipe', stdout: 'pipe', stderr: 'pipe' });
  const reader = child.stdout.getReader();
  let cancelled = false;
  const stderr = (async () => {
    let empty = true;
    for await (const bytes of child.stderr) if (bytes.byteLength) empty = false;
    return empty;
  })();
  return {
    async read(signal) {
      signal.throwIfAborted();
      const result = await reader.read();
      return result.done ? undefined : result.value;
    },
    async write(bytes, signal) {
      signal.throwIfAborted();
      if (cancelled) throw new Error('query.launcher_closed');
      child.stdin.write(bytes);
      await child.stdin.flush();
      signal.throwIfAborted();
    },
    cancel() {
      if (cancelled) return;
      cancelled = true;
      child.stdin.end();
      void reader.cancel().catch(() => {});
    },
    exited: Promise.all([child.exited, stderr]).then(([code, stderrEmpty]) => ({
      code,
      stderrEmpty,
    })),
  };
}
