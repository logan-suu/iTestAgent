import { expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { startCaptureProcess } from '../src/capture-process.js';

test.skipIf(process.platform !== 'darwin')(
  'document session retains original directory, window and owner without claiming closure',
  async () => {
    const root = mkdtempSync('/private/tmp/itestagent-document-session-');
    try {
      const executable = join(root, 'fixture');
      const sources = [
        'itestagent-memory-local-document.swift',
        'itestagent-memory-owned-app.swift',
        'itestagent-memory-ax-capabilities.swift',
        'itestagent-memory-ax-context.swift',
        'itestagent-memory-document-session.swift',
      ];
      const compiled = await startCaptureProcess(
        [
          'xcrun',
          'swiftc',
          '-warnings-as-errors',
          '-module-cache-path',
          join(root, 'cache'),
          ...sources.map((file) => join(import.meta.dir, '../native', file)),
          join(import.meta.dir, 'memory-document-session-fixture.swift'),
          '-o',
          executable,
        ],
        { timeoutMs: 60000 },
      ).completed;
      expect(compiled.exitCode, compiled.stderr).toBe(0);
      const run = await startCaptureProcess([executable, root], { timeoutMs: 5000 }).completed;
      expect(run.exitCode, run.stderr).toBe(0);
      expect(run.failure).toBeUndefined();
      expect(JSON.parse(run.stdout)).toEqual({ scenarios: 21, noGUI: true });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  },
  90000,
);
