import { expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { createMemoryQueryPermission } from '../../../itestagent-engine/src/memory-query-permission-wiring.js';
import { PermissionEngine } from '../../../itestagent-engine/src/permission-engine.js';
import { prepareMemoryIPCQuery } from '../src/xcode-memory-query-coordinator.js';
import type { MemoryQueryDuplex } from '../src/xcode-memory-query-transport.js';
import { reserveXcodeMemoryLease } from '../src/xcode-memory-session.js';

for (const mode of [
  'allow',
  'deny',
  'invalid-result',
  'after-grant',
  'unsupported',
  'pre-abort',
  'launch-failed',
])
  test(`composed query ${mode} never mistakes protocol closure for resource proof`, async () => {
    const root = mkdtempSync('/private/tmp/itestagent-query-compose-');
    try {
      const lease = reserveXcodeMemoryLease(root);
      const binding = {
        sessionId: lease.sessionId,
        requestId: crypto.randomUUID(),
        strategy: 'pidReturn' as const,
        commandSHA256: 'a'.repeat(64),
      };
      const engine = new PermissionEngine();
      let asks = 0;
      let launches = 0;
      let writes = 0;
      const abort = new AbortController();
      if (mode === 'pre-abort') abort.abort();
      const permission = createMemoryQueryPermission({
        engine,
        publishAsk: (ask) => {
          asks++;
          engine.resolve(ask.callId, mode === 'deny' ? 'deny' : 'allow', false);
        },
      });
      const queue: (Uint8Array | undefined)[] = [];
      let resolve: ((value: Uint8Array | undefined) => void) | undefined;
      const send = (value: unknown) => {
        const bytes =
          value === undefined ? undefined : new TextEncoder().encode(`${JSON.stringify(value)}\n`);
        if (resolve) {
          const done = resolve;
          resolve = undefined;
          done(bytes);
        } else queue.push(bytes);
      };
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
            send({ ...frame, kind: 'hello_ack', sequence: 2 });
            if (mode === 'unsupported') {
              send({ ...frame, kind: 'closing', sequence: 3 });
              send({ ...frame, kind: 'closed', sequence: 4 });
              send(undefined);
            } else send({ ...frame, kind: 'prepared', sequence: 3 });
          } else {
            if (mode === 'after-grant') {
              send(undefined);
              return;
            }
            let sequence = 5;
            if (frame.effect === 'allow') {
              const observation = {
                protocolVersion: 1,
                requestId: binding.requestId,
                status: 'observed',
                debuggerId: 0,
                processInstance: 1,
                pid: 123,
                moduleUUID: 'a'.repeat(32),
                triple: 'arm64-apple-ios',
                platform: 'fixture',
                executable: '/fixture/app',
              };
              const result =
                mode === 'invalid-result'
                  ? 'invalid'
                  : JSON.stringify({
                      ...binding,
                      protocolVersion: 1,
                      status: 'candidate',
                      insertionAttempted: true,
                      downAttempted: true,
                      upAttempted: true,
                      candidateLine: `ITESTAGENT_MEMORY_IDENTITY ${JSON.stringify(observation)}`,
                    });
              send({ ...frame, effect: undefined, kind: 'result', sequence: sequence++, result });
            }
            send({ ...frame, effect: undefined, kind: 'closing', sequence: sequence++ });
            send({ ...frame, effect: undefined, kind: 'closed', sequence: sequence++ });
            send(undefined);
          }
        },
        cancel() {
          send(undefined);
        },
        exited: Promise.resolve({ code: 0, stderrEmpty: true }),
      };
      const query = prepareMemoryIPCQuery({
        binding,
        lease,
        timeoutMs: 1000,
        signal: abort.signal,
        launchVerified() {
          launches++;
          if (mode === 'launch-failed') throw new Error('unknown launch');
          return channel;
        },
        permission: (r, s) => permission('interact_sensitive_ui', r, s),
      });
      const result = await query.executeOnce();
      expect(result.status).toBe(
        (
          {
            allow: 'observed_candidate',
            deny: 'not_authorized',
            'invalid-result': 'invalid_response',
            'after-grant': 'query_unverified',
            unsupported: 'unsupported',
            'pre-abort': 'cancelled',
            'launch-failed': 'query_failed',
          } as Record<string, string>
        )[mode] ?? 'missing-expectation',
      );
      expect(result.targetVerified).toBe(false);
      expect(result.leaseRetained).toBe(true);
      expect(asks).toBe(['unsupported', 'pre-abort', 'launch-failed'].includes(mode) ? 0 : 1);
      expect(launches).toBe(mode === 'pre-abort' ? 0 : 1);
      if (mode !== 'pre-abort') expect(() => lease.resources.prove()).toThrow();
      expect((await query.executeOnce()).status).toBe('already_consumed');
      expect(writes).toBeLessThanOrEqual(2);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
