import { expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { startCaptureProcess } from '../src/capture-process.js';
import { queryNativeSources } from '../src/xcode-memory-query-candidate.js';

test.skipIf(process.platform !== 'darwin')(
  'helper observes asynchronous resource closure after transport failure',
  async () => {
    const root = mkdtempSync('/private/tmp/itestagent-helper-closure-test-');
    try {
      const executable = join(root, 'fixture');
      const build = await startCaptureProcess(
        [
          'xcrun',
          'swiftc',
          '-warnings-as-errors',
          '-module-cache-path',
          join(root, 'cache'),
          ...queryNativeSources.map((file) => join(import.meta.dir, '../native', file)),
          join(import.meta.dir, 'memory-helper-closure-fixture.swift'),
          '-o',
          executable,
        ],
        { timeoutMs: 60000 },
      ).completed;
      expect(build.exitCode, build.stderr).toBe(0);
      for (const mode of ['immediate', 'delayed', 'never', 'pre-cancelled']) {
        const run = await startCaptureProcess([executable, mode], { timeoutMs: 4000 }).completed;
        expect(run.exitCode, run.stderr).toBe(0);
        const result = JSON.parse(run.stdout);
        expect(result.safeToExit, mode).toBe(mode !== 'never');
        expect(result.callbacks).toBe(1);
        expect(result.cancellations).toBe(1);
        expect(result.timerStopped).toBe(true);
        if (mode === 'delayed') expect(result.observations).toBeGreaterThan(1);
      }
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  },
  90000,
);
