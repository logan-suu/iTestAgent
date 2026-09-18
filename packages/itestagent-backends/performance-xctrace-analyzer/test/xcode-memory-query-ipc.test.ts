import { expect, test } from 'bun:test';
import {
  MemoryQueryFrameDecoder,
  MemoryQueryIPCProtocol,
} from '../src/xcode-memory-query-protocol.js';
import {
  type MemoryQueryDuplex,
  runMemoryQueryTransport,
} from '../src/xcode-memory-query-transport.js';
const binding = {
  sessionId: '00000000-0000-4000-8000-000000000001',
  requestId: '00000000-0000-4000-8000-000000000002',
  strategy: 'pidReturn' as const,
  commandSHA256: 'a'.repeat(64),
};
const encode = (value: unknown) => new TextEncoder().encode(`${JSON.stringify(value)}\n`);
function prepared() {
  const protocol = new MemoryQueryIPCProtocol(binding, performance.now() + 10000);
  const hello = JSON.parse(protocol.hello());
  const frame = (kind: string, sequence: number, extra = {}) => ({
    ...hello,
    kind,
    sequence,
    ...extra,
  });
  protocol.receive(frame('hello_ack', 2));
  protocol.receive(frame('prepared', 3));
  return { protocol, frame };
}
test('fragmented frames, strict UTF8, limits, incomplete EOF and poison', () => {
  const p = new MemoryQueryIPCProtocol(binding, performance.now() + 10000);
  const bytes = new TextEncoder().encode(p.hello());
  const d = new MemoryQueryFrameDecoder();
  for (const byte of bytes.slice(0, -1)) expect(d.push(Uint8Array.of(byte))).toEqual([]);
  expect(d.push(bytes.slice(-1))).toHaveLength(1);
  d.end();
  for (const invalid of [
    Uint8Array.of(255, 10),
    new Uint8Array(32769),
    encode({ ...JSON.parse(new TextDecoder().decode(bytes)), extra: true }),
    new TextEncoder().encode('{}\n'),
  ]) {
    const bad = new MemoryQueryFrameDecoder();
    expect(() => bad.push(invalid)).toThrow();
    expect(() => bad.push(bytes)).toThrow();
  }
  const partial = new MemoryQueryFrameDecoder();
  partial.push(bytes.slice(0, -1));
  expect(() => partial.end()).toThrow();
});
test('one allow, sequence, request binding, denial and expiry cannot be bypassed', () => {
  for (const mode of ['duplicate', 'wrong-request', 'early-result', 'denied-result']) {
    const { protocol, frame } = prepared();
    if (mode === 'duplicate') {
      protocol.decision('allow');
      expect(() => protocol.decision('allow')).toThrow();
    } else if (mode === 'wrong-request')
      expect(() =>
        protocol.receive(frame('closing', 4, { requestId: crypto.randomUUID() })),
      ).toThrow();
    else if (mode === 'early-result')
      expect(() => protocol.receive(frame('result', 4, { result: 'fake' }))).toThrow();
    else {
      protocol.decision('deny');
      expect(() => protocol.receive(frame('result', 5, { result: 'fake' }))).toThrow();
    }
    expect(protocol.state).toBe('failed');
  }
  let now = 0;
  const expired = new MemoryQueryIPCProtocol(binding, 10000, () => now);
  expired.hello();
  now = 5000;
  expect(() => expired.receive({})).toThrow();
});
function channelFor(mode: string) {
  const queue: (Uint8Array | undefined)[] = [];
  let resolve: ((x: Uint8Array | undefined) => void) | undefined;
  const push = (value: Uint8Array | undefined) => {
    if (resolve) {
      const done = resolve;
      resolve = undefined;
      done(value);
    } else queue.push(value);
  };
  let writes = 0;
  let cancels = 0;
  const channel: MemoryQueryDuplex = {
    async read() {
      if (queue.length) return queue.shift();
      return new Promise((r) => {
        resolve = r;
      });
    },
    async write(bytes) {
      writes++;
      const frame = JSON.parse(new TextDecoder().decode(bytes));
      if (frame.kind === 'hello') {
        push(encode({ ...frame, kind: 'hello_ack', sequence: 2 }));
        const ready = encode({ ...frame, kind: 'prepared', sequence: 3 });
        push(
          mode === 'premature'
            ? new Uint8Array([
                ...ready,
                ...encode({ ...frame, kind: 'result', sequence: 5, result: 'fake' }),
              ])
            : ready,
        );
        if (mode === 'eof-pending') push(undefined);
      } else {
        if (mode === 'write-failure') throw new Error('uncertain');
        let sequence = 5;
        if (frame.effect === 'allow')
          push(
            encode({
              ...frame,
              effect: undefined,
              kind: 'result',
              sequence: sequence++,
              result: 'fake',
            }),
          );
        push(encode({ ...frame, effect: undefined, kind: 'closing', sequence: sequence++ }));
        push(encode({ ...frame, effect: undefined, kind: 'closed', sequence: sequence++ }));
        push(undefined);
      }
    },
    cancel() {
      cancels++;
      push(undefined);
    },
    exited: Promise.resolve({ code: 0, stderrEmpty: true }),
  };
  return { channel, counts: () => ({ writes, cancels }) };
}
for (const mode of [
  'allow',
  'deny',
  'premature',
  'eof-pending',
  'write-failure',
  'abort',
  'timeout',
])
  test(`bounded transport ${mode}`, async () => {
    const { channel, counts } = channelFor(mode);
    const abort = new AbortController();
    let asks = 0;
    let cancelled = false;
    if (mode === 'abort') abort.abort();
    const result = await runMemoryQueryTransport({
      binding,
      channel,
      timeoutMs: mode === 'timeout' ? 20 : 1000,
      signal: abort.signal,
      permission: async (_, signal) => {
        asks++;
        if (mode === 'eof-pending' || mode === 'timeout')
          return new Promise((_, reject) =>
            signal.addEventListener(
              'abort',
              () => {
                cancelled = true;
                reject(new Error());
              },
              { once: true },
            ),
          );
        return { effect: mode === 'deny' ? 'deny' : 'allow', remembered: false };
      },
    });
    expect(result.status).toBe(
      ['allow', 'deny'].includes(mode) ? 'query_closed' : 'query_unverified',
    );
    expect(result.leaseRetained).toBe(true);
    expect(result.targetVerified).toBe(false);
    expect(result.grantAttempted).toBe(['allow', 'write-failure'].includes(mode));
    expect(counts().cancels).toBe(['allow', 'deny'].includes(mode) ? 0 : 1);
    if (mode === 'eof-pending' || mode === 'timeout') expect(cancelled).toBe(true);
    if (mode === 'premature' || mode === 'abort') expect(asks).toBe(0);
  });
