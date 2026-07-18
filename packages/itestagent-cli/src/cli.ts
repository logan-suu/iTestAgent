import { join } from 'node:path';
import { stdout } from 'node:process';
import { createInterface } from 'node:readline';
import { Command } from 'commander';
import { confirmAction } from './config/confirm.js';
import { KeychainSecretStore } from './config/keychain-secret-store.js';
import { createSecretStore, loadConfig, resolveCredentials } from './config/loader.js';
import { saveProjectConfig } from './config/saver.js';
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

  // ─── doctor (task 1.11: physical readiness lane) ───
  program
    .command('doctor')
    .description('environment diagnostics and setup guidance')
    .option('--physical-only', 'only check physical device readiness')
    .action(async () => {
      const { runDoctor } = await import('./doctor/doctor.js');
      const { formatDoctorReport } = await import('./doctor/format.js');
      const report = await runDoctor();
      console.log(formatDoctorReport(report));
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
  const configCmd = program
    .command('config')
    .description('config management (three-layer JSONC merge + credential storage)');

  // config show — display effective merged config
  configCmd
    .command('show')
    .description('show effective config (three-layer JSONC merge)')
    .action(async () => {
      const { config, sources } = await loadConfig();
      console.log(JSON.stringify(config, null, 2));
      console.error('\nConfig sources:');
      for (const source of sources) {
        const mark = source.exists ? '\u2713' : '\u2717';
        console.error(`  ${mark} ${source.path}`);
      }
      // Show credential status
      if (config.model.apiKeyRef) {
        const secretStore = createSecretStore();
        const { resolvedApiKey } = await resolveCredentials(config, secretStore);
        console.error(
          `\nCredentials: apiKeyRef="${config.model.apiKeyRef}" → ${resolvedApiKey ? 'resolved (Keychain)' : 'NOT FOUND in Keychain'}`,
        );
      }
    });

  // Default config (no subcommand) → show
  configCmd.action(async () => {
    const { config, sources } = await loadConfig();
    console.log(JSON.stringify(config, null, 2));
    console.error('\nConfig sources:');
    for (const source of sources) {
      const mark = source.exists ? '\u2713' : '\u2717';
      console.error(`  ${mark} ${source.path}`);
    }
  });

  // config set-secret — store credential in Keychain (US-18.2 AC3)
  configCmd
    .command('set-secret <key>')
    .description('store a credential in macOS Keychain (value read interactively, not echoed)')
    .action(async (key: string) => {
      const secretStore = createSecretStore();
      const isKeychain = secretStore instanceof KeychainSecretStore;

      if (!isKeychain) {
        console.error('Error: KeychainSecretStore is only available on macOS.');
        process.exit(1);
      }

      // Confirm high-risk operation before storing (R7)
      const confirmed = await confirmAction({
        action: 'Store credential',
        details: `Store a credential for "${key}" in macOS Keychain`,
      });
      if (confirmed !== 'yes') {
        console.error('Aborted.');
        process.exit(1);
      }

      // Read secret via stdout.write with a muted readline to prevent echo
      const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });

      const value = await new Promise<string>((resolve) => {
        stdout.write(`Enter value for "${key}" (input hidden): `);
        // raw mode on the underlying stdin to suppress local echo
        if (process.stdin.isTTY) {
          process.stdin.setRawMode?.(true);
        }
        let raw = '';
        const onData = (data: Buffer) => {
          const str = data.toString('utf-8');
          if (str === '\r' || str === '\n') {
            process.stdin.removeListener('data', onData);
            if (process.stdin.isTTY) {
              process.stdin.setRawMode?.(false);
            }
            stdout.write('\n');
            resolve(raw.trim());
          } else if (str === '\u007f' || str === '\b') {
            // Backspace
            raw = raw.slice(0, -1);
          } else if (str === '\u0003') {
            // Ctrl+C
            process.stdin.removeListener('data', onData);
            resolve('');
          } else {
            raw += str;
          }
        };
        process.stdin.on('data', onData);
      });

      rl.close();

      if (!value) {
        console.error('Error: empty value is not allowed.');
        process.exit(1);
      }

      await secretStore.set(key, value);
      console.log(`Credential "${key}" stored in Keychain.`);
    });

  // config get-secret — retrieve credential from Keychain (US-18.2 AC3)
  configCmd
    .command('get-secret <key>')
    .description('retrieve a stored credential from macOS Keychain')
    .action(async (key: string) => {
      const secretStore = createSecretStore();
      const value = await secretStore.get(key);
      if (value === null) {
        console.error(`Credential "${key}" not found.`);
        process.exit(1);
      }
      console.log(value);
    });

  // config delete-secret — remove credential from Keychain
  configCmd
    .command('delete-secret <key>')
    .description('remove a stored credential from macOS Keychain')
    .action(async (key: string) => {
      const confirmed = await confirmAction({
        action: 'Delete credential',
        details: `Remove the credential for "${key}" from macOS Keychain`,
      });
      if (confirmed !== 'yes') {
        console.error('Aborted.');
        process.exit(1);
      }

      const secretStore = createSecretStore();
      await secretStore.delete(key);
      console.log(`Credential "${key}" removed from Keychain.`);
    });

  // config init — generate project-level config skeleton (US-18.3 AC2)
  configCmd
    .command('init')
    .description('generate a project-level itestagent.jsonc skeleton (requires confirmation)')
    .action(async () => {
      const { config: existingConfig } = await loadConfig();
      try {
        const configPath = await saveProjectConfig(existingConfig, process.cwd(), {
          configPath: join(process.cwd(), 'itestagent.jsonc'),
        });
        console.log(`Project config written: ${configPath}`);
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        console.error(`Aborted: ${message}`);
        process.exit(1);
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
