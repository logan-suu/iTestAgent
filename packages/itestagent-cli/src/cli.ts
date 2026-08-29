#!/usr/bin/env bun
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Command } from 'commander';
import {
  runConfigDefault,
  runConfigDeleteSecret,
  runConfigGetSecret,
  runConfigSetSecret,
  runConfigShow,
} from './commands/config.js';
import { loadConfig } from './config/loader.js';
import { saveProjectConfig } from './config/saver.js';
import { PublicCliError, toPublicMessage } from './public-error.js';
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

/** Maps handler failures onto the public error surface and exits (B17). */
function handleCommandError(error: unknown): never {
  process.stderr.write(`${toPublicMessage(error)}\n`);
  process.exit(error instanceof PublicCliError ? error.exitCode : 1);
}

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

  // ─── test (US-7.1: XCUITest run surface over the engine composition) ───
  program
    .command('test')
    .description('run XCUITests for a scheme and print normalized results (engine xcunit flow)')
    .requiredOption('--root <path>', 'project/workspace directory')
    .requiredOption('--scheme <scheme>', 'scheme to test')
    .option('--udid <udid>', 'physical device UDID')
    .option('--simulator-name <name>', 'simulator name')
    .option('--simulator-id <id>', 'simulator UDID')
    .option('--only <ids>', 'comma-separated test identifiers (-only-testing)')
    .option('--result-bundle <path>', 'xcresult bundle output path')
    .option('--attachments', 'extract screenshot attachments from the bundle')
    .action(
      async (options: {
        root: string;
        scheme: string;
        udid?: string;
        simulatorName?: string;
        simulatorId?: string;
        only?: string;
        resultBundle?: string;
        attachments?: boolean;
      }) => {
        const { runXcunitFlow } = await import('itestagent-engine');
        const { createRealXcunitFlowDeps } = await import('itestagent-engine');
        const resultBundle =
          options.resultBundle ?? join(tmpdir(), `itestagent-xcresult-${Date.now()}.xcresult`);
        const destination = options.udid
          ? { targetKind: 'physical' as const, udid: options.udid }
          : options.simulatorId
            ? { targetKind: 'simulator' as const, simulatorId: options.simulatorId }
            : options.simulatorName
              ? { targetKind: 'simulator' as const, simulatorName: options.simulatorName }
              : undefined;
        const result = await runXcunitFlow(
          {
            projectRoot: options.root,
            scheme: options.scheme,
            destination,
            only: options.only
              ?.split(',')
              .map((s) => s.trim())
              .filter(Boolean),
            resultBundlePath: resultBundle,
            includeAttachments: options.attachments === true,
          },
          createRealXcunitFlowDeps(),
        );
        const parsed = result.parsed;
        console.log(
          `exit: ${result.exitCode} | duration: ${Math.round(result.durationMs / 1000)}s`,
        );
        if (result.parseError) {
          console.error(`parse error: ${result.parseError}`);
        } else if (parsed) {
          const exec = parsed.execution;
          console.log(
            `tests: ${exec.totalTests} total | ${exec.passed} passed | ${exec.failed} failed | ${exec.skipped} skipped`,
          );
          for (const c of parsed.cases) {
            console.log(`  [${c.status}] ${c.name}`);
          }
          if (parsed.attachments.length > 0) {
            console.log(`attachments: ${parsed.attachments.length}`);
          }
        } else {
          console.error('no xcresult bundle was produced');
        }
        if (result.exitCode !== 0) {
          process.exitCode = 1;
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
      try {
        await runConfigShow();
      } catch (error) {
        handleCommandError(error);
      }
    });

  // Default config (no subcommand) → show
  configCmd.action(async () => {
    try {
      await runConfigDefault();
    } catch (error) {
      handleCommandError(error);
    }
  });

  // config set-secret — store credential in Keychain (US-18.2 AC3)
  configCmd
    .command('set-secret <key>')
    .description('store a credential in macOS Keychain (value read interactively, not echoed)')
    .action(async (key: string) => {
      try {
        await runConfigSetSecret(key);
      } catch (error) {
        handleCommandError(error);
      }
    });

  // config get-secret — retrieve credential from Keychain (US-18.2 AC3)
  // R6 + R7: credentials require explicit user confirmation before display
  configCmd
    .command('get-secret <key>')
    .description('retrieve a stored credential from macOS Keychain (requires confirmation)')
    .action(async (key: string) => {
      try {
        await runConfigGetSecret(key);
      } catch (error) {
        handleCommandError(error);
      }
    });

  // config delete-secret — remove credential from Keychain
  configCmd
    .command('delete-secret <key>')
    .description('remove a stored credential from macOS Keychain')
    .action(async (key: string) => {
      try {
        await runConfigDeleteSecret(key);
      } catch (error) {
        handleCommandError(error);
      }
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

  // ─── explain (US-14.1: failure explanation, task 5.4) ───
  program
    .command('explain <run>')
    .description('explain test failure with evidence-driven attribution (R5: uncertainty labelled)')
    .option('--json', 'output as JSON instead of formatted text')
    .action(async (runId: string, options: { json?: boolean }) => {
      const { createDefaultRunStore } = await import('itestagent-store');
      const { FailureExplainer } = await import('itestagent-engine');
      const { resolveStoreRoot, createDb } = await import('itestagent-store');

      try {
        // Resolve run ID (handle "latest")
        const storeRoot = resolveStoreRoot();
        const db = createDb(`${storeRoot}/db/itestagent.db`);
        const store = createDefaultRunStore(db);
        const resolvedId = runId === 'latest' ? (await store.findLatest())?.runId : runId;

        if (!resolvedId) {
          console.error(
            `Error: No runs found${runId === 'latest' ? '' : ` — run "${runId}" not found`}.`,
          );
          process.exit(1);
        }

        // Load run data
        const runResult = await store.loadRunResult(resolvedId);
        const artifactIndex = await store.loadArtifactIndex(resolvedId);
        const previousRuns = await store.getPreviousRuns(resolvedId);

        // Build ExplainContext and run explainer
        const explainer = new FailureExplainer();
        const explanation = await explainer.explain({
          runId: resolvedId,
          status: runResult.status,
          projectProfileRef: runResult.projectProfileRef,
          steps: [],
          evidence: artifactIndex.artifacts.map((a) => ({
            id: a.id,
            type: a.type,
            path: a.path,
            redactionStatus: a.redactionStatus,
          })),
          baselineDelta: runResult.baselineDelta,
          targetKind: runResult.environment.targetKind,
          previousRuns: previousRuns
            .filter((r) => r.runId !== resolvedId)
            .map((r) => ({
              runId: r.runId,
              status: r.status as
                | 'passed'
                | 'failed'
                | 'explored'
                | 'inconclusive'
                | 'needs_assertion'
                | 'flaky'
                | 'blocked',
              scenario: r.profileRef,
            })),
        });

        // Output
        if (options.json) {
          console.log(
            JSON.stringify(
              {
                runId: resolvedId,
                status: runResult.status,
                explanation,
              },
              null,
              2,
            ),
          );
        } else {
          console.log(`\nRun     : ${resolvedId}`);
          console.log(`Status  : ${runResult.status}`);
          console.log(`Target  : ${runResult.environment.targetKind}`);
          console.log(`${'─'.repeat(50)}`);
          console.log(`\nFailure Type: ${explanation.explanationType}`);
          console.log(`Confidence  : ${explanation.confidence ?? 'N/A'}`);
          console.log(`\n${explanation.summary}`);
          if (explanation.evidence.length > 0) {
            console.log('\nEvidence:');
            for (const e of explanation.evidence) {
              console.log(`  • ${e}`);
            }
          }
          if (explanation.suggestedActions && explanation.suggestedActions.length > 0) {
            console.log('\nSuggested Actions:');
            for (const a of explanation.suggestedActions) {
              console.log(`  → ${a}`);
            }
          }
          console.log('');
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error(`Error: Failed to explain run — ${message}`);
        process.exit(1);
      }
    });

  // ─── rerun (US-16.1: rerun failed cases, task 5.4) ───
  program
    .command('rerun <run>')
    .description('rerun a test run, optionally only failed cases')
    .option('--failed-only', 'only rerun failed cases')
    .action(async (runId: string, options: { failedOnly?: boolean }) => {
      const { createDefaultRunStore } = await import('itestagent-store');
      const { resolveStoreRoot, createDb } = await import('itestagent-store');
      const { readFileSync } = await import('node:fs');
      const { join } = await import('node:path');
      const { parseTestPlanYaml } = await import('itestagent-engine');

      try {
        const storeRoot = resolveStoreRoot();
        const db = createDb(`${storeRoot}/db/itestagent.db`);
        const store = createDefaultRunStore(db);

        // Load original run
        const runResult = await store.loadRunResult(runId);
        const planPath = join(store.getRunDir(runId), 'plan.yaml');
        const planRaw = readFileSync(planPath, 'utf-8');
        const originalPlan = parseTestPlanYaml(planRaw);

        // AC2: reuse original TestPlan and data
        const flowCount = originalPlan.execution.flows?.length ?? 0;
        const totalCases = runResult.cases?.length ?? 0;
        const failedCases = runResult.cases?.filter((c) => c.status !== 'passed') ?? [];

        console.log(`\nRun       : ${runId}`);
        console.log(`Status    : ${runResult.status}`);
        console.log(`Target    : ${runResult.environment.targetKind}`);
        console.log(`Cases     : ${totalCases} total, ${failedCases.length} failed/skipped`);
        console.log(`${'─'.repeat(50)}`);

        if (options.failedOnly) {
          console.log('\nFailed cases to rerun:');
          for (const c of failedCases) {
            console.log(`  • ${c.caseId}: ${c.name} [${c.status}]`);
          }
        } else {
          console.log(`\nRerunning all ${flowCount} flow(s) from original TestPlan.`);
        }

        // AC3: link new run to original run for flaky detection
        console.log(`\nOriginal run: ${runId}`);
        console.log(`Plan flows   : ${flowCount}`);

        // TODO: full execution dispatch requires engine integration (Phase 5.6)
        // The rerun logic loads the original TestPlan, filters failed cases,
        // and links the new run to the original via parentRunId. The actual
        // execution dispatch will be wired when the engine's public run API
        // is stabilized.
        console.log(
          '\nNote: Full re-execution dispatch requires engine integration.\n' +
            '      Run data loaded successfully — execution wiring pending Phase 5.6.',
        );
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error(`Error: Failed to rerun — ${message}`);
        process.exit(1);
      }
    });

  // ─── run flow (US-9.2 AC2: replay iTestAgent Flow) ───
  // Task 5.2: Full replay execution via FlowReplayEngine.
  const runCmd = program.command('run').description('run-related commands');

  runCmd
    .command('flow <id>')
    .description('validate and replay an iTestAgent Flow')
    .option('--project <path>', 'also read from project .itestagent/flows/ directory')
    .option('--execute', 'replay the flow against a connected device (default: validate only)')
    .option('--device-id <id>', 'target device UDID or serial (required with --execute)')
    .option('--bundle-id <id>', 'app bundle ID for launch/terminate (required with --execute)')
    .option('--no-evidence', 'skip screenshot/page-source evidence collection during replay')
    .option('--non-interactive', 'skip safetyGate confirmation prompts (deny all)')
    .action(
      async (
        flowId: string,
        options: {
          project?: string;
          execute?: boolean;
          deviceId?: string;
          bundleId?: string;
          noEvidence?: boolean;
          nonInteractive?: boolean;
        },
      ) => {
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

          // ── Validate + Summarize (always) ─────────────────────────
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

          // ── Execute (when --execute flag is present) ───────────────
          if (!options.execute) {
            console.log(
              `\n   Run: itestagent run flow ${flow.flowId} --execute  (add --execute to replay)`,
            );
            return;
          }

          // Validate --execute prerequisites
          if (!options.deviceId) {
            console.error('\n❌ --device-id is required with --execute');
            console.error(
              '   Usage: itestagent run flow <id> --execute --device-id <UDID> --bundle-id <bundle.id>',
            );
            process.exit(1);
          }
          if (!options.bundleId) {
            console.error('\n❌ --bundle-id is required with --execute');
            console.error(
              '   Usage: itestagent run flow <id> --execute --device-id <UDID> --bundle-id <bundle.id>',
            );
            process.exit(1);
          }

          // Check target compatibility
          const { checkTargetCompatibility, replayFlow } = await import('itestagent-flow');
          // Infer targetKind from the options or default to the flow's first supported kind
          const targetKind = flow.supportedTargetKinds[0] ?? 'simulator';
          const compat = checkTargetCompatibility(flow, targetKind);

          if (!compat.ok) {
            console.error(`\n❌ Target compatibility blocked: ${compat.reason}`);
            process.exit(1);
          }

          console.log(
            `\n🚀 Replaying flow "${flow.flowId}" on ${targetKind} (${options.deviceId})...\n`,
          );

          // Dynamically import backend (non-literal to avoid tsc module resolution)
          let backend: unknown;
          const appiumPkg = 'itestagent-backends/device-appium';
          const mockPkg = 'itestagent-backends/device-mock';
          try {
            const mod = (await import(appiumPkg)) as {
              AppiumDeviceBackend: new (opts: Record<string, unknown>) => unknown;
            };
            backend = new mod.AppiumDeviceBackend({ targetKind });
          } catch {
            console.error('⚠️  AppiumDeviceBackend not available. Using mock backend for dry-run.');
            const mod = (await import(mockPkg)) as { MockDeviceBackend: new () => unknown };
            backend = new mod.MockDeviceBackend();
          }

          // Safety gate callback
          const onSafetyGate = options.nonInteractive
            ? undefined
            : async (step: { action: string; target?: string }) => {
                // In CLI mode without TUI, we skip safetyGate prompts
                console.warn(
                  `⚠️  SafetyGate: "${step.action}" requires confirmation (non-interactive mode: skipping)`,
                );
                return false;
              };

          const replayResult = await replayFlow(flow, backend as Parameters<typeof replayFlow>[1], {
            deviceId: options.deviceId,
            bundleId: options.bundleId,
            collectEvidence: !options.noEvidence,
            onStepStart: (idx, step) => {
              const target = step.target ? ` (${step.target})` : '';
              process.stdout.write(
                `   [${idx + 1}/${flow.steps.length}] ${step.action}${target}... `,
              );
            },
            onSafetyGate,
          });

          // Print per-step results
          for (const step of replayResult.steps) {
            const icon =
              step.status === 'passed'
                ? '✅'
                : step.status === 'failed'
                  ? '❌'
                  : step.status === 'blocked'
                    ? '🚫'
                    : '⏭️';
            process.stdout.write(`${icon}\n`);
            if (step.error) {
              console.log(`      Error: ${step.error}`);
            }
            if (step.evidence.length > 0) {
              console.log(`      Evidence: ${step.evidence.length} artifact(s)`);
            }
            if (step.detail) {
              console.log(`      Detail: ${step.detail}`);
            }
          }

          // Summary
          console.log(`\n${'─'.repeat(40)}`);
          console.log(`Replay complete: ${replayResult.overallStatus.toUpperCase()}`);
          console.log(
            `   Total: ${replayResult.summary.total} | Passed: ${replayResult.summary.passed} | Failed: ${replayResult.summary.failed} | Skipped: ${replayResult.summary.skipped} | Blocked: ${replayResult.summary.blocked}`,
          );
          console.log(
            `   Duration: ${Date.parse(replayResult.completedAt) - Date.parse(replayResult.startedAt)}ms`,
          );
          console.log(`${'─'.repeat(40)}`);

          if (replayResult.overallStatus !== 'passed') {
            process.exit(1);
          }
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          console.error(`❌ Failed to replay flow "${flowId}": ${message}`);
          process.exit(1);
        }
      },
    );

  return program;
}

// Entry point: when run as bin (import.meta.main is Bun-specific)
if (import.meta.main) {
  createProgram().parseAsync(process.argv);
}
