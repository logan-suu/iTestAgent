import { expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { startCaptureProcess } from '../src/capture-process.js';

test.skipIf(process.platform !== 'darwin')(
  'native AX context binds capabilities to the same bounded focused candidate',
  async () => {
    const root = mkdtempSync('/private/tmp/itestagent-ax-context-');
    try {
      const executable = join(root, 'context');
      const compiled = await startCaptureProcess(
        [
          'xcrun',
          'swiftc',
          '-warnings-as-errors',
          '-module-cache-path',
          join(root, 'cache'),
          join(import.meta.dir, '../native/itestagent-memory-ax-capabilities.swift'),
          join(import.meta.dir, '../native/itestagent-memory-ax-context.swift'),
          join(import.meta.dir, '../native/itestagent-memory-local-document.swift'),
          join(import.meta.dir, 'memory-ax-context-fixture.swift'),
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
        uniqueContext: true,
        conflictsBlocked: true,
        boundedTraversal: true,
        cancelAndDrift: true,
        capabilitiesBound: true,
        foreignOwnerRejected: true,
      });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  },
  90000,
);
