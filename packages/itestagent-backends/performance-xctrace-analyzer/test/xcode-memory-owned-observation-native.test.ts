import { expect, test } from 'bun:test';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { startCaptureProcess } from '../src/capture-process.js';

const enabled =
  process.platform === 'darwin' && process.env.ITESTAGENT_OWNED_OBSERVATION_TEST === '1';
test.skipIf(!enabled)(
  'retained public LLDB objects survive selected-target changes',
  async () => {
    // Explicit single-attempt gate. Keep artifacts, including failure evidence.
    const reservation = process.env.ITESTAGENT_OWNED_OBSERVATION_RESERVATION;
    if (!reservation?.startsWith('/private/tmp/')) throw new Error('fixture.reservation_required');
    writeFileSync(reservation, 'reserved\n', { flag: 'wx', mode: 0o600 });
    const root = mkdtempSync('/private/tmp/itestagent-owned-lldb-');
    const source = join(root, 'fixture.c');
    const executable = join(root, 'fixture');
    const output = join(root, 'result.json');
    writeFileSync(source, 'int main(void) { return 0; }\n', { mode: 0o600 });
    const compiled = await startCaptureProcess(['xcrun', 'clang', '-g', source, '-o', executable], {
      timeoutMs: 15000,
    }).completed;
    expect(compiled.exitCode).toBe(0);
    const harness = readFileSync(join(import.meta.dir, 'memory-owned-observation-lldb.py'), 'utf8');
    const command = `script exec(${JSON.stringify(harness)}); run_owned_observation(${JSON.stringify(join(import.meta.dir, '../native'))}, ${JSON.stringify(executable)}, ${JSON.stringify(output)})`;
    const child = Bun.spawn(['xcrun', 'lldb', '--no-lldbinit', '--batch', '-o', command], {
      stdin: 'ignore',
      stdout: 'pipe',
      stderr: 'pipe',
    });
    // Drain without persisting raw debugger output. No timeout kill or retry.
    const drains = Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
    ]);
    let timer: ReturnType<typeof setTimeout> | undefined;
    const exit = await Promise.race([
      child.exited,
      new Promise<undefined>((resolve) => {
        timer = setTimeout(() => resolve(undefined), 30000);
      }),
    ]);
    clearTimeout(timer);
    writeFileSync(
      reservation,
      `${JSON.stringify({ root, output, launcherPID: child.pid, exitObserved: exit !== undefined })}\n`,
    );
    expect(exit).toBe(0);
    await drains;
    const result = JSON.parse(readFileSync(output, 'utf8'));
    expect(result).toEqual({
      passed: true,
      selectedTargetChanged: true,
      originalLiveAfterSwitch: true,
      originalExitAfterSwitch: true,
      differentProcessInstance: true,
      originalExitWhileSecondLive: true,
      releaseOnlyDropsReference: true,
      releasedUnverifiable: true,
      normalExits: true,
      launchCount: 2,
      allOwnedExited: true,
    });
  },
  50000,
);
