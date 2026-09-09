import { join } from 'node:path';

export interface SimulatorProcessBinding {
  pid: number;
  birth: string;
  executable: string;
}

/** Public, target-specific queries only. Raw responses are owned by the capture audit. */
export async function bindSimulatorProcess(input: {
  simulatorId: string;
  bundleId: string;
  pid: number;
  run(command: string[]): Promise<string>;
  realpath(path: string): string;
  uid: number;
}): Promise<SimulatorProcessBinding> {
  const { run, simulatorId, bundleId, pid, realpath } = input;
  if (!Number.isSafeInteger(pid) || pid <= 0 || !bundleId || /[\r\n\0]/.test(bundleId))
    throw new Error('native_memory.invalid_target');
  const listing = await run(['xcrun', 'simctl', 'spawn', simulatorId, 'launchctl', 'list']);
  const lines = listing
    .split('\n')
    .filter((line) => line.includes(`UIKitApplication:${bundleId}[`));
  if (lines.length !== 1 || Number(lines[0]?.trim().split(/\s+/)[0]) !== pid)
    throw new Error('native_memory.process_changed');
  const app = await run(['xcrun', 'simctl', 'get_app_container', simulatorId, bundleId, 'app']);
  const executable = await run([
    '/usr/libexec/PlistBuddy',
    '-c',
    'Print:CFBundleExecutable',
    join(app, 'Info.plist'),
  ]);
  if (!executable || executable === '.' || executable === '..' || /[/\\\r\n\0]/.test(executable))
    throw new Error('native_memory.invalid_executable');
  const actual = await run(['ps', '-p', String(pid), '-o', 'comm=']);
  const birth = await run(['ps', '-p', String(pid), '-o', 'lstart=']);
  const uid = await run(['ps', '-p', String(pid), '-o', 'uid=']);
  if (!birth || Number(uid) !== input.uid || realpath(actual) !== realpath(join(app, executable)))
    throw new Error('native_memory.identity_mismatch');
  return { pid, birth, executable: realpath(actual) };
}
