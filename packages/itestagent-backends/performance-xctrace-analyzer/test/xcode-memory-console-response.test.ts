import { expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { startCaptureProcess } from '../src/capture-process.js';
import { parseMemoryDebuggerIdentity } from '../src/xcode-memory-debugger-identity.js';

test.skipIf(process.platform !== 'darwin')(
  'native console receiver isolates bounded new response candidates before strict identity validation',
  async () => {
    const root = mkdtempSync('/private/tmp/itestagent-console-response-');
    try {
      const executable = join(root, 'receiver');
      const compiled = await startCaptureProcess(
        [
          'xcrun',
          'swiftc',
          '-warnings-as-errors',
          '-module-cache-path',
          join(root, 'cache'),
          join(import.meta.dir, '../native/itestagent-memory-identity-script.swift'),
          join(import.meta.dir, '../native/itestagent-memory-console-response.swift'),
          join(import.meta.dir, 'memory-console-response-fixture.swift'),
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
      const data = JSON.parse(result.stdout);
      expect(data).toMatchObject({
        boundedReads: true,
        partialAndStale: true,
        duplicateBlocked: true,
        cancelDriftAndSource: true,
        nativeMissingElementBlocked: true,
      });
      const identity = parseMemoryDebuggerIdentity(data.candidate, data.requestID);
      expect(identity).toMatchObject({ status: 'observed', processInstance: 1, pid: 123 });
      // Native collection does not bypass the existing strict semantic boundary.
      expect(parseMemoryDebuggerIdentity(data.candidate, crypto.randomUUID())).toBeUndefined();
      expect(
        parseMemoryDebuggerIdentity(data.candidate.replace('"pid":123', '"pid":0'), data.requestID),
      ).toBeUndefined();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  },
  90000,
);
