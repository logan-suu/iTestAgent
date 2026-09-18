import { expect, test } from 'bun:test';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { inflateSync } from 'node:zlib';
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
const requestId = randomUUID();
const row = {
  protocolVersion: 1,
  requestId,
  status: 'observed',
  debuggerId: 1,
  processInstance: 2,
  pid: 42,
  moduleUUID: 'a'.repeat(32),
  triple: 'arm64-apple-ios',
  platform: 'remote-ios',
  executable: '/fixture/app',
};
const line = (value: unknown) => `ITESTAGENT_MEMORY_IDENTITY ${JSON.stringify(value)}`;
test('compact candidate preserves every byte of shipped source without accepting caller code', () => {
  const command = memoryCompactIdentityConsoleCommand(requestId);
  const payload = command.match(/b64decode\('([A-Za-z0-9+/=]+)'\)/)?.[1];
  expect(payload).toBeDefined();
  expect(inflateSync(Buffer.from(payload ?? '', 'base64'))).toEqual(
    readFileSync(new URL('../native/itestagent_memory_identity.py', import.meta.url)),
  );
  expect(command.length).toBeLessThan(memoryIdentityConsoleCommand(requestId).length);
  expect(command.length).toBeLessThan(2048);
  expect(command).not.toContain('\n');
  expect(() => memoryCompactIdentityConsoleCommand("'); launch; #")).toThrow();
});
test('short ACK is request-bound transport evidence only and rejects command echoes', () => {
  const command = memoryConsoleAckCommand(requestId);
  const row = { protocolVersion: 1, requestId, status: 'acknowledged' } as const;
  const line = `ITESTAGENT_MEMORY_ACK ${JSON.stringify(row)}`;
  expect(command.length).toBeLessThan(256);
  expect(command).not.toContain('\n');
  expect(command).not.toContain('lldb.');
  expect(parseMemoryConsoleAck(line, requestId)).toEqual(row);
  for (const invalid of [
    command,
    `(lldb) ${command}`,
    `${line}\n${line}`,
    'x'.repeat(257),
    `ITESTAGENT_MEMORY_ACK ${JSON.stringify({ ...row, targetVerified: true })}`,
    `ITESTAGENT_MEMORY_ACK ${JSON.stringify({ ...row, status: 'observed' })}`,
  ])
    expect(parseMemoryConsoleAck(invalid, requestId)).toBeUndefined();
  expect(parseMemoryConsoleAck(line, randomUUID())).toBeUndefined();
  expect(parseMemoryConsoleAck(line, 'invalid')).toBeUndefined();
  expect(parseMemoryDebuggerIdentity(line, requestId)).toBeUndefined();
  expect(() => memoryConsoleAckCommand("'); launch; #")).toThrow();
});
test('exit observation is bound to the prior instance and never inferred from missing or live state', () => {
  const original = parseMemoryDebuggerIdentity(line(row), requestId);
  if (!original) throw new Error('fixture');
  const exit = {
    protocolVersion: 1,
    requestId,
    status: 'observed_exited',
    source: 'lldb_selected_process_exited',
    debuggerId: original.debuggerId,
    processInstance: original.processInstance,
    pid: original.pid,
  } as const;
  const encoded = (value: unknown) => `ITESTAGENT_MEMORY_EXIT ${JSON.stringify(value)}`;
  expect(parseMemoryDebuggerExit(encoded(exit), requestId, original)).toEqual(exit);
  for (const value of [
    { ...exit, requestId: randomUUID() },
    { ...exit, debuggerId: 99 },
    { ...exit, processInstance: 99 },
    { ...exit, pid: 99 },
    { ...exit, status: 'unverifiable' },
    { ...exit, status: 'observed' },
    { ...exit, source: 'pid_absent' },
    { ...exit, exitDescription: 'private' },
  ])
    expect(parseMemoryDebuggerExit(encoded(value), requestId, original)).toBeUndefined();
  expect(
    parseMemoryDebuggerExit(`${encoded(exit)}\n${encoded(exit)}`, requestId, original),
  ).toBeUndefined();
  expect(parseMemoryDebuggerExit('x'.repeat(2049), requestId, original)).toBeUndefined();
  const command = memoryExitConsoleCommand(requestId, original);
  expect(command).toContain('emit_exit(lldb.debugger,');
  expect(command).not.toContain('.Kill(');
  expect(command).not.toContain('.Detach(');
  expect(command).not.toContain('EvaluateExpression');
  expect(command).not.toContain('\n');
  expect(() => memoryExitConsoleCommand('not-a-uuid', original)).toThrow();
});
test('fixed console query accepts only a UUID and contains no target expression or launch', () => {
  const command = memoryIdentityConsoleCommand(requestId);
  expect(command.startsWith('script exec(')).toBe(true);
  expect(command).toContain('GetUniqueID');
  expect(command).not.toContain('EvaluateExpression');
  expect(command).not.toContain('.Launch(');
  expect(command).not.toContain('\n');
  expect(() => memoryIdentityConsoleCommand("'); launch; #")).toThrow();
});
test('rejects stale, ambiguous, malformed and extra diagnostic payloads', () => {
  expect(parseMemoryDebuggerIdentity(line(row), requestId)?.pid).toBe(42);
  for (const raw of [
    line({ ...row, requestId: randomUUID() }),
    line({ ...row, stack: 'private' }),
    line({ ...row, pid: 0 }),
    line({ ...row, status: 'unverifiable' }),
    `${line(row)}\n${line(row)}`,
    'x'.repeat(9000),
    '{}',
  ])
    expect(parseMemoryDebuggerIdentity(raw, requestId)).toBeUndefined();
});
test('same PID cannot hide a new process, debugger or module', () => {
  const original = parseMemoryDebuggerIdentity(line(row), requestId);
  if (!original) throw new Error('fixture');
  expect(sameMemoryDebuggerProcess(original, { ...original, requestId: randomUUID() })).toBe(true);
  for (const change of [
    { processInstance: 3 },
    { debuggerId: 2 },
    { pid: 43 },
    { moduleUUID: 'b'.repeat(32) },
    { platform: 'host' },
    { executable: '/other/app' },
  ])
    expect(sameMemoryDebuggerProcess(original, { ...original, ...change })).toBe(false);
});
