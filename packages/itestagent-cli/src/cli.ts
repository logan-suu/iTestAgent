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

  // ─── doctor (physical + simulator readiness lanes) ───
  program
    .command('doctor')
    .description('environment diagnostics and setup guidance (physical + simulator)')
    .option('--physical-only', 'only check physical device readiness')
    .option('--simulator-only', 'only check simulator readiness')
    .action(async (options: { physicalOnly?: boolean; simulatorOnly?: boolean }) => {
      const { runPhysicalDoctor, runSimulatorDoctor } = await import('./doctor/doctor.js');
      const { formatDoctorReport, formatDualLaneReport } = await import('./doctor/format.js');

      if (options.simulatorOnly) {
        const report = await runSimulatorDoctor();
        console.log(formatDoctorReport(report));
      } else if (options.physicalOnly) {
        const report = await runPhysicalDoctor();
        console.log(formatDoctorReport(report));
      } else {
        // Default: run both lanes
        const [physicalReport, simulatorReport] = await Promise.all([
          runPhysicalDoctor(),
          runSimulatorDoctor(),
        ]);
        console.log(formatDualLaneReport(physicalReport, simulatorReport));
      }
    });

  // ─── devices (US-2.1/2.2/2.3 — task 1.13) ───
  program
    .command('devices')
    .description('list connected iPhones and iOS Simulators (physical + simulator, ADR-011)')
    .option('--healthcheck', 'also run device healthcheck')
    .option('--physical-only', 'only list physical devices')
    .option('--simulator-only', 'only list simulator devices')
    .action(
      async (options: {
        healthcheck?: boolean;
        physicalOnly?: boolean;
        simulatorOnly?: boolean;
      }) => {
        const { discoverPhysicalDevices, discoverSimulatorDevices, discoverAllDevices } =
          await import('./devices/discover.js');
        const { healthcheckAllDevices } = await import('./devices/healthcheck.js');
        const { formatDeviceList, formatHealthcheckResults } = await import('./devices/format.js');

        // Discover devices based on flags
        const devices = await (async () => {
          if (options.simulatorOnly) {
            return discoverSimulatorDevices();
          }
          if (options.physicalOnly) {
            return discoverPhysicalDevices();
          }
          return discoverAllDevices();
        })();

        // Print device list
        console.log(formatDeviceList(devices));

        // Optional healthcheck
        if (options.healthcheck && devices.length > 0) {
          const results = await healthcheckAllDevices(devices);
          console.log(`\n${formatHealthcheckResults(results, devices)}`);
        }
      },
    );

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

  // ─── run flow (US-9.2 AC2: replay iTestAgent Flow) ───
  // Task 3.15: Flow read + validate + summary.
  // Full replay execution deferred to task 3.17 (Phase 3 integration).
  const runCmd = program.command('run').description('run-related commands');

  runCmd
    .command('flow <id>')
    .description('validate and summarize an iTestAgent Flow (replay execution in Phase 3.17)')
    .option('--project <path>', 'also read from project .itestagent/flows/ directory')
    .action(async (flowId: string, options: { project?: string }) => {
      try {
        const { readFlowFile, safeParseFlowV2 } = await import('itestagent-flow');
        const raw = await readFlowFile(flowId);
        const result = safeParseFlowV2(raw);

        if (!result.success) {
          console.error(`❌ Flow "${flowId}" failed schema validation:\n`);
          for (const issue of result.error.issues) {
            console.error(`  - ${issue.path.join('.')}: ${issue.message}`);
          }
          process.exit(1);
        }

        const flow = result.data;

        // Summary output
        console.log(`✅ Flow "${flow.flowId}" — valid iTestAgent Flow v2`);
        console.log(`   Source:     ${flow.source}`);
        console.log(`   Status:     ${flow.status}`);
        console.log(`   Targets:    ${flow.supportedTargetKinds.join(', ')}`);
        console.log(`   Capabilities: ${flow.requiredCapabilities.join(', ')}`);
        console.log(`   Steps:      ${flow.steps.length}`);
        console.log('   Validated:');
        for (const t of flow.lastValidatedTargets) {
          const detail = t.deviceTypeIdentifier ?? t.model ?? t.udid;
          const version = t.runtimeIdentifier ?? t.osVersion ?? '';
          console.log(`     - ${t.kind}: ${detail}${version ? ` (${version})` : ''}`);
        }

        // Step summary
        console.log('\n   Steps:');
        for (let i = 0; i < flow.steps.length; i++) {
          const step = flow.steps[i];
          if (!step) continue;
          const safety = step.safetyGate ? ` [safety:${step.safetyGate}]` : '';
          const comment = step.comment ? ` — ${step.comment}` : '';
          console.log(`     ${i + 1}. ${step.action} ${step.target ?? ''}${safety}${comment}`);
        }

        if (flow.notes) {
          console.log(`\n   Notes: ${flow.notes}`);
        }

        console.log(
          `\n   Run: itestagent run flow ${flow.flowId} --execute  (available in Phase 3.17)`,
        );
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error(`❌ Failed to read flow "${flowId}": ${message}`);
        process.exit(1);
      }
    });

  return program;
}

// Entry point: when run as bin (import.meta.main is Bun-specific)
if (import.meta.main) {
  createProgram().parseAsync(process.argv);
}
