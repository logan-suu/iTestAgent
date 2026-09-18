import { expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { startCaptureProcess } from '../src/capture-process.js';

test.skipIf(process.platform !== 'darwin')(
  'explicit native Return uses only synthetic transport and consumes at most one event pair',
  async () => {
    const root = mkdtempSync('/private/tmp/itestagent-console-return-');
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
      ].map((file) => join(import.meta.dir, '../native', file));
      const compiled = await startCaptureProcess(
        [
          'xcrun',
          'swiftc',
          '-warnings-as-errors',
          '-module-cache-path',
          join(root, 'cache'),
          ...sources,
          join(import.meta.dir, 'memory-console-return-fixture.swift'),
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
      expect(JSON.parse(result.stdout)).toEqual({
        syntheticOnly: true,
        onePairMaximum: true,
        cancellationCleanup: true,
        noDeliveryClaim: true,
      });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  },
  90000,
);
