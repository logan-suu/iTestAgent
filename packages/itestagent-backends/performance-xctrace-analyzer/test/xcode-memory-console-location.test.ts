import { expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { startCaptureProcess } from '../src/capture-process.js';

test.skipIf(process.platform !== 'darwin')(
  'native console locator requires a unique input/output pair with stable ownership and range access',
  async () => {
    const root = mkdtempSync('/private/tmp/itestagent-console-location-');
    try {
      const executable = join(root, 'location');
      const sources = [
        'itestagent-memory-ax-capabilities.swift',
        'itestagent-memory-ax-context.swift',
        'itestagent-memory-local-document.swift',
        'itestagent-memory-identity-script.swift',
        'itestagent-memory-console-response.swift',
        'itestagent-memory-console-location.swift',
      ].map((file) => join(import.meta.dir, '../native', file));
      const compiled = await startCaptureProcess(
        [
          'xcrun',
          'swiftc',
          '-warnings-as-errors',
          '-module-cache-path',
          join(root, 'cache'),
          ...sources,
          join(import.meta.dir, 'memory-console-location-fixture.swift'),
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
        uniquePair: true,
        rangeChecked: true,
        driftBlocked: true,
        cancelAndDeadline: true,
        candidateOnly: true,
      });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  },
  90000,
);
