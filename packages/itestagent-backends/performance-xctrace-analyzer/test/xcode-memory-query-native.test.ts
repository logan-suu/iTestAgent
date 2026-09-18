import { expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { startCaptureProcess } from '../src/capture-process.js';
import { prepareMemoryQuerySession } from '../src/xcode-memory-query-session.js';

test.skipIf(process.platform !== 'darwin')(
  'query coordinator binds owned instance and one-shot grant to the actual exchange',
  async () => {
    const root = mkdtempSync('/private/tmp/itestagent-query-session-');
    try {
      const executable = join(root, 'submission');
      const sources = [
        'itestagent-memory-ax-capabilities.swift',
        'itestagent-memory-ax-context.swift',
        'itestagent-memory-local-document.swift',
        'itestagent-memory-identity-script.swift',
        'itestagent-memory-console-response.swift',
        'itestagent-memory-console-location.swift',
        'itestagent-memory-console-submit.swift',
        'itestagent-memory-console-return.swift',
        'itestagent-memory-owned-app.swift',
        'itestagent-memory-query-session.swift',
        'itestagent-memory-query-ipc.swift',
        'itestagent-memory-query-ipc-grant.swift',
        'itestagent-memory-parent-lifetime.swift',
      ].map((file) => join(import.meta.dir, '../native', file));
      const compiled = await startCaptureProcess(
        [
          'xcrun',
          'swiftc',
          '-warnings-as-errors',
          '-module-cache-path',
          join(root, 'cache'),
          ...sources,
          join(import.meta.dir, 'memory-query-session-fixture.swift'),
          '-o',
          executable,
        ],
        { timeoutMs: 60000 },
      ).completed;
      expect(compiled.exitCode, compiled.stderr).toBe(0);
      const result = await startCaptureProcess(
        [executable, root, join(import.meta.dir, '../native/itestagent_memory_identity.py')],
        { timeoutMs: 5000 },
      ).completed;
      expect(result.failure).toBeUndefined();
      expect(result.exitCode, result.stderr).toBe(0);
      const { envelope, ...summary } = JSON.parse(result.stdout);
      expect(summary).toEqual({
        ownerBound: true,
        grantConsumed: true,
        realExchangeSyntheticTransport: true,
      });
      const metadata = JSON.parse(envelope);
      const query = prepareMemoryQuerySession(
        {
          sessionId: metadata.sessionId,
          requestId: metadata.requestId,
          strategy: metadata.strategy,
          commandSHA256: metadata.commandSHA256,
        },
        {
          ownerIsCurrent: () => true,
          requestPermission: async () => ({ effect: 'allow', remembered: false }),
          run: async () => envelope,
        },
      );
      const candidate = await query.executeOnce();
      expect(candidate.status).toBe('observed_candidate');
      expect(candidate.targetVerified).toBe(false);
      expect(candidate.leaseRetained).toBe(true);
      // The existing owner policy fixture exits before its opt-in App branch when
      // invoked without arguments. This exercises lifecycle regressions without GUI.
      const policy = join(root, 'owner-policy');
      const policyCompile = await startCaptureProcess(
        [
          'xcrun',
          'swiftc',
          '-warnings-as-errors',
          '-module-cache-path',
          join(root, 'cache'),
          join(import.meta.dir, '../native/itestagent-memory-owned-app.swift'),
          join(import.meta.dir, '../native/itestagent-memory-parent-lifetime.swift'),
          join(import.meta.dir, 'memory-owned-app-fixture.swift'),
          '-o',
          policy,
        ],
        { timeoutMs: 60000 },
      ).completed;
      expect(policyCompile.exitCode, policyCompile.stderr).toBe(0);
      const policyResult = await startCaptureProcess([policy], { timeoutMs: 5000 }).completed;
      expect(policyResult.exitCode, policyResult.stderr).toBe(0);
      expect(JSON.parse(policyResult.stdout)).toEqual({ policy: true });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  },
  90000,
);
