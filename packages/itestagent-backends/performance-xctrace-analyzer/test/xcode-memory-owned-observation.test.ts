import { expect, test } from 'bun:test';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { createOwnedMemoryObservation } from '../src/xcode-memory-owned-observation.js';

test('retained Python owner rejects replacement, stale and invalid observations', async () => {
  const child = Bun.spawn(
    [
      'python3',
      '-B',
      join(import.meta.dir, 'memory-owned-observation-fixture.py'),
      join(import.meta.dir, '../native'),
    ],
    { stdout: 'pipe', stderr: 'pipe' },
  );
  const [out, err, code] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  expect(code, err).toBe(0);
  expect(JSON.parse(out)).toEqual({ passed: 14 });
});

function fixture() {
  const sessionId = randomUUID();
  const requestId = randomUUID();
  let now = 0;
  const candidate = {
    protocolVersion: 1,
    requestId,
    status: 'observed',
    debuggerId: 0,
    processInstance: 1,
    pid: 123,
    moduleUUID: 'a'.repeat(32),
    triple: 'fixture',
    platform: 'fixture',
    executable: '/fixture',
  };
  const owner = createOwnedMemoryObservation(
    sessionId,
    `ITESTAGENT_MEMORY_IDENTITY ${JSON.stringify(candidate)}`,
    requestId,
    1000,
    () => now,
  );
  const registrationId = randomUUID();
  const reply = (request: { requestId: string }, status: string) => ({
    protocolVersion: 1,
    sessionId,
    requestId: request.requestId,
    registrationId,
    source: 'retained_lldb_process',
    debuggerId: 0,
    processInstance: 1,
    pid: 123,
    status,
  });
  return {
    owner,
    reply,
    expire: () => {
      now = 1000;
    },
  };
}
test('owned observation remains non-physical, allows exit and drops references once', () => {
  const { owner, reply } = fixture();
  expect(
    owner.accept(JSON.stringify(reply(owner.request('register'), 'registered'))).targetVerified,
  ).toBe(false);
  expect(owner.accept(JSON.stringify(reply(owner.request('observe'), 'live'))).leaseRetained).toBe(
    true,
  );
  expect(owner.accept(JSON.stringify(reply(owner.request('observe'), 'exited'))).status).toBe(
    'exited',
  );
  expect(owner.accept(JSON.stringify(reply(owner.request('release'), 'released'))).status).toBe(
    'released',
  );
  expect(() => owner.request('observe')).toThrow();
});
for (const mode of [
  'session',
  'request',
  'registration',
  'pid',
  'instance',
  'debugger',
  'source',
  'extra',
  'large',
  'expired',
  'replay',
  'live-after-exit',
]) {
  test(`owned observation rejects ${mode} and cannot recover`, () => {
    const { owner, reply, expire } = fixture();
    owner.accept(JSON.stringify(reply(owner.request('register'), 'registered')));
    if (mode === 'live-after-exit')
      owner.accept(JSON.stringify(reply(owner.request('observe'), 'exited')));
    const value: Record<string, unknown> = reply(owner.request('observe'), 'live');
    if (mode === 'session') value.sessionId = randomUUID();
    if (mode === 'request') value.requestId = randomUUID();
    if (mode === 'registration') value.registrationId = randomUUID();
    if (mode === 'pid') value.pid = 124;
    if (mode === 'instance') value.processInstance = 2;
    if (mode === 'debugger') value.debuggerId = 1;
    if (mode === 'source') value.source = 'selected_process';
    if (mode === 'extra') value.cleanupVerified = true;
    if (mode === 'expired') expire();
    const raw = mode === 'large' ? ' '.repeat(2049) : JSON.stringify(value);
    if (mode === 'replay') owner.accept(raw);
    expect(() => owner.accept(raw)).toThrow();
    expect(() => owner.request('observe')).toThrow();
  });
}
