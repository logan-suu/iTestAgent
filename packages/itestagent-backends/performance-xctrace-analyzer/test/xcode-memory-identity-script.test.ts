import { expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { startCaptureProcess } from '../src/capture-process.js';

test.skipIf(process.platform !== 'darwin')(
  'native fixed script queries reject changed resources and preserve LLDB command quoting',
  async () => {
    const root = mkdtempSync('/private/tmp/itestagent-script-');
    try {
      const executable = join(root, 'script-fixture');
      const source = join(import.meta.dir, '../native/itestagent_memory_identity.py');
      const compiled = await startCaptureProcess(
        [
          'xcrun',
          'swiftc',
          '-warnings-as-errors',
          '-module-cache-path',
          join(root, 'cache'),
          join(import.meta.dir, '../native/itestagent-memory-identity-script.swift'),
          join(import.meta.dir, 'memory-identity-script-fixture.swift'),
          '-o',
          executable,
        ],
        { timeoutMs: 60000 },
      ).completed;
      expect(compiled.exitCode, compiled.stderr).toBe(0);
      const checked = await startCaptureProcess([executable, root, source], {
        timeoutMs: 5000,
      }).completed;
      expect(checked.failure).toBeUndefined();
      expect(checked.exitCode, checked.stderr).toBe(0);
      const result = JSON.parse(checked.stdout);
      expect(result).toMatchObject({
        fixedResource: true,
        mutationBlocked: true,
        cancelAndDrift: true,
        deadline: true,
      });
      // No target creation: test the real Swift-generated command and quoted bundle path.
      const queried = await startCaptureProcess(
        ['xcrun', 'lldb', '--no-lldbinit', '--batch', '-o', result.command],
        { timeoutMs: 15000 },
      ).completed;
      expect(queried.failure).toBeUndefined();
      expect(queried.exitCode, queried.stderr).toBe(0);
      expect(queried.stderr).toBe('');
      const lines = queried.stdout
        .split('\n')
        .filter((line) => line.startsWith('ITESTAGENT_MEMORY_IDENTITY '));
      expect(lines).toHaveLength(1);
      expect(JSON.parse(lines[0]?.slice('ITESTAGENT_MEMORY_IDENTITY '.length) ?? '')).toEqual({
        protocolVersion: 1,
        requestId: result.requestID,
        status: 'unverifiable',
      });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  },
  90000,
);
