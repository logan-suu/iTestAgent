import { expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { startCaptureProcess } from '../src/capture-process.js';

test.skipIf(process.platform !== 'darwin')(
  'Xcode metadata uses fixed read events and rejects incomplete or drifting observations',
  async () => {
    const root = mkdtempSync('/private/tmp/itestagent-metadata-test-');
    try {
      const executable = join(root, 'fixture');
      const build = await startCaptureProcess(
        [
          'xcrun',
          'swiftc',
          '-warnings-as-errors',
          '-module-cache-path',
          join(root, 'cache'),
          join(import.meta.dir, '../native/itestagent-memory-owned-app.swift'),
          join(import.meta.dir, '../native/itestagent-memory-xcode-metadata.swift'),
          join(import.meta.dir, 'memory-xcode-metadata-fixture.swift'),
          '-o',
          executable,
        ],
        { timeoutMs: 60000 },
      ).completed;
      expect(build.exitCode, build.stderr).toBe(0);
      const run = await startCaptureProcess([executable], { timeoutMs: 5000 }).completed;
      expect(run.exitCode, run.stderr).toBe(0);
      expect(JSON.parse(run.stdout)).toEqual({ scenarios: 129, noAppleEventsSent: true });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  },
  90000,
);
