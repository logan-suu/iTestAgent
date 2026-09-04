import { describe, expect, it, test } from 'bun:test';
import { join } from 'node:path';
import type { Command } from 'commander';
import {
  assertInteractiveValueRefs,
  assertSafeRunId,
  createProgram,
  parseReplayPort,
  selectConfirmedPhysicalDevice,
} from '../src/cli.js';
import { VERSION } from '../src/version.js';

const cliPath = join(import.meta.dir, '..', 'src', 'cli.ts');

test('createProgram returns a Command instance with correct name', () => {
  const program = createProgram();
  expect(program).toBeDefined();
  expect(program.name()).toBe('itestagent');
});

test('program has --version flag that outputs VERSION (US-1.1 AC2)', () => {
  const program = createProgram();
  const versionOption = program.options.find((opt) => opt.flags.includes('--version'));
  expect(versionOption).toBeDefined();
  expect(VERSION).toBe('0.0.1');
});

test('program registers all required subcommands (AGENTS.md §11)', () => {
  const program = createProgram();
  const commandNames = program.commands.map((cmd) => cmd.name());
  expect(commandNames).toContain('doctor');
  expect(commandNames).toContain('devices');
  expect(commandNames).toContain('config');
  expect(commandNames).toContain('explain');
  expect(commandNames).toContain('rerun');
  expect(commandNames).toContain('run');
});

test('run command has flow subcommand (AGENTS.md §11: itestagent run flow <id>)', () => {
  const program = createProgram();
  const runCmd = program.commands.find((cmd) => cmd.name() === 'run');
  expect(runCmd).toBeDefined();
  const flowCmd = runCmd?.commands.find((cmd) => cmd.name() === 'flow');
  expect(flowCmd).toBeDefined();
  expect(flowCmd?.options.some((option) => option.flags.includes('--validate-only'))).toBe(true);
  expect(flowCmd?.options.some((option) => option.flags.includes('--target-kind'))).toBe(true);
  expect(flowCmd?.options.some((option) => option.flags.includes('--wda-local-port'))).toBe(true);
  expect(flowCmd?.options.some((option) => option.flags.includes('--mjpeg-server-port'))).toBe(
    true,
  );
  expect(flowCmd?.options.some((option) => option.flags.includes('--execute'))).toBe(false);
});

test('Flow replay ports reject partial and out-of-range numbers', () => {
  expect(parseReplayPort('8200')).toBe(8200);
  expect(() => parseReplayPort('8200abc')).toThrow('integer between 1 and 65535');
  expect(() => parseReplayPort('0')).toThrow('integer between 1 and 65535');
  expect(() => parseReplayPort('65536')).toThrow('integer between 1 and 65535');
});

test('Flow replay rejects valueRef prompting when stdin is not a TTY', () => {
  expect(() => assertInteractiveValueRefs(['session.secret.email'], false)).toThrow(
    'A TTY is required',
  );
  expect(() => assertInteractiveValueRefs([], false)).not.toThrow();
  expect(() => assertInteractiveValueRefs(['session.secret.email'], true)).not.toThrow();
});

test('rerun exposes failed-only without DeviceBackend WDA controls', () => {
  const program = createProgram();
  const rerunCmd = program.commands.find((cmd) => cmd.name() === 'rerun');
  expect(rerunCmd).toBeDefined();
  const failedOnlyOption = rerunCmd?.options.find((opt) => opt.flags.includes('--failed-only'));
  expect(failedOnlyOption).toBeDefined();
  expect(rerunCmd?.options.some((option) => option.flags.includes('--wda-mode'))).toBe(false);
  expect(rerunCmd?.options.some((option) => option.flags.includes('--wda-local-port'))).toBe(false);
  expect(rerunCmd?.options.some((option) => option.flags.includes('--mjpeg-server-port'))).toBe(
    false,
  );
});

test('explore exposes an explicit WDA URL for Route B', () => {
  const program = createProgram();
  const explore = program.commands.find((cmd) => cmd.name() === 'explore');
  expect(explore).toBeDefined();
  expect(explore?.options.some((option) => option.flags.includes('--wda-url'))).toBe(true);
});

test('explore rejects unsafe run identifiers', () => {
  expect(() => assertSafeRunId('../../outside')).toThrow('not a safe identifier');
  expect(() => assertSafeRunId('run-safe_1.0')).not.toThrow();
  expect(() => assertSafeRunId('a'.repeat(128))).not.toThrow();
  expect(() => assertSafeRunId('a'.repeat(129))).toThrow('not a safe identifier');
});

test('explore cannot override a confirmed physical selector', () => {
  const observedDevices = [
    {
      hardwareProperties: { udid: 'UDID-1' },
      deviceProperties: { name: 'Primary iPhone', osVersionNumber: '18.2' },
    },
    {
      hardwareProperties: { udid: 'UDID-2' },
      deviceProperties: { name: 'Other iPhone', osVersionNumber: '18.2' },
    },
  ];
  expect(() =>
    selectConfirmedPhysicalDevice({
      cliUdid: 'UDID-2',
      selector: { selector: 'by_udid', udid: 'UDID-1' },
      observedDevices,
    }),
  ).toThrow('does not match confirmed UDID');
  expect(
    selectConfirmedPhysicalDevice({
      cliUdid: 'UDID-1',
      selector: { selector: 'by_name', name: 'Primary iPhone' },
      observedDevices,
    }).hardwareProperties?.udid,
  ).toBe('UDID-1');
  expect(() =>
    selectConfirmedPhysicalDevice({
      cliUdid: 'UDID-1',
      selector: { selector: 'local_connected' },
      observedDevices,
    }),
  ).toThrow('does not uniquely match');
  expect(
    selectConfirmedPhysicalDevice({
      cliUdid: 'UDID-1',
      selector: { selector: 'local_connected' },
      observedDevices: [observedDevices[0] as (typeof observedDevices)[number]],
    }).hardwareProperties?.udid,
  ).toBe('UDID-1');
});

test('no subcommand action outputs TUI placeholder (US-18.1 AC1: no login required)', () => {
  const program = createProgram();
  // program.action is set for the default (no-subcommand) case
  expect(program.action).toBeDefined();
  // US-4.1 AC1: itestagent 无参数时进入 TUI（US-18.1 AC1: no login required）
});

// ─── parseAsync 执行级断言（W5 补强：验证 action 输出接线）───

test('--version outputs correct version via spawnSync (US-1.1 AC2)', () => {
  const result = Bun.spawnSync({
    cmd: ['bun', cliPath, '--version'],
  });
  expect(result.exitCode).toBe(0);
  expect(result.stdout.toString().trim()).toBe(VERSION);
});

test('no subcommand outputs TUI terminal notice via spawnSync (US-4.1 AC1)', () => {
  const result = Bun.spawnSync({
    cmd: ['bun', cliPath],
  });
  expect(result.exitCode).toBe(0);
  const stdout = result.stdout.toString();
  // Non-TTY environments get a notice that TUI requires a terminal
  expect(stdout).toContain('TUI requires a terminal');
});

test.skipIf(process.env.ITESTAGENT_RUN_HOST_INTEGRATION_TESTS !== '1')(
  'doctor subcommand runs physical readiness checks (task 1.11)',
  () => {
    const result = Bun.spawnSync({
      cmd: ['bun', cliPath, 'doctor'],
    });
    expect(result.exitCode).toBe(0);
    const stdout = result.stdout.toString();
    expect(stdout).toContain('iTestAgent Doctor');
    expect(stdout).toContain('Physical Readiness');
  },
);

test('config subcommand outputs merged config via spawnSync (US-18.2)', () => {
  const result = Bun.spawnSync({
    cmd: ['bun', cliPath, 'config'],
  });
  expect(result.exitCode).toBe(0);
  const stdout = result.stdout.toString();
  expect(stdout).toContain('schemaVersion');
  expect(stdout).toContain('provider');
});

test('explain command has --json option (US-14.1 AC2: structured output)', () => {
  const program = createProgram();
  const explainCmd = program.commands.find((cmd) => cmd.name() === 'explain');
  expect(explainCmd).toBeDefined();
  const jsonOption = explainCmd?.options.find((opt) => opt.flags.includes('--json'));
  expect(jsonOption).toBeDefined();
});

test('explain with non-existent run exits with error', () => {
  const result = Bun.spawnSync({
    cmd: ['bun', cliPath, 'explain', 'nonexistent-run-99999'],
  });
  expect(result.exitCode).toBe(1);
  const stderr = result.stderr.toString();
  expect(stderr).toContain('Error');
});

test('explain latest with no runs exits with error', () => {
  const result = Bun.spawnSync({
    cmd: ['bun', cliPath, 'explain', 'latest'],
  });
  expect(result.exitCode).toBe(1);
});

test('rerun with non-existent run exits with error', () => {
  const result = Bun.spawnSync({
    cmd: ['bun', cliPath, 'rerun', 'nonexistent-run-99999'],
  });
  expect(result.exitCode).toBe(1);
  const stderr = result.stderr.toString();
  expect(stderr).toContain('Error');
});

// ─── B17 seam: public error surface ───────────────────────────────

describe('B17 seam: public error surface', () => {
  it('maps unknown errors to a generic safe message', async () => {
    const { toPublicMessage, PublicCliError } = await import('../src/public-error.js');
    expect(toPublicMessage(new Error('internal /Users/x secret'))).not.toContain('/Users');
    expect(toPublicMessage(new PublicCliError('explicit failure'))).toBe('explicit failure');
  });
});
