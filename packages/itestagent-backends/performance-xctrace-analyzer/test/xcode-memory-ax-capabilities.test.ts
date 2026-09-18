import { expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { startCaptureProcess } from '../src/capture-process.js';

test.skipIf(process.platform !== 'darwin')(
  'native AX capability inspection fails closed without reading text or performing actions',
  async () => {
    const root = mkdtempSync('/private/tmp/itestagent-ax-capabilities-');
    try {
      const executable = join(root, 'capabilities');
      const compiled = await startCaptureProcess(
        [
          'xcrun',
          'swiftc',
          '-warnings-as-errors',
          '-module-cache-path',
          join(root, 'cache'),
          join(import.meta.dir, '../native/itestagent-memory-ax-capabilities.swift'),
          join(import.meta.dir, 'memory-ax-capabilities-fixture.swift'),
          '-o',
          executable,
        ],
        { timeoutMs: 60000 },
      ).completed;
      expect(compiled.exitCode, compiled.stderr).toBe(0);
      const result = await startCaptureProcess([executable], { timeoutMs: 5000 }).completed;
      expect(result.failure).toBeUndefined();
      expect(result.exitCode, result.stderr).toBe(0);
      expect(JSON.parse(result.stdout)).toEqual({
        metadataOnly: true,
        failClosed: true,
        cancelAndDrift: true,
        deadline: true,
        invalidNativeElementBlocked: true,
      });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  },
  90000,
);
