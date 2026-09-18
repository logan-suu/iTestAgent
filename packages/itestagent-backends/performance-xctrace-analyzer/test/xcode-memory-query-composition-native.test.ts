import { expect, test } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createMemoryQueryPermission } from '../../../itestagent-engine/src/memory-query-permission-wiring.js';
import { PermissionEngine } from '../../../itestagent-engine/src/permission-engine.js';
import { startCaptureProcess } from '../src/capture-process.js';
import {
  queryNativeSources,
  resolveMemoryQueryCandidate,
  reviewMemoryQueryCandidate,
  stageMemoryQueryCandidate,
} from '../src/xcode-memory-query-candidate.js';
import { prepareMemoryIPCQuery } from '../src/xcode-memory-query-coordinator.js';
import { spawnMemoryQueryLauncher } from '../src/xcode-memory-query-launcher.js';
import { reserveXcodeMemoryLease } from '../src/xcode-memory-session.js';

test.skipIf(process.platform !== 'darwin')(
  'candidate compiles without launch; manifest drift and unverified signatures block; parent EOF precedes late callback',
  async () => {
    const root = mkdtempSync('/private/tmp/itestagent-query-candidate-test-');
    try {
      const candidate = await stageMemoryQueryCandidate(join(root, 'candidate'));
      expect(candidate.runnable).toBe(false);
      const pinned = candidate.manifestSHA256;
      expect(reviewMemoryQueryCandidate(candidate.root, pinned).manifest.protocolVersion).toBe(3);
      await expect(
        resolveMemoryQueryCandidate(candidate.root, pinned, async () => false),
      ).rejects.toThrow('signature_unverified');
      await expect(stageMemoryQueryCandidate(candidate.root)).rejects.toThrow();
      const script = join(
        candidate.root,
        'iTestAgentMemoryQueryHelper.app/Contents/Resources/itestagent_memory_identity.py',
      );
      const original = readFileSync(script);
      writeFileSync(script, 'changed');
      expect(() => reviewMemoryQueryCandidate(candidate.root, pinned)).toThrow();
      writeFileSync(script, original);
      unlinkSync(script);
      symlinkSync('/dev/null', script);
      expect(() => reviewMemoryQueryCandidate(candidate.root, pinned)).toThrow();
      unlinkSync(script);
      writeFileSync(script, original, { mode: 0o600 });
      const extra = join(candidate.root, 'unexpected');
      writeFileSync(extra, 'extra');
      expect(() => reviewMemoryQueryCandidate(candidate.root, pinned)).toThrow();
      unlinkSync(extra);
      const composed = join(root, 'composition');
      const built = await startCaptureProcess(
        [
          'xcrun',
          'swiftc',
          '-warnings-as-errors',
          '-module-cache-path',
          join(root, 'cache'),
          ...queryNativeSources.map((x) => join(import.meta.dir, '../native', x)),
          join(import.meta.dir, 'memory-query-composition-fixture.swift'),
          '-o',
          composed,
        ],
        { timeoutMs: 60000 },
      ).completed;
      expect(built.exitCode, built.stderr).toBe(0);
      for (const mode of ['allow', 'deny', 'unsupported', 'missing-closure']) {
        const leaseRoot = mkdtempSync(join(root, 'lease-'));
        const lease = reserveXcodeMemoryLease(leaseRoot);
        const engine = new PermissionEngine();
        let asks = 0;
        const permission = createMemoryQueryPermission({
          engine,
          publishAsk(ask) {
            asks++;
            engine.resolve(ask.callId, mode === 'deny' ? 'deny' : 'allow', false);
          },
        });
        const query = prepareMemoryIPCQuery({
          binding: {
            sessionId: lease.sessionId,
            requestId: crypto.randomUUID(),
            strategy: 'pidReturn',
            commandSHA256: 'a'.repeat(64),
          },
          lease,
          timeoutMs: 4000,
          launchVerified: () => spawnMemoryQueryLauncher([composed, mode]),
          permission: (r, s) => permission('interact_sensitive_ui', r, s),
        });
        const result = await query.executeOnce();
        expect(result.status, mode).toBe(
          mode === 'allow'
            ? 'observed_candidate'
            : mode === 'deny'
              ? 'not_authorized'
              : mode === 'unsupported'
                ? 'unsupported'
                : 'query_unverified',
        );
        expect(asks).toBe(mode === 'unsupported' ? 0 : 1);
        expect(result.leaseRetained).toBe(true);
        expect(() => lease.resources.prove()).toThrow();
      }
      const executable = join(root, 'control');
      const build = await startCaptureProcess(
        [
          'xcrun',
          'swiftc',
          '-warnings-as-errors',
          '-module-cache-path',
          join(root, 'cache'),
          join(import.meta.dir, '../native/itestagent-memory-query-ipc.swift'),
          join(import.meta.dir, '../native/itestagent-memory-query-control.swift'),
          join(import.meta.dir, 'memory-query-control-fixture.swift'),
          '-o',
          executable,
        ],
        { timeoutMs: 60000 },
      ).completed;
      expect(build.exitCode, build.stderr).toBe(0);
      for (const mode of ['pre-eof', 'callback-pending']) {
        const child = Bun.spawn([executable], { stdin: 'pipe', stdout: 'pipe', stderr: 'pipe' });
        const errors = new Response(child.stderr).text();
        const reader = child.stdout.getReader();
        if (mode === 'pre-eof') child.stdin.end();
        let output = '';
        for (;;) {
          const part = await reader.read();
          if (part.done) break;
          output += new TextDecoder().decode(part.value);
          if (mode === 'callback-pending' && output.includes('ready')) child.stdin.end();
        }
        expect(await child.exited, await errors).toBe(0);
        const result = JSON.parse(output.slice(output.indexOf('\n') + 1));
        expect(result.cancelledBeforeMainDrain).toBe(true);
        expect(result.callback).toBe(true);
        expect(result.grantSent).toBe(false);
        if (mode === 'pre-eof') expect(result.launchAttempted).toBe(false);
      }
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  },
  90000,
);
