import { expect, test } from 'bun:test';
import { createHash, randomUUID } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { startCaptureProcess } from '../src/capture-process.js';
import {
  queryNativeSources,
  resolveMemoryNoTargetCandidate,
  reviewMemoryQueryCandidate,
  stageMemoryNoTargetCandidate,
} from '../src/xcode-memory-query-candidate.js';
import { prepareMemoryNoTargetQuery } from '../src/xcode-memory-query-closure-receipt.js';
import { reserveXcodeMemoryLease } from '../src/xcode-memory-session.js';

const binding = (sessionId: string) => ({
  sessionId,
  requestId: randomUUID(),
  strategy: 'pidReturn' as const,
  commandSHA256: 'a'.repeat(64),
});
const hash = (data: Uint8Array | string) => createHash('sha256').update(data).digest('hex');

test('arbitrary objects cannot mint closure', async () => {
  const root = mkdtempSync('/private/tmp/itestagent-closure-');
  try {
    const lease = reserveXcodeMemoryLease(root);
    const result = await prepareMemoryNoTargetQuery({
      candidate: {},
      binding: binding(lease.sessionId),
      lease,
      timeoutMs: 100,
    }).executeOnce();
    expect(result.leaseRetained).toBe(true);
    expect(result.status).toBe('query_unverified');
    expect(() => lease.resources.prove()).toThrow();
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test.skipIf(process.platform !== 'darwin')(
  'v4 native owner receipt, strict failures, pinned profile and one-use lease proof',
  async () => {
    const root = mkdtempSync('/private/tmp/itestagent-v4-test-');
    try {
      const staged = await stageMemoryNoTargetCandidate(join(root, 'candidate'));
      expect(staged.manifest.protocolVersion).toBe(4);
      await expect(
        resolveMemoryNoTargetCandidate(staged.root, staged.manifestSHA256, async () => false),
      ).rejects.toThrow('signature');
      // Replace only this test candidate's launcher with the no-GUI fixture. The
      // injected signature verifier is a trusted test adapter, never a JSON field.
      const executable = join(staged.root, 'itestagent-memory-query-launcher');
      const built = await startCaptureProcess(
        [
          'xcrun',
          'swiftc',
          '-warnings-as-errors',
          '-module-cache-path',
          join(root, 'cache'),
          ...queryNativeSources.map((x) => join(import.meta.dir, '../native', x)),
          join(import.meta.dir, 'memory-query-closure-fixture.swift'),
          '-o',
          executable,
        ],
        { timeoutMs: 60000 },
      ).completed;
      expect(built.exitCode, built.stderr).toBe(0);
      const manifest = JSON.parse(readFileSync(join(staged.root, 'candidate.json'), 'utf8'));
      manifest.files['itestagent-memory-query-launcher'] = hash(readFileSync(executable));
      function pin(mode: string) {
        writeFileSync(join(staged.root, 'mode'), mode, { mode: 0o600 });
        manifest.files.mode = hash(mode);
        const raw = `${JSON.stringify(manifest)}\n`;
        writeFileSync(join(staged.root, 'candidate.json'), raw, { mode: 0o600 });
        return hash(raw);
      }
      for (const mode of [
        'normal',
        'reuse',
        'missing',
        'wrong-session',
        'wrong-request',
        'wrong-challenge',
        'wrong-manifest',
        'wrong-instance',
        'wrong-owner',
        'unknown-exit',
        'changed-manifest',
        'cancel',
        'extra',
        'partial',
        'stderr',
        'nonzero',
        'late',
        'live-abort',
        'slow-exit',
        'forged-helper',
        'prepared-helper',
        'wire-oversize',
        'wire-utf8',
        'wire-empty',
        'wire-version',
        'wire-prepared',
        'wire-scope',
        'wire-sequence',
        'wire-boolean',
        'wire-truncated',
        'wire-duplicate',
        'replacement',
        'target',
        'identity',
        'drift',
      ]) {
        const digest = pin(mode);
        const candidate = await resolveMemoryNoTargetCandidate(
          staged.root,
          digest,
          async () => true,
        );
        const leaseRoot = mkdtempSync(join(root, 'lease-'));
        const target = {
          deviceId: 'fixture',
          bundleId: 'fixture',
          executable: '/fixture',
          buildReference: 'fixture',
        };
        const lease = reserveXcodeMemoryLease(leaseRoot, target);
        if (mode === 'target') {
          const ticket = lease.resources.begin('xcode');
          const owner = {};
          lease.resources.acquired(
            ticket,
            owner,
            () => true,
            () => true,
          );
          lease.resources.closed(ticket, owner);
        }
        if (mode === 'identity')
          lease.resources.bindIdentity({ ...target, pid: 1, generation: 'fixture' });
        if (mode === 'drift') writeFileSync(join(staged.root, 'mode'), 'changed');
        const abort = new AbortController();
        const query = prepareMemoryNoTargetQuery({
          candidate,
          lease,
          binding: binding(lease.sessionId),
          timeoutMs: mode === 'slow-exit' ? 150 : 4500,
          signal: abort.signal,
        });
        const resultPromise = query.executeOnce();
        if (mode === 'late' || mode === 'live-abort') setTimeout(() => abort.abort(), 100);
        if (mode === 'replacement') {
          renameSync(
            join(leaseRoot, 'xcode-memory-session.lock'),
            join(leaseRoot, 'original.lease'),
          );
          reserveXcodeMemoryLease(leaseRoot);
        }
        const result = await resultPromise;
        expect(result.leaseRetained, mode).toBe(!['normal', 'reuse'].includes(mode));
        expect((await query.executeOnce()).status).toBe('already_consumed');
        if (['normal', 'reuse'].includes(mode)) {
          expect(result.status).toBe('unsupported');
          expect(existsSync(join(leaseRoot, 'xcode-memory-session.lock'))).toBe(false);
          expect(() => lease.resources.prove()).toThrow();
        }
        if (mode === 'replacement')
          expect(existsSync(join(leaseRoot, 'xcode-memory-session.lock'))).toBe(true);
        if (mode === 'late' || mode === 'live-abort' || mode === 'slow-exit') await Bun.sleep(600);
        if (mode === 'normal') {
          const secondLease = reserveXcodeMemoryLease(mkdtempSync(join(root, 'reuse-')));
          const reused = await prepareMemoryNoTargetQuery({
            candidate,
            lease: secondLease,
            binding: binding(secondLease.sessionId),
            timeoutMs: 100,
          }).executeOnce();
          expect(reused.leaseRetained).toBe(true);
        }
      }
      const digest = pin('normal');
      const file = 'sources/itestagent-memory-query-helper-main.swift';
      writeFileSync(join(staged.root, file), 'unreviewed');
      manifest.files[file] = hash('unreviewed');
      const raw = JSON.stringify(manifest);
      writeFileSync(join(staged.root, 'candidate.json'), raw);
      expect(() => reviewMemoryQueryCandidate(staged.root, hash(raw))).toThrow(
        'profile_unverified',
      );
      expect(digest).toHaveLength(64);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  },
  120000,
);
