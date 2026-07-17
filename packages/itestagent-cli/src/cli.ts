import { Command } from 'commander';
import { loadConfig } from './config/loader.js';
import { VERSION } from './version.js';

/**
 * iTestAgent CLI entry point (Commander).
 *
 * AGENTS.md §11 commands:
 *   itestagent                 # enter TUI (default action)
 *   itestagent doctor          # environment diagnostics (task 1.6)
 *   itestagent devices         # list connected iPhones (task 1.7)
 *   itestagent config          # config management
 *   itestagent --version
 *   itestagent explain <run>   # failure explanation (task 5.1)
 *   itestagent rerun <run> --failed-only  (task 5.1)
 *   itestagent run flow <id>   # replay Flow (task 5.2)
 *
 * Tech choice §5: Commander as lightweight CLI entry.
 * Task 1.1 implements --version + config + subcommand stubs.
 */

/**
 * Create Commander program instance.
 * Exported as a factory function for testability (avoids calling parseAsync directly).
 */
export function createProgram(): Command {
  const program = new Command();

  program
    .name('itestagent')
    .description(
      'iPhone real-device automated testing TUI Agent — Local-first, TUI-first, Agent-native.',
    )
    .version(VERSION, '-v, --version', 'output version number');

  // US-4.1 AC1 / US-18.1 AC1: default action enters TUI (dynamic import —
  // prevents TUI renderer from blocking non-TUI commands like --version)
  program.action(async () => {
    const { startTui } = await import('itestagent-tui');
    await startTui();
  });

  // ─── doctor (stub → task 1.6) ───
  program
    .command('doctor')
    .description('environment diagnostics and setup guidance')
    .action(() => {
      console.log('Coming in task 1.6 — doctor environment diagnostics');
    });

  // ─── devices (stub → task 1.7) ───
  program
    .command('devices')
    .description('list connected iPhones')
    .action(() => {
      console.log('Coming in task 1.7 — devices discovery and healthcheck');
    });

  // ─── config (implemented: shows three-layer merged config) ───
  // US-18.2 AC1/AC2: three-layer JSONC merge + $schema support
  program
    .command('config')
    .description('show effective config (three-layer JSONC merge)')
    .action(async () => {
      const { config, sources } = await loadConfig();
      console.log(JSON.stringify(config, null, 2));
      console.error('\nConfig sources:');
      for (const source of sources) {
        const mark = source.exists ? '\u2713' : '\u2717';
        console.error(`  ${mark} ${source.path}`);
      }
    });

  // ─── explain (stub → task 5.1) ───
  program
    .command('explain <run>')
    .description('explain test failure')
    .action((runId: string) => {
      console.log(`Coming in task 5.1 — explain run: ${runId}`);
    });

  // ─── rerun (stub → task 5.1) ───
  program
    .command('rerun <run>')
    .description('rerun failed test cases')
    .option('--failed-only', 'only rerun failed cases')
    .action((runId: string, options: { failedOnly?: boolean }) => {
      const flag = options.failedOnly ? ' --failed-only' : '';
      console.log(`Coming in task 5.1 — rerun: ${runId}${flag}`);
    });

  // ─── run flow (nested subcommand, stub → task 5.2) ───
  const runCmd = program.command('run').description('run-related commands');

  runCmd
    .command('flow <id>')
    .description('replay iTestAgent Flow (debug/automation helper)')
    .action((flowId: string) => {
      console.log(`Coming in task 5.2 — run flow: ${flowId}`);
    });

  return program;
}

// Entry point: when run as bin (import.meta.main is Bun-specific)
if (import.meta.main) {
  createProgram().parseAsync(process.argv);
}
