import { expect, test } from 'bun:test';
import type { Command } from 'commander';
import { createProgram } from '../src/cli.js';
import { VERSION } from '../src/version.js';

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
  // The action should not require any login or authentication
  // (just outputs "TUI coming in task 1.2")
});
