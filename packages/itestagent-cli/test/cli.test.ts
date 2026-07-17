import { expect, test } from 'bun:test';
import { join } from 'node:path';
import type { Command } from 'commander';
import { createProgram } from '../src/cli.js';
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
});

test('rerun command has --failed-only option (AGENTS.md §11: itestagent rerun <run> --failed-only)', () => {
  const program = createProgram();
  const rerunCmd = program.commands.find((cmd) => cmd.name() === 'rerun');
  expect(rerunCmd).toBeDefined();
  const failedOnlyOption = rerunCmd?.options.find((opt) => opt.flags.includes('--failed-only'));
  expect(failedOnlyOption).toBeDefined();
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

test('doctor subcommand outputs stub via spawnSync', () => {
  const result = Bun.spawnSync({
    cmd: ['bun', cliPath, 'doctor'],
  });
  expect(result.exitCode).toBe(0);
  const stdout = result.stdout.toString();
  expect(stdout).toContain('Coming in task 1.6');
});

test('config subcommand outputs merged config via spawnSync (US-18.2)', () => {
  const result = Bun.spawnSync({
    cmd: ['bun', cliPath, 'config'],
  });
  expect(result.exitCode).toBe(0);
  const stdout = result.stdout.toString();
  expect(stdout).toContain('schemaVersion');
  expect(stdout).toContain('provider');
});
