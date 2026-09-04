#!/usr/bin/env bun
import { createHash, randomUUID } from 'node:crypto';
import { readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { Command, InvalidArgumentError } from 'commander';
import { type RunResult, type TestPlan, isSafeRunId } from 'itestagent-contracts';
import {
  runConfigDefault,
  runConfigDeleteSecret,
  runConfigGetSecret,
  runConfigSetSecret,
  runConfigShow,
} from './commands/config.js';
import { confirmAction } from './config/confirm.js';
import { readHiddenSecret } from './config/hidden-secret-input.js';
import { loadConfig, resolveCredentials } from './config/loader.js';
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

/** Parse a replay port without accepting trailing characters such as `8200abc`. */
export function parseReplayPort(value: string): number {
  if (!/^\d+$/.test(value)) {
    throw new InvalidArgumentError('must be an integer between 1 and 65535');
  }
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new InvalidArgumentError('must be an integer between 1 and 65535');
  }
  return port;
}

/** Fail closed before secret prompting when no interactive terminal is available. */
export function assertInteractiveValueRefs(
  valueRefs: readonly string[],
  stdinIsTTY: boolean,
): void {
  if (valueRefs.length > 0 && !stdinIsTTY) {
    throw new PublicCliError(
      `A TTY is required to resolve in-memory value references: ${valueRefs.join(', ')}`,
    );
  }
}

interface ObservedPhysicalDevice {
  hardwareProperties?: { udid?: string };
  deviceProperties?: { name?: string; osVersionNumber?: string };
}

export function assertSafeRunId(runId: string): void {
  if (!isSafeRunId(runId)) {
    throw new PublicCliError(`Confirmed TestPlan runId is not a safe identifier: ${runId}`);
  }
}

function rerunPlansAreComparable(child: TestPlan, parent: TestPlan): boolean {
  const { runId: _childRunId, rerun: _childRerun, ...childSemantics } = child;
  const { runId: _parentRunId, rerun: _parentRerun, ...parentSemantics } = parent;
  return isDeepStrictEqual(childSemantics, parentSemantics);
}

function rerunResultsShareCase(child: RunResult, parent: RunResult): boolean {
  const childCases = new Set(child.cases.map((testCase) => testCase.caseId));
  return parent.cases.some((testCase) => childCases.has(testCase.caseId));
}

export function selectConfirmedPhysicalDevice(input: {
  cliUdid: string;
  selector?: { selector: 'local_connected' | 'by_udid' | 'by_name'; udid?: string; name?: string };
  observedDevices: readonly ObservedPhysicalDevice[];
}): ObservedPhysicalDevice {
  const selected = input.observedDevices.find(
    (device) => device.hardwareProperties?.udid === input.cliUdid,
  );
  if (!selected) {
    throw new PublicCliError(
      `Device ${input.cliUdid} does not match any connected physical device`,
    );
  }
  if (!input.selector) {
    throw new PublicCliError('Confirmed physical TestPlan has no device selector');
  }
  if (input.selector.selector === 'by_udid' && input.selector.udid !== input.cliUdid) {
    throw new PublicCliError(
      `Device ${input.cliUdid} does not match confirmed UDID ${input.selector.udid ?? '(missing)'}`,
    );
  }
  if (
    input.selector.selector === 'local_connected' &&
    (input.observedDevices.length !== 1 ||
      input.observedDevices[0]?.hardwareProperties?.udid !== input.cliUdid)
  ) {
    throw new PublicCliError(
      `Device ${input.cliUdid} does not uniquely match the confirmed local_connected selector`,
    );
  }
  if (input.selector.selector === 'by_name') {
    const matches = input.observedDevices.filter(
      (device) => device.deviceProperties?.name === input.selector?.name,
    );
    if (matches.length !== 1 || matches[0]?.hardwareProperties?.udid !== input.cliUdid) {
      throw new PublicCliError(
        `Device ${input.cliUdid} does not uniquely match confirmed name ${input.selector.name ?? '(missing)'}`,
      );
    }
  }
  return selected;
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
        const { cliDeviceDiscoveryProvider } = await import('./devices/discover.js');
        const { healthcheckAllDevices } = await import('./devices/healthcheck.js');
        const { formatDeviceList, formatDiscoveryLimitations, formatHealthcheckResults } =
          await import('./devices/format.js');

        // Discover devices based on flags
        const requestedLanes = options.simulatorOnly
          ? (['simulator'] as const)
          : options.physicalOnly
            ? (['physical'] as const)
            : (['physical', 'simulator'] as const);
        const visibleDiscovery = await cliDeviceDiscoveryProvider.discover({
          lanes: requestedLanes,
        });
        const devices = visibleDiscovery.devices;

        // Print device list
        console.log(formatDeviceList(devices));
        const limitations = formatDiscoveryLimitations(visibleDiscovery);
        if (limitations) console.error(limitations);

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
        console.log(`xcresult: ${resultBundle}`);
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

  // ─── explore (US-8.1: real-device exploration over the engine flow) ───
  program
    .command('explore')
    .description('run real-device exploration: launch AUT, interact, assert, persist evidence')
    .requiredOption('--plan <path>', 'confirmed TestPlan YAML')
    .requiredOption('--udid <udid>', 'device hardware UDID')
    .requiredOption('--bundle-id <id>', 'AUT bundle identifier')
    .option(
      '--platform-version <ver>',
      'iOS version (required for appium RemoteXPC matching, e.g. 18.2.1)',
    )
    .option('--goal <goal>', 'verification goal — enables LLM assertion suggestions (AC4)')
    .requiredOption('--wda-mode <mode>', 'WDA startup route: external-url | managed-xcodebuild')
    .option('--wda-url <url>', 'active WDA endpoint (required for external-url route)')
    .option('--xcode-org-id <id>', 'signing team ID (managed-xcodebuild route)')
    .option('--wda-bundle-id <id>', 'WDA base bundle id (free-account slot reuse)')
    .option('--appium-url <url>', 'Appium server URL', 'http://127.0.0.1:4723')
    .option(
      '--use-config-llm',
      'use model config (baseURL/model) + keychain key for LLM suggestions',
    )
    .action(
      async (options: {
        plan: string;
        udid: string;
        bundleId: string;
        platformVersion?: string;
        goal?: string;
        wdaMode: string;
        wdaUrl?: string;
        xcodeOrgId?: string;
        wdaBundleId?: string;
        appiumUrl: string;
        useConfigLlm?: boolean;
      }) => {
        const {
          runRealDeviceExploration,
          createBackendToolDispatcher,
          parseTestPlanYaml,
          persistRunBundle,
          suggestExplorationAction,
        } = await import('itestagent-engine');
        const { createDefaultRunStore, createStoreCore, initStore, resolveStoreRoot } =
          await import('itestagent-store');
        const { createAppiumExplorationRuntime } = await import('itestagent-engine');
        const { loadConfig, resolveCredentials } = await import('./config/loader.js');
        const confirmedPlan = parseTestPlanYaml(readFileSync(options.plan, 'utf-8'));
        if (confirmedPlan.execution.resolvedPath !== 'device_backend') {
          throw new PublicCliError(
            `Plan ${confirmedPlan.runId} resolved to ${confirmedPlan.execution.resolvedPath}; explore cannot change the confirmed route`,
          );
        }
        if (confirmedPlan.device.kind !== 'physical') {
          throw new PublicCliError(
            `Plan ${confirmedPlan.runId} targets ${confirmedPlan.device.kind}; this command currently requires a physical target`,
          );
        }
        if (confirmedPlan.execution.features.length === 0) {
          throw new PublicCliError('Confirmed TestPlan has no feature cases to explore');
        }

        if (!['external-url', 'managed-xcodebuild'].includes(options.wdaMode)) {
          throw new PublicCliError(
            `Unsupported WDA route "${options.wdaMode}"; expected external-url or managed-xcodebuild`,
          );
        }
        if (options.wdaMode === 'external-url' && !options.wdaUrl) {
          throw new PublicCliError(
            '--wda-url is required when --wda-mode external-url is selected',
          );
        }
        if (options.wdaMode === 'managed-xcodebuild' && options.wdaUrl) {
          throw new PublicCliError(
            '--wda-url is only valid when --wda-mode external-url is selected',
          );
        }

        // LLM suggestion config from the three-layer model config + keychain key
        let llm: { baseUrl: string; apiKey: string; model: string; goal: string } | undefined;
        if (options.useConfigLlm) {
          const { config: merged } = await loadConfig();
          const { resolvedApiKey } = await resolveCredentials(merged);
          if (merged.model.baseURL && resolvedApiKey && merged.model.model) {
            llm = {
              baseUrl: merged.model.baseURL,
              apiKey: resolvedApiKey,
              model: merged.model.model,
              goal: options.goal ?? confirmedPlan.execution.features.join(', '),
            };
          } else {
            console.error(
              'LLM suggestions skipped: config.model.baseURL/model or keychain key missing',
            );
          }
        }

        // Resolve the confirmed physical selector against observed devices. The CLI
        // flag identifies a candidate but cannot override the confirmed TestPlan.
        const probeJson = join(tmpdir(), `itestagent-explore-device-${Date.now()}.json`);
        let observedDevices: Array<{
          hardwareProperties?: { udid?: string };
          deviceProperties?: { name?: string; osVersionNumber?: string };
        }> = [];
        try {
          const probe = Bun.spawnSync([
            'xcrun',
            'devicectl',
            'list',
            'devices',
            '--json-output',
            probeJson,
          ]);
          if (probe.exitCode !== 0) {
            throw new PublicCliError('Unable to resolve the confirmed device via devicectl');
          }
          const list = JSON.parse(readFileSync(probeJson, 'utf-8')) as {
            result?: { devices?: typeof observedDevices };
            devices?: typeof observedDevices;
          };
          observedDevices = list.result?.devices ?? list.devices ?? [];
        } finally {
          try {
            rmSync(probeJson, { force: true });
          } catch {
            // Best-effort temp cleanup
          }
        }
        const selectedDevice = selectConfirmedPhysicalDevice({
          cliUdid: options.udid,
          selector: confirmedPlan.device.physical,
          observedDevices,
        });

        // G5 finding: Appium RemoteXPC matching on iOS 17+ requires platformVersion.
        const platformVersion =
          options.platformVersion ?? selectedDevice.deviceProperties?.osVersionNumber;
        if (!platformVersion) {
          throw new PublicCliError(
            `Device ${options.udid} has no observable platformVersion required for Appium`,
          );
        }

        if (!llm) {
          throw new PublicCliError(
            'Dynamic exploration requires --use-config-llm with a configured model and keychain API key',
          );
        }

        const runtime = createAppiumExplorationRuntime(
          {
            udid: options.udid,
            bundleId: options.bundleId,
            platformVersion,
            ...(options.platformVersion ? { platformVersion: options.platformVersion } : {}),
            wdaStartupMode: options.wdaMode as 'external-url' | 'managed-xcodebuild',
            ...(options.wdaUrl ? { webDriverAgentUrl: options.wdaUrl } : {}),
            ...(options.xcodeOrgId ? { xcodeOrgId: options.xcodeOrgId } : {}),
            ...(options.wdaBundleId ? { wdaBundleId: options.wdaBundleId } : {}),
            appiumServerUrl: options.appiumUrl,
          },
          llm,
        );
        const explorationGenerator = runtime.llmSuggest?.generate;
        if (!explorationGenerator) {
          throw new PublicCliError('Dynamic exploration model generator is unavailable');
        }

        const runId = confirmedPlan.runId;
        assertSafeRunId(runId);
        let lastAssertionStatus: string | undefined;
        const storeRoot = initStore(resolveStoreRoot());
        const storeCore = createStoreCore(join(storeRoot, 'db', 'itestagent.db'));
        await storeCore.driver.migrate();
        const store = createDefaultRunStore(storeCore.db);
        const finalRunDir = store.getRunDir(runId);
        const runDir = join(finalRunDir, 'staging');
        // CodeRabbit r3: cleanup must run even when exploration rejects —
        // a leaked Appium session or iproxy tunnel blocks the next run.
        try {
          const result = await runRealDeviceExploration({
            backend: runtime.backend,
            toolDispatcher: createBackendToolDispatcher(runtime.backend),
            runDir,
            runId,
            bundleId: options.bundleId,
            deviceId: options.udid,
            targetKind: 'physical',
            dynamicActions: {
              cases: confirmedPlan.execution.features,
              suggest: ({ caseId, uiTree, history }) =>
                suggestExplorationAction({
                  generate: explorationGenerator,
                  caseId,
                  uiTree,
                  history,
                }),
            },
            ...(runtime.llmSuggest ? { llmSuggest: runtime.llmSuggest } : {}),
          });

          const endedAt = new Date().toISOString();
          const startedAt = result.steps[0]?.startedAt ?? endedAt;
          const caseIds = [
            ...new Set([
              ...confirmedPlan.execution.features,
              ...result.assertion.cases.map((testCase) => testCase.caseId),
              ...result.steps.flatMap((step) => (step.caseId ? [step.caseId] : [])),
            ]),
          ];
          const cases = caseIds.map((caseId) => {
            const caseSteps = result.steps.filter((step) => step.caseId === caseId);
            const assertionCase = result.assertion.cases.find(
              (testCase) => testCase.caseId === caseId,
            );
            return {
              caseId,
              name: caseId,
              status:
                assertionCase?.status ??
                (caseSteps.some((step) => step.status === 'failed')
                  ? ('failed' as const)
                  : ('explored' as const)),
              steps: caseSteps.map((step) => step.stepId),
              durationMs: caseSteps.reduce((total, step) => total + step.durationMs, 0),
              artifacts: [...new Set(caseSteps.flatMap((step) => step.artifacts))],
            };
          });
          const collectedTypes = new Set(result.artifacts.map((artifact) => artifact.type));
          const collectionOutcomes = [
            ...result.artifacts.map((artifact) => ({
              type: artifact.type,
              status: 'collected' as const,
              reasonCode: 'collected',
              artifactId: artifact.id,
              relatedStep: artifact.relatedStep,
              relatedCase: artifact.relatedCase,
            })),
            ...confirmedPlan.artifacts.collect
              .filter((type) => !collectedTypes.has(type))
              .map((type) => ({
                type,
                status:
                  type === 'xcresult' ? ('not_applicable' as const) : ('unsupported' as const),
                reasonCode:
                  type === 'xcresult' ? 'device_backend_route' : 'backend_did_not_collect',
              })),
          ];
          await persistRunBundle({
            store,
            plan: confirmedPlan,
            artifactSourceRoot: runDir,
            report: {
              runId,
              status: result.assertion.status,
              projectProfileRef: confirmedPlan.projectProfileRef,
              device: {
                udid: options.udid,
                name: selectedDevice.deviceProperties?.name ?? options.udid,
                model: 'unknown',
                osVersion: platformVersion,
                targetKind: 'physical',
              },
              execution: {
                mode: 'device_backend',
                totalSteps: result.steps.length,
                completedSteps: result.steps.filter((step) => step.status === 'completed').length,
                failedSteps: result.steps.filter((step) => step.status === 'failed').length,
                skippedSteps: 0,
                durationMs: Math.max(0, Date.parse(endedAt) - Date.parse(startedAt)),
                startTime: startedAt,
                endTime: endedAt,
                targetKind: 'physical',
                backendUsed: 'appium',
                deviceId: options.udid,
              },
              cases,
              metrics: {},
              environment: {
                targetKind: 'physical',
                representativeOfPhysicalDevice: true,
                comparisonScope: 'physical_only',
              },
              artifactRefs: result.artifacts.map((artifact) => artifact.id),
              allArtifacts: result.artifacts.map((artifact) => ({
                ...artifact,
                path: artifact.path,
              })),
              collectionOutcomes,
              steps: [...result.steps],
            },
          });
          rmSync(runDir, { recursive: true, force: true });

          console.log(`run: ${runId} | dir: ${finalRunDir}`);
          lastAssertionStatus = result.assertion.status;
          console.log(`assertion: ${result.assertion.status} — ${result.assertion.summary}`);
          for (const s of result.assertion.suggestions ?? []) {
            console.log(
              `  suggestion [${s.source}] ${s.label ?? s.caseId}: ${s.evidence?.join('; ') ?? ''}`,
            );
          }
          if (result.llmSuggestions !== undefined) {
            console.log(
              `llmSuggestions: ${result.llmSuggestions.length}${result.llmReason ? ` (${result.llmReason})` : ''}`,
            );
          }
          for (const s of result.steps) {
            console.log(`  step [${s.action}] ${s.target ?? ''}`);
          }
          console.log(
            `artifacts: ${result.artifactCount} | index: ${result.artifactIndexPath ?? 'n/a'}`,
          );
        } finally {
          await runtime.close();
        }
        if (lastAssertionStatus === 'failed') {
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
      const { resolveStoreRoot, createStoreCore } = await import('itestagent-store');

      try {
        const storeRoot = resolveStoreRoot();
        const core = createStoreCore(`${storeRoot}/db/itestagent.db`);
        await core.driver.migrate();
        const store = createDefaultRunStore(core.db);
        const bundle =
          runId === 'latest'
            ? await store.findLatestValidBundle()
            : await store.loadRunBundle(runId);
        if (!bundle) {
          console.error(
            `Error: No runs found${runId === 'latest' ? '' : ` — run "${runId}" not found`}.`,
          );
          process.exit(1);
        }
        const runResult = bundle.result;
        const resolvedId = runResult.runId;
        let previousRuns: Array<{
          runId: string;
          status: typeof runResult.status;
          scenario: string;
          comparable: boolean;
        }> = [];
        if (runResult.parentRunId && bundle.plan.schemaVersion === 'itestagent.test-plan.v3') {
          try {
            const parent = await store.loadRunBundle(runResult.parentRunId);
            const plansComparable =
              parent.plan.schemaVersion === 'itestagent.test-plan.v3' &&
              rerunPlansAreComparable(bundle.plan, parent.plan);
            previousRuns = [
              {
                runId: parent.result.runId,
                status: parent.result.status,
                scenario: parent.result.cases.map((testCase) => testCase.caseId).join(','),
                comparable:
                  plansComparable &&
                  parent.result.projectProfileRef === runResult.projectProfileRef &&
                  parent.result.environment.targetKind === runResult.environment.targetKind &&
                  rerunResultsShareCase(runResult, parent.result),
              },
            ];
          } catch {
            previousRuns = [];
          }
        }
        const explanation =
          runResult.explanation ??
          (await new FailureExplainer().explain({
            runId: resolvedId,
            status: runResult.status,
            projectProfileRef: runResult.projectProfileRef,
            steps: bundle.steps.steps,
            evidence: bundle.artifactIndex.artifacts,
            collectionOutcomes: bundle.artifactIndex.collectionOutcomes,
            baselineDelta: runResult.baselineDelta,
            targetKind: runResult.environment.targetKind,
            previousRuns,
          }));

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
    .description('rerun XCUITest cases using authoritative test identifiers')
    .option('--failed-only', 'only rerun failed cases')
    .action(
      async (
        runId: string,
        options: {
          failedOnly?: boolean;
        },
      ) => {
        const { createDefaultRunStore, resolveStoreRoot, createStoreCore } = await import(
          'itestagent-store'
        );
        const {
          PermissionEngine,
          createProductionAgentSessionDependencies,
          createRerunPlan,
          executeProductionTestPlan,
          loadProductionPlanContext,
          selectPlanDevice,
        } = await import('itestagent-engine');
        try {
          const storeRoot = resolveStoreRoot();
          const core = createStoreCore(`${storeRoot}/db/itestagent.db`);
          await core.driver.migrate();
          const store = createDefaultRunStore(core.db);
          const parent = await store.loadRunBundle(runId);
          if (parent.plan.schemaVersion !== 'itestagent.test-plan.v3') {
            throw new PublicCliError(
              'Flow replay bundles cannot be rerun as TestPlans; use `itestagent run flow <flowId>`.',
            );
          }
          const childPlan = createRerunPlan({
            parentPlan: parent.plan,
            parentResult: parent.result,
            mode: options.failedOnly ? 'failed_only' : 'all',
          });
          const { workspace, bundleId } = loadProductionPlanContext(
            childPlan,
            storeRoot,
            process.cwd(),
          );
          const production = createProductionAgentSessionDependencies();
          const discovered = await production.deviceDiscovery.discover();
          const device = selectPlanDevice(childPlan, discovered.devices);
          const permissionEngine = new PermissionEngine();
          const authorize = async (action: string, resource: string): Promise<boolean> => {
            const gate = permissionEngine.check(action, resource);
            if (gate === 'allow') return true;
            if (gate === 'deny') return false;
            const callId = `rerun-${randomUUID()}`;
            const pending = permissionEngine.requestPermission(callId, action, resource);
            const answer = await confirmAction({ action, details: resource });
            permissionEngine.resolve(callId, answer === 'yes' ? 'allow' : 'deny', false);
            return (await pending).effect === 'allow';
          };

          const executed = await executeProductionTestPlan({
            plan: childPlan,
            parentResult: parent.result,
            workspace,
            device,
            bundleId,
            store,
            storeRoot,
            suggest: async () => {
              throw new PublicCliError('XCUITest rerun does not use model-driven exploration.');
            },
            authorize,
            production,
          });
          const child = await store.loadRunBundle(childPlan.runId);
          console.log(`\nRerun    : ${childPlan.runId}`);
          console.log(`Parent   : ${runId}`);
          console.log(`Cases    : ${childPlan.rerun?.selectedCaseIds.join(', ')}`);
          console.log(`Status   : ${child.result.status}`);
          console.log(`Run dir  : ${executed.runDir}`);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          console.error(`Error: Failed to rerun — ${message}`);
          process.exit(1);
        }
      },
    );

  // ─── run flow (US-9.2 AC2: replay iTestAgent Flow) ───
  // Task 5.2: Full replay execution via FlowReplayEngine.
  const runCmd = program.command('run').description('run-related commands');

  runCmd
    .command('flow <id>')
    .description('replay an iTestAgent Flow on an explicit production target')
    .option('--project <path>', 'prefer project .itestagent/flows/, then fall back to global')
    .option(
      '--validate-only',
      'validate schema, status, capabilities, and required target kind without touching a device',
    )
    .option('--target-kind <kind>', 'explicit target kind: physical or simulator')
    .option('--device-id <id>', 'target device UDID (required for replay)')
    .option('--bundle-id <id>', 'app bundle ID for launch/terminate')
    .option('--backend <name>', 'explicit production backend', 'appium')
    .option('--platform-version <version>', 'selected device iOS version')
    .option('--appium-url <url>', 'Appium server URL')
    .option('--wda-mode <mode>', 'physical WDA route: external-url or managed-xcodebuild')
    .option('--wda-url <url>', 'Route B WebDriverAgent URL')
    .option('--wda-bundle-id <id>', 'WDA base bundle identifier')
    .option('--wda-project-path <path>', 'Route C WebDriverAgent.xcodeproj path')
    .option('--wda-local-port <port>', 'local WDA port', parseReplayPort)
    .option('--mjpeg-server-port <port>', 'local MJPEG port', parseReplayPort)
    .option('--xcode-org-id <id>', 'Route C signing team ID')
    .option('--xcode-signing-id <id>', 'Route C signing identity')
    .option('--no-evidence', 'skip screenshot/page-source evidence collection during replay')
    .option('--non-interactive', 'deny draft and safety confirmations')
    .action(
      async (
        flowId: string,
        options: {
          project?: string;
          validateOnly?: boolean;
          targetKind?: string;
          deviceId?: string;
          bundleId?: string;
          backend?: string;
          platformVersion?: string;
          appiumUrl?: string;
          wdaMode?: string;
          wdaUrl?: string;
          wdaBundleId?: string;
          wdaProjectPath?: string;
          wdaLocalPort?: number;
          mjpegServerPort?: number;
          xcodeOrgId?: string;
          xcodeSigningId?: string;
          evidence?: boolean;
          nonInteractive?: boolean;
        },
      ) => {
        try {
          const {
            CANONICAL_DEVICE_CAPABILITIES,
            loadProductionFlow,
            persistRunBundle,
            runProductionFlowReplay,
          } = await import('itestagent-engine');
          const { createDefaultRunStore, createStoreCore, initStore, resolveStoreRoot } =
            await import('itestagent-store');
          const loaded = await loadProductionFlow(flowId, { projectPath: options.project });
          const flow = loaded.flow;
          if (options.targetKind !== 'physical' && options.targetKind !== 'simulator') {
            throw new PublicCliError(
              '--target-kind is required and must be either physical or simulator.',
            );
          }
          const targetKind: 'physical' | 'simulator' = options.targetKind;
          if (!flow.supportedTargetKinds.includes(targetKind)) {
            throw new PublicCliError(
              `Flow "${flow.flowId}" does not support targetKind "${targetKind}". Supported: ${flow.supportedTargetKinds.join(', ')}`,
            );
          }
          const unknownCapabilities = flow.requiredCapabilities.filter(
            (capability) => !CANONICAL_DEVICE_CAPABILITIES.has(capability),
          );
          if (unknownCapabilities.length > 0) {
            throw new PublicCliError(
              `Flow requires unsupported capabilities: ${unknownCapabilities.join(', ')}`,
            );
          }
          if (flow.status === 'deprecated') {
            throw new PublicCliError(`Flow "${flow.flowId}" is deprecated and cannot be replayed.`);
          }

          // ── Validate + Summarize (always) ─────────────────────────
          console.log(`✅ Flow "${flow.flowId}" — valid iTestAgent Flow v2`);
          console.log(`   Location:   ${loaded.source} (${loaded.path})`);
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

          if (options.validateOnly) {
            console.log('\n✅ Validation-only complete; no backend or device session was started.');
            return;
          }

          if (!options.deviceId) {
            throw new PublicCliError('--device-id is required for production Flow replay.');
          }
          const needsBundleId = flow.steps.some(
            (step) =>
              (step.action === 'launchApp' || step.action === 'terminateApp') &&
              typeof step.value !== 'string',
          );
          if (needsBundleId && !options.bundleId) {
            throw new PublicCliError(
              '--bundle-id is required because a lifecycle step has no inline bundle ID.',
            );
          }

          let draftConfirmed = flow.status === 'confirmed';
          if (flow.status === 'draft') {
            if (options.nonInteractive) {
              throw new PublicCliError('Draft Flow replay is blocked in non-interactive mode.');
            }
            draftConfirmed =
              (await confirmAction({
                action: 'Replay draft Flow',
                details: `Replay draft Flow "${flow.flowId}" once on ${targetKind}/${options.deviceId}. The Flow file will not be modified.`,
              })) === 'yes';
            if (!draftConfirmed) {
              throw new PublicCliError('Draft Flow replay was not confirmed.');
            }
          }

          const valueRefs = [
            ...new Set(
              flow.steps
                .map((step) => step.valueRef)
                .filter((reference): reference is string => reference !== undefined),
            ),
          ];
          if (options.nonInteractive && valueRefs.length > 0) {
            throw new PublicCliError(
              `Non-interactive replay cannot resolve in-memory value references: ${valueRefs.join(', ')}`,
            );
          }
          const runtimeValues = new Map<string, string>();
          assertInteractiveValueRefs(valueRefs, process.stdin.isTTY === true);
          for (const reference of valueRefs) {
            const value = await readHiddenSecret({
              prompt: `Value for ${reference} (input hidden): `,
            });
            if (!value) {
              throw new PublicCliError(`No runtime value was provided for ${reference}.`);
            }
            runtimeValues.set(reference, value);
          }

          console.log(
            `\n🚀 Replaying flow "${flow.flowId}" on ${targetKind} (${options.deviceId})...\n`,
          );

          const runId = `replay-${Date.now()}-${randomUUID()}`;
          const storeRoot = initStore(resolveStoreRoot());
          const storeCore = createStoreCore(join(storeRoot, 'db', 'itestagent.db'));
          await storeCore.driver.migrate();
          const store = createDefaultRunStore(storeCore.db);
          const evidenceDirectory = join(store.getRunDir(runId), 'staging');

          const onSafetyGate = options.nonInteractive
            ? undefined
            : async (step: { action: string; target?: string }) => {
                return (
                  (await confirmAction({
                    action: `Replay safety-gated step: ${step.action}`,
                    details: `Target: ${step.target ?? '(none)'}`,
                  })) === 'yes'
                );
              };

          if (
            options.wdaMode !== undefined &&
            options.wdaMode !== 'external-url' &&
            options.wdaMode !== 'managed-xcodebuild'
          ) {
            throw new PublicCliError('--wda-mode must be external-url or managed-xcodebuild.');
          }
          for (const [flag, port] of [
            ['--wda-local-port', options.wdaLocalPort],
            ['--mjpeg-server-port', options.mjpegServerPort],
          ] as const) {
            if (port !== undefined && (!Number.isInteger(port) || port < 1 || port > 65_535)) {
              throw new PublicCliError(`${flag} must be an integer between 1 and 65535.`);
            }
          }

          const execution = await runProductionFlowReplay({
            flow,
            targetKind,
            deviceId: options.deviceId,
            bundleId: options.bundleId,
            preferredBackend: options.backend,
            draftConfirmed,
            appium: {
              appiumServerUrl: options.appiumUrl,
              platformVersion: options.platformVersion,
              wdaStartupMode: options.wdaMode,
              webDriverAgentUrl: options.wdaUrl,
              wdaBaseBundleId: options.wdaBundleId,
              wdaProjectPath: options.wdaProjectPath,
              wdaLocalPort: options.wdaLocalPort,
              mjpegServerPort: options.mjpegServerPort,
              xcodeOrgId: options.xcodeOrgId,
              xcodeSigningId: options.xcodeSigningId,
            },
            replay: {
              runId,
              evidenceDirectory,
              collectEvidence: options.evidence !== false,
              onStepStart: (idx, step) => {
                const target = step.target ? ` (${step.target})` : '';
                process.stdout.write(
                  `   [${idx + 1}/${flow.steps.length}] ${step.action}${target}... `,
                );
              },
              onSafetyGate,
              resolveValueRef: async (reference) => runtimeValues.get(reference),
            },
          });
          const executionFailure = execution.success ? undefined : execution;
          const replayResult = execution.replay;
          const actualSteps = (replayResult?.steps ?? [])
            .filter((step) => step.status !== 'skipped' && step.startedAt !== undefined)
            .map((step, index) => ({
              stepId: step.stepId,
              sequence: index + 1,
              backend: execution.backend ?? options.backend ?? 'unavailable',
              targetKind,
              caseId: step.caseId,
              action: step.action,
              target: step.target,
              input: { flowStepIndex: step.stepIndex },
              result: { status: step.status, error: step.error, detail: step.detail },
              status:
                step.status === 'passed'
                  ? ('completed' as const)
                  : step.status === 'failed'
                    ? ('failed' as const)
                    : ('blocked' as const),
              artifacts: step.evidence.map((artifact) => artifact.id),
              startedAt: step.startedAt as string,
              durationMs: step.durationMs,
            }));
          const persistedStepIds = new Set(actualSteps.map((step) => step.stepId));
          const artifactMap = new Map(
            (replayResult?.steps ?? [])
              .flatMap((step) => step.evidence)
              .map((artifact) => [artifact.id, artifact]),
          );
          const allArtifacts = [...artifactMap.values()];
          const outcomeStatus = {
            success: 'collected',
            not_requested: 'not_requested',
            not_applicable: 'not_applicable',
            unsupported: 'unsupported',
            failed: 'failed',
          } as const;
          const collectionOutcomes = (replayResult?.steps ?? []).flatMap((step) =>
            step.evidenceOutcomes.flatMap((outcome) =>
              outcome.type === 'checkpoint'
                ? []
                : [
                    {
                      type: outcome.type,
                      status: outcomeStatus[outcome.status],
                      reasonCode: `flow_replay.${outcome.status}`,
                      message: outcome.error,
                      artifactId: outcome.artifact?.id,
                      relatedStep: persistedStepIds.has(step.stepId) ? step.stepId : undefined,
                      relatedCase: step.caseId,
                    },
                  ],
            ),
          );
          const requestedArtifactTypes = [
            ...new Set([
              ...allArtifacts.map((artifact) => artifact.type),
              ...collectionOutcomes.map((outcome) => outcome.type),
            ]),
          ].filter(
            (
              type,
            ): type is
              | 'screenshot'
              | 'video'
              | 'syslog'
              | 'crashlog'
              | 'xcresult'
              | 'trace'
              | 'uitree' =>
              ['screenshot', 'video', 'syslog', 'crashlog', 'xcresult', 'trace', 'uitree'].includes(
                type,
              ),
          );
          const plan = {
            schemaVersion: 'itestagent.flow-replay-plan.v1' as const,
            runId,
            flow: {
              flowId: flow.flowId,
              source: loaded.source,
              sourcePath: loaded.path,
              sha256: createHash('sha256').update(readFileSync(loaded.path)).digest('hex'),
            },
            target: { targetKind, deviceId: options.deviceId },
            selection: execution.backend
              ? {
                  status: 'selected' as const,
                  backend: execution.backend,
                  reasonCode: 'backend.selected',
                }
              : {
                  status: 'failed' as const,
                  reasonCode: executionFailure?.reasonCode ?? 'backend.selection_unknown',
                  message: executionFailure?.reason,
                },
            readiness: replayResult
              ? { status: 'ready' as const, reasonCode: 'backend.readiness_passed' }
              : execution.backend
                ? {
                    status: 'failed' as const,
                    reasonCode: executionFailure?.reasonCode ?? 'backend.readiness_unknown',
                    message: executionFailure?.reason,
                  }
                : {
                    status: 'not_reached' as const,
                    reasonCode: executionFailure?.reasonCode ?? 'backend.not_reached',
                    message: executionFailure?.reason,
                  },
            artifacts: {
              collect: requestedArtifactTypes,
              report: {
                outputs: ['summary_md', 'result_json', 'artifact_index_json'] as Array<
                  'summary_md' | 'result_json' | 'artifact_index_json'
                >,
              },
            },
          };
          const startedAt = replayResult?.startedAt ?? new Date().toISOString();
          const completedAt = replayResult?.completedAt ?? startedAt;
          const caseIds = [
            ...new Set(actualSteps.flatMap((step) => (step.caseId ? [step.caseId] : []))),
          ];
          const cases = caseIds.map((caseId) => {
            const steps = actualSteps.filter((step) => step.caseId === caseId);
            const status = steps.some((step) => step.status === 'failed')
              ? ('failed' as const)
              : steps.some((step) => step.status === 'blocked')
                ? ('blocked' as const)
                : ('passed' as const);
            return {
              caseId,
              name: caseId,
              status,
              steps: steps.map((step) => step.stepId),
              durationMs: steps.reduce((total, step) => total + step.durationMs, 0),
              artifacts: [...new Set(steps.flatMap((step) => step.artifacts))],
            };
          });
          const status = replayResult
            ? replayResult.cancelled
              ? ('cancelled' as const)
              : replayResult.overallStatus
            : executionFailure?.status === 'blocked'
              ? ('blocked' as const)
              : ('infra_failed' as const);
          await persistRunBundle({
            store,
            plan,
            artifactSourceRoot: evidenceDirectory,
            report: {
              runId,
              status,
              device: {
                udid: options.deviceId,
                name: options.deviceId,
                model: 'unavailable',
                osVersion: options.platformVersion ?? 'unavailable',
                targetKind,
              },
              execution: {
                mode: 'device_backend',
                totalSteps: actualSteps.length,
                completedSteps: actualSteps.filter((step) => step.status === 'completed').length,
                failedSteps: actualSteps.filter((step) => step.status === 'failed').length,
                skippedSteps: replayResult?.summary.skipped ?? 0,
                durationMs: Math.max(0, Date.parse(completedAt) - Date.parse(startedAt)),
                startTime: startedAt,
                endTime: completedAt,
                targetKind,
                backendUsed: execution.backend ?? 'unavailable',
                deviceId: options.deviceId,
              },
              cases,
              metrics: {},
              environment: {
                targetKind,
                representativeOfPhysicalDevice: targetKind === 'physical',
                comparisonScope: targetKind === 'physical' ? 'physical_only' : 'simulator_only',
              },
              artifactRefs: allArtifacts.map((artifact) => artifact.id),
              allArtifacts,
              collectionOutcomes,
              steps: actualSteps,
              ...(!execution.success
                ? {
                    explanation: {
                      explanationType: 'env_issue' as const,
                      summary:
                        executionFailure?.reason ?? 'Production replay failed without details.',
                      evidence: [],
                      suggestedActions: executionFailure?.remediation ?? [],
                      confidence: 'high' as const,
                    },
                  }
                : {}),
            },
          });
          rmSync(evidenceDirectory, { recursive: true, force: true });
          const executionFailed = !execution.success;
          if (executionFailed) {
            console.error(`❌ ${execution.status}: ${execution.reasonCode}: ${execution.reason}`);
            for (const remediation of execution.remediation) {
              console.error(`   Remediation: ${remediation}`);
            }
            if (!execution.replay) process.exit(1);
          }
          if (!replayResult) {
            throw new PublicCliError('Production replay returned no replay facts.');
          }

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

          if (executionFailed || replayResult.overallStatus !== 'passed') {
            process.exit(1);
          }
        } catch (error) {
          handleCommandError(error);
        }
      },
    );

  return program;
}

// Entry point: when run as bin (import.meta.main is Bun-specific)
if (import.meta.main) {
  createProgram().parseAsync(process.argv);
}
