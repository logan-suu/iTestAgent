import { expect, test } from 'bun:test';
import { prepareMemoryQuerySession } from '../src/xcode-memory-query-session.js';

const binding = {
  sessionId: '00000000-0000-4000-8000-000000000001',
  requestId: '00000000-0000-4000-8000-000000000002',
  strategy: 'pidReturn' as const,
  commandSHA256: 'a'.repeat(64),
};
const observation = {
  protocolVersion: 1,
  requestId: binding.requestId,
  status: 'observed',
  debuggerId: 0,
  processInstance: 1,
  pid: 123,
  moduleUUID: 'a'.repeat(32),
  triple: 'arm64-apple-ios',
  platform: 'remote-ios',
  executable: '/fixture/app',
} as const;
const response = () => ({
  ...binding,
  protocolVersion: 1,
  status: 'candidate',
  insertionAttempted: true,
  downAttempted: true,
  upAttempted: true,
  candidateLine: `ITESTAGENT_MEMORY_IDENTITY ${JSON.stringify(observation)}`,
});

test('one permission, one run, strict candidate only; never release a capture lease', async () => {
  let asks = 0;
  let runs = 0;
  const input = { ...binding };
  const session = prepareMemoryQuerySession(input, {
    ownerIsCurrent: () => true,
    requestPermission: async (action, resource) => {
      asks++;
      expect(action).toBe('interact_sensitive_ui');
      expect(JSON.parse(resource)).toEqual(binding);
      return { effect: 'allow', remembered: false };
    },
    run: async (bound) => {
      runs++;
      expect(bound).toEqual(binding);
      return JSON.stringify(response());
    },
  });
  input.commandSHA256 = 'b'.repeat(64);
  expect(await session.executeOnce()).toEqual({
    status: 'observed_candidate',
    observation,
    targetVerified: false,
    leaseRetained: true,
  });
  expect((await session.executeOnce()).status).toBe('already_consumed');
  expect([asks, runs]).toEqual([1, 1]);
});

for (const mode of [
  'deny',
  'remembered',
  'permission-error',
  'pre-cancel',
  'ask-cancel',
  'owner-before',
  'owner-after-ask',
]) {
  test(`query blocks before runner: ${mode}`, async () => {
    const abort = new AbortController();
    let current = mode !== 'owner-before';
    let runs = 0;
    if (mode === 'pre-cancel') abort.abort();
    const session = prepareMemoryQuerySession(
      binding,
      {
        ownerIsCurrent: () => current,
        requestPermission: async () => {
          if (mode === 'permission-error') throw new Error('fixture');
          if (mode === 'ask-cancel') abort.abort();
          if (mode === 'owner-after-ask') current = false;
          return { effect: mode === 'deny' ? 'deny' : 'allow', remembered: mode === 'remembered' };
        },
        run: async () => {
          runs++;
          return JSON.stringify(response());
        },
      },
      abort.signal,
    );
    expect((await session.executeOnce()).status).not.toBe('observed_candidate');
    expect((await session.executeOnce()).status).toBe('already_consumed');
    expect(runs).toBe(0);
  });
}

for (const mode of [
  'session',
  'request',
  'digest',
  'extra',
  'no-insert',
  'no-down',
  'no-up',
  'bad-line',
  'old-line',
  'line-extra',
  'duplicate-json',
  'oversize',
  'owner-lost',
  'cancelled',
  'failed-with-line',
]) {
  test(`query rejects result ambiguity: ${mode}`, async () => {
    let current = true;
    const abort = new AbortController();
    const session = prepareMemoryQuerySession(
      binding,
      {
        ownerIsCurrent: () => current,
        requestPermission: async () => ({ effect: 'allow', remembered: false }),
        run: async () => {
          const value: Record<string, unknown> = response();
          if (mode === 'session') value.sessionId = binding.requestId;
          if (mode === 'request') value.requestId = binding.sessionId;
          if (mode === 'digest') value.commandSHA256 = 'b'.repeat(64);
          if (mode === 'extra') value.cleanupVerified = true;
          if (mode === 'no-insert') value.insertionAttempted = false;
          if (mode === 'no-down') value.downAttempted = false;
          if (mode === 'no-up') value.upAttempted = false;
          if (mode === 'bad-line') value.candidateLine = 'not an observation';
          if (mode === 'old-line')
            value.candidateLine = `ITESTAGENT_MEMORY_IDENTITY ${JSON.stringify({ ...observation, requestId: binding.sessionId })}`;
          if (mode === 'line-extra')
            value.candidateLine = `ITESTAGENT_MEMORY_IDENTITY ${JSON.stringify({ ...observation, trusted: true })}`;
          if (mode === 'owner-lost') current = false;
          if (mode === 'cancelled') abort.abort();
          if (mode === 'failed-with-line') value.status = 'failed';
          const raw = JSON.stringify(value);
          if (mode === 'oversize') return ' '.repeat(12289);
          return mode === 'duplicate-json' ? `${raw}\n${raw}` : raw;
        },
      },
      abort.signal,
    );
    const result = await session.executeOnce();
    expect(result.status).not.toBe('observed_candidate');
    expect(result.leaseRetained).toBe(true);
    expect(result.targetVerified).toBe(false);
  });
}
