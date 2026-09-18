import { expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { createMemoryQueryPermission } from '../../../itestagent-engine/src/memory-query-permission-wiring.js';
import { PermissionEngine } from '../../../itestagent-engine/src/permission-engine.js';
import { startCaptureProcess } from '../src/capture-process.js';
import { spawnMemoryQueryLauncher } from '../src/xcode-memory-query-launcher.js';
import { runMemoryQueryTransport } from '../src/xcode-memory-query-transport.js';
import { reserveXcodeMemoryLease } from '../src/xcode-memory-session.js';

const binding = {
  sessionId: '00000000-0000-4000-8000-000000000001',
  requestId: '00000000-0000-4000-8000-000000000002',
  strategy: 'pidReturn' as const,
  commandSHA256: 'a'.repeat(64),
};
test.skipIf(process.platform !== 'darwin')(
  'real private socket, own child, real PermissionEngine and exit ledger (no GUI)',
  async () => {
    const root = mkdtempSync('/private/tmp/itestagent-ipc-test-');
    try {
      const executable = join(root, 'fixture');
      const sources = [
        'itestagent-memory-query-ipc.swift',
        'itestagent-memory-query-launcher.swift',
        'itestagent-memory-query-control.swift',
        'itestagent-memory-query-app-launch.swift',
      ].map((x) => join(import.meta.dir, '../native', x));
      const compiled = await startCaptureProcess(
        [
          'xcrun',
          'swiftc',
          '-warnings-as-errors',
          '-module-cache-path',
          join(root, 'cache'),
          ...sources,
          join(import.meta.dir, 'memory-query-ipc-fixture.swift'),
          '-o',
          executable,
        ],
        { timeoutMs: 60000 },
      ).completed;
      expect(compiled.exitCode, compiled.stderr).toBe(0);
      for (const mode of [
        'normal',
        'deny',
        'eof-pending',
        'partial',
        'after-grant',
        'wrong-pid',
        'wrong-uid',
        'owner-changed',
      ]) {
        const leaseRoot = join(root, mode);
        mkdirSync(leaseRoot, { mode: 0o700 });
        const lease = reserveXcodeMemoryLease(leaseRoot);
        const ticket = lease.resources.begin('launcher');
        const channel = spawnMemoryQueryLauncher([executable, mode]);
        let exitObserved = false;
        const exited = channel.exited.then((value) => {
          exitObserved = true;
          return value;
        });
        lease.resources.acquired(
          ticket,
          channel,
          () => true,
          () => exitObserved,
        );
        // Child helper exit is independently observed by the fixture launcher before
        // successful launcher exit. These callbacks apply only to this fake owner.
        const helperTicket = lease.resources.begin('helper');
        const helperOwner = {};
        let helperExit = false;
        lease.resources.acquired(
          helperTicket,
          helperOwner,
          () => true,
          () => helperExit,
        );
        const engine = new PermissionEngine({ askTimeoutMs: 1500 });
        let askId = '';
        let asks = 0;
        const permission = createMemoryQueryPermission({
          engine,
          publishAsk: (ask) => {
            askId = ask.callId;
            asks++;
            if (!['eof-pending', 'partial'].includes(mode))
              engine.resolve(ask.callId, mode === 'deny' ? 'deny' : 'allow', false);
          },
        });
        const result = await runMemoryQueryTransport({
          binding: { ...binding, sessionId: lease.sessionId },
          timeoutMs: 8000,
          channel,
          permission: (resource, signal) => permission('interact_sensitive_ui', resource, signal),
        });
        const exit = await exited;
        expect(result.status, mode).toBe(
          ['normal', 'deny'].includes(mode) ? 'query_closed' : 'query_unverified',
        );
        expect(result.grantAttempted, mode).toBe(['normal', 'after-grant'].includes(mode));
        expect(result.leaseRetained).toBe(true);
        lease.resources.closed(ticket, channel);
        if (result.status === 'query_closed') {
          expect(exit.code).toBe(0);
          helperExit = true;
          lease.resources.closed(helperTicket, helperOwner);
          lease.releaseResources(lease.resources.prove());
          expect(asks).toBe(1);
        } else {
          lease.resources.unknown(helperTicket);
          expect(() => lease.resources.prove()).toThrow();
          if (askId) {
            const request = engine.requestPermission(askId, 'interact_sensitive_ui', 'retry-check');
            engine.resolve(askId, 'deny', false);
            expect((await request).effect).toBe('deny');
          }
        }
        channel.cancel();
      }
      for (const mode of ['protocol-policy', 'endpoint-replaced', 'directory-replaced']) {
        const check = await startCaptureProcess([executable, mode], { timeoutMs: 5000 }).completed;
        expect(check.exitCode, check.stderr).toBe(0);
      }
      for (const signal of ['EOF', 'SIGTERM', 'SIGINT'] as const) {
        const child = Bun.spawn([executable], { stdin: 'pipe', stdout: 'pipe', stderr: 'pipe' });
        const errors = new Response(child.stderr).text();
        // Wait for prepared so signal handlers and both owned processes exist.
        const hello = {
          ...binding,
          protocolVersion: 3,
          sequence: 1,
          challenge: 'b'.repeat(64),
          kind: 'hello',
        };
        child.stdin.write(`${JSON.stringify(hello)}\n`);
        await child.stdin.flush();
        const reader = child.stdout.getReader();
        let output = '';
        while (!output.includes('prepared')) {
          const value = await reader.read();
          if (value.done) break;
          output += new TextDecoder().decode(value.value);
        }
        expect(output.includes('prepared')).toBe(true);
        if (signal === 'EOF') child.stdin.end();
        else child.kill(signal);
        expect(await child.exited, await errors).toBe(2);
        child.stdin.end();
        await reader.cancel();
      }
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  },
  90000,
);
