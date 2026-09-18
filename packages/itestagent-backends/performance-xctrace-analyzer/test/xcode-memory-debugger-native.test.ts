import { expect, test } from 'bun:test';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { startCaptureProcess } from '../src/capture-process.js';
import {
  memoryCompactIdentityConsoleCommand,
  memoryConsoleAckCommand,
  memoryExitConsoleCommand,
  memoryIdentityConsoleCommand,
  parseMemoryConsoleAck,
  parseMemoryDebuggerExit,
  parseMemoryDebuggerIdentity,
  sameMemoryDebuggerProcess,
} from '../src/xcode-memory-debugger-identity.js';

const enabled =
  process.platform === 'darwin' && process.env.ITESTAGENT_NATIVE_IDENTITY_TEST === '1';
test.skipIf(!enabled)(
  'real public LLDB distinguishes two owned host process instances and rejects exited targets',
  async () => {
    const root = mkdtempSync('/private/tmp/itestagent-identity-');
    try {
      const source = join(root, 'fixture.c');
      const executable = join(root, 'fixture');
      const output = join(root, 'result.json');
      writeFileSync(source, 'int main(void) { return 0; }\n', { flag: 'wx', mode: 0o600 });
      const compiled = await startCaptureProcess(
        ['xcrun', 'clang', '-g', source, '-o', executable],
        { timeoutMs: 15000 },
      ).completed;
      expect(compiled.exitCode).toBe(0);
      const harness = readFileSync(
        join(import.meta.dir, 'memory-identity-lldb-fixture.py'),
        'utf8',
      );
      const modulePath = join(import.meta.dir, '../native/itestagent_memory_identity.py');
      const firstRequest = randomUUID();
      const compactRequest = randomUUID();
      const secondRequest = randomUUID();
      const exitRequests = [randomUUID(), randomUUID()];
      const missingRequest = randomUUID();
      const ackRequest = randomUUID();
      const command = `script exec(${JSON.stringify(harness)}); fixture = IdentityFixture(lldb.debugger, ${JSON.stringify(modulePath)}, ${JSON.stringify(executable)}, ${JSON.stringify(output)}, ${JSON.stringify(exitRequests)})`;
      const result = await startCaptureProcess(
        [
          'xcrun',
          'lldb',
          '--no-lldbinit',
          '--batch',
          '-o',
          memoryConsoleAckCommand(ackRequest),
          '-o',
          command,
          '-o',
          memoryIdentityConsoleCommand(firstRequest),
          '-o',
          memoryCompactIdentityConsoleCommand(compactRequest),
          '-o',
          'script fixture.restart()',
          '-o',
          memoryIdentityConsoleCommand(secondRequest),
          '-o',
          'script fixture.close()',
          '-o',
          memoryExitConsoleCommand(missingRequest, {
            protocolVersion: 1,
            requestId: missingRequest,
            status: 'observed',
            debuggerId: 0,
            processInstance: 1,
            pid: 1,
            moduleUUID: 'a'.repeat(32),
            triple: 'fixture',
            platform: 'fixture',
            executable: '/fixture',
          }),
        ],
        { timeoutMs: 30000 },
      ).completed;
      expect(result.failure).toBeUndefined();
      expect(result.exitCode).toBe(0);
      const acknowledgements = result.stdout
        .split('\n')
        .filter((line) => line.startsWith('ITESTAGENT_MEMORY_ACK '));
      expect(acknowledgements).toHaveLength(1);
      expect(parseMemoryConsoleAck(acknowledgements[0] ?? '', ackRequest)).toEqual({
        protocolVersion: 1,
        requestId: ackRequest,
        status: 'acknowledged',
      });
      const lines = result.stdout
        .split('\n')
        .filter((line) => line.startsWith('ITESTAGENT_MEMORY_IDENTITY '));
      expect(lines).toHaveLength(3);
      const first = parseMemoryDebuggerIdentity(lines[0] ?? '', firstRequest);
      const compact = parseMemoryDebuggerIdentity(lines[1] ?? '', compactRequest);
      const second = parseMemoryDebuggerIdentity(lines[2] ?? '', secondRequest);
      expect(first).toBeDefined();
      expect(second).toBeDefined();
      if (!first || !second) throw new Error('fixture.console_query_failed');
      expect(compact).toEqual({ ...first, requestId: compactRequest });
      expect(sameMemoryDebuggerProcess(first, second)).toBe(false);
      const exits = result.stdout
        .split('\n')
        .filter((line) => line.startsWith('ITESTAGENT_MEMORY_EXIT '));
      expect(exits).toHaveLength(3);
      expect(parseMemoryDebuggerExit(exits[0] ?? '', exitRequests[0] ?? '', first)).toBeDefined();
      expect(parseMemoryDebuggerExit(exits[1] ?? '', exitRequests[1] ?? '', second)).toBeDefined();
      expect(
        parseMemoryDebuggerExit(exits[0] ?? '', exitRequests[0] ?? '', second),
      ).toBeUndefined();
      expect(JSON.parse((exits[2] ?? '').slice('ITESTAGENT_MEMORY_EXIT '.length))).toEqual({
        protocolVersion: 1,
        requestId: missingRequest,
        status: 'unverifiable',
      });
      expect(JSON.parse(readFileSync(output, 'utf8'))).toEqual({
        emptyBlocked: true,
        stableWithinProcess: true,
        uuidPresent: true,
        exitedBlocked: true,
        generationChanged: true,
        debuggerStable: true,
        cleanupVerified: true,
        liveExitBlocked: true,
        exactExitObserved: true,
        wrongExitIdentityBlocked: true,
        restartExitBlocked: true,
        missingTargetExitBlocked: true,
      });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  },
  60000,
);
