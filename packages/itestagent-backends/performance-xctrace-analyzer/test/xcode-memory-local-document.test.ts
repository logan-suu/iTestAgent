import { expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { startCaptureProcess } from '../src/capture-process.js';

test.skipIf(process.platform !== 'darwin')(
  'local document binding accepts directory URL aliases but rejects foreign or replaced projects',
  async () => {
    const root = mkdtempSync('/private/tmp/itestagent-local-document-');
    try {
      const executable = join(root, 'capabilities');
      const compiled = await startCaptureProcess(
        [
          'xcrun',
          'swiftc',
          '-warnings-as-errors',
          '-module-cache-path',
          join(root, 'cache'),
          join(import.meta.dir, '../native/itestagent-memory-local-document.swift'),
          join(import.meta.dir, 'memory-local-document-fixture.swift'),
          '-o',
          executable,
        ],
        { timeoutMs: 60000 },
      ).completed;
      expect(compiled.exitCode, compiled.stderr).toBe(0);
      const result = await startCaptureProcess([executable, root], { timeoutMs: 5000 }).completed;
      expect(result.failure).toBeUndefined();
      expect(result.exitCode, result.stderr).toBe(0);
      expect(JSON.parse(result.stdout)).toEqual({
        directoryRepresentations: true,
        aliases: true,
        unsafeURLsRejected: true,
        replacementRejected: true,
      });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  },
  90000,
);
