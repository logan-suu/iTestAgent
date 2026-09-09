import { createConnection } from 'node:net';

/** Refuse pre-existing listeners; never stop or reuse another session's WDA. */
export async function assertSimulatorPortsAvailable(
  ports: readonly number[],
  signal?: AbortSignal,
): Promise<void> {
  for (const port of ports) {
    signal?.throwIfAborted();
    await new Promise<void>((resolve, reject) => {
      const socket = createConnection({ host: '127.0.0.1', port });
      const finish = (error?: Error) => {
        clearTimeout(timer);
        signal?.removeEventListener('abort', abort);
        socket.destroy();
        if (error) reject(error);
        else resolve();
      };
      const abort = () => finish(new Error('simulator_connection.cancelled'));
      const timer = setTimeout(
        () => finish(new Error('simulator_connection.port_check_timeout')),
        1000,
      );
      signal?.addEventListener('abort', abort, { once: true });
      socket.once('connect', () => finish(new Error('simulator_connection.port_in_use')));
      socket.once('error', (error: NodeJS.ErrnoException) =>
        finish(
          error.code === 'ECONNREFUSED'
            ? undefined
            : new Error('simulator_connection.port_check_failed'),
        ),
      );
      if (signal?.aborted) abort();
    });
  }
}
