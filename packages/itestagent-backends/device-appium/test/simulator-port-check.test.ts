import { expect, test } from 'bun:test';
import { createServer } from 'node:net';
import { assertSimulatorPortsAvailable } from '../src/simulator-port-check.js';

test('occupied Simulator ports are rejected without stopping their owner', async () => {
  const server = createServer((socket) => socket.end());
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Missing bound address');
  try {
    await expect(assertSimulatorPortsAvailable([address.port])).rejects.toThrow('port_in_use');
    expect(server.listening).toBe(true);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
  await expect(assertSimulatorPortsAvailable([address.port])).resolves.toBeUndefined();
  const abort = new AbortController();
  abort.abort();
  await expect(assertSimulatorPortsAvailable([address.port], abort.signal)).rejects.toThrow();
});
