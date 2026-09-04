import { afterEach, describe, expect, mock, test } from 'bun:test';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import * as aiReal from 'ai';
import { overrideSpawnSync } from 'itestagent-backends-analyzer-xcodeproj';
import type { DeviceDiscoveryRuntime } from 'itestagent-backends-device-appium';
import type { DeviceBackend, DeviceInfo, TestPlan } from 'itestagent-contracts';
import { TestPlanSchema } from 'itestagent-contracts';
import {
  createProductionAgentSessionDependencies,
  executeProductionTestPlan,
} from 'itestagent-engine';
import type { CandidateLink } from 'itestagent-project-analyzer';
import { createRunStore, createStoreCore, initStore } from 'itestagent-store';
import { runExplainCommand } from '../../../packages/itestagent-cli/src/commands/explain.js';
import { runRerunCommand } from '../../../packages/itestagent-cli/src/commands/rerun.js';

interface SdkTool {
  execute(args: unknown, options: { toolCallId: string }): Promise<unknown>;
}

let capturedTools: Record<string, SdkTool> = {};
mock.module('ai', () => ({
  ...aiReal,
  streamText: (input: { tools: Record<string, SdkTool> }) => {
    capturedTools = input.tools;
    return { fullStream: (async function* () {})() };
  },
  stepCountIs: (count: number) => ({ count }),
  tool: (definition: Record<string, unknown>) => definition,
}));

const roots: string[] = [];
const originalHome = process.env.ITESTAGENT_HOME;

afterEach(async () => {
  capturedTools = {};
  overrideSpawnSync(undefined);
  // biome-ignore lint/performance/noDelete: deleting restores the actual absence of an environment variable.
  if (originalHome === undefined) delete process.env.ITESTAGENT_HOME;
  else process.env.ITESTAGENT_HOME = originalHome;
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

async function setup(prefix: string) {
  const root = await mkdtemp(join(tmpdir(), prefix));
  roots.push(root);
  initStore(root);
  const core = createStoreCore(join(root, 'db', 'itestagent.db'));
  await core.driver.migrate();
  return { root, store: createRunStore(core.db, root) };
}

function createAnalyzerWorkspace(root: string, hasXcuitest: boolean): string {
  const workspace = join(root, 'workspace');
  const project = join(workspace, 'Demo.xcodeproj');
  const schemes = join(project, 'xcshareddata', 'xcschemes');
  mkdirSync(schemes, { recursive: true });
  const pbxproj = readFileSync(
    resolve(
      import.meta.dir,
      '../../../packages/itestagent-backends/analyzer-xcodeproj/test/fixtures/project.pbxproj',
    ),
    'utf8',
  );
  writeFileSync(join(project, 'project.pbxproj'), pbxproj);
  writeFileSync(
    join(schemes, 'Demo.xcscheme'),
    hasXcuitest
      ? '<Scheme><TestAction><TestPlans><TestPlanReference reference="container:Smoke.xctestplan" default="YES" /></TestPlans><Testables><TestableReference><BuildableReference BlueprintName="MyAppUITests" /></TestableReference></Testables></TestAction></Scheme>'
      : '<Scheme><TestAction><Testables /></TestAction></Scheme>',
  );
  writeFileSync(
    join(workspace, 'LoginViewController.swift'),
    'final class LoginViewController: UIViewController {}',
  );
  overrideSpawnSync((_cmd, args) => {
    if (args.includes('-list') && args.includes('-json')) {
      return {
        exitCode: 0,
        stdout: JSON.stringify({
          project: {
            name: 'Demo',
            schemes: ['Demo'],
            configurations: ['Debug', 'Release'],
            targets: ['MyApp', 'MyAppTests', 'MyAppUITests'],
          },
        }),
        stderr: '',
      };
    }
    if (args.includes('-showBuildSettings')) {
      return {
        exitCode: 0,
        stdout:
          'PRODUCT_BUNDLE_IDENTIFIER = com.example.Demo\nPRODUCT_NAME = Demo\nIPHONEOS_DEPLOYMENT_TARGET = 16.0\nSWIFT_VERSION = 5.0\nARCHS = arm64',
        stderr: '',
      };
    }
    return { exitCode: 1, stdout: '', stderr: `unexpected analyzer command: ${args.join(' ')}` };
  });
  return workspace;
}

function createDiscoveryRuntime(
  root: string,
  options: { physical?: DeviceInfo; simulator?: DeviceInfo },
): DeviceDiscoveryRuntime {
  let sequence = 0;
  return {
    async run(command) {
      if (command.includes('devicectl')) {
        const outputPath = command.at(-1);
        if (!outputPath) throw new Error('devicectl output path is missing');
        const entry = options.physical
          ? [
              {
                connectionProperties: { pairingState: 'paired' },
                hardwareProperties: {
                  udid: options.physical.udid,
                  productType: options.physical.model,
                },
                deviceProperties: {
                  name: options.physical.name,
                  osVersionNumber: options.physical.osVersion,
                },
              },
            ]
          : [];
        writeFileSync(outputPath, JSON.stringify({ result: { devices: entry } }));
        return { exitCode: 0, stdout: '', stderr: '' };
      }
      if (command.includes('simctl')) {
        const devices = options.simulator
          ? [
              {
                udid: options.simulator.udid,
                name: options.simulator.name,
                deviceTypeIdentifier: options.simulator.model,
                state: 'Booted',
                isAvailable: true,
              },
            ]
          : [];
        return {
          exitCode: 0,
          stdout: JSON.stringify({
            devices: { 'com.apple.CoreSimulator.SimRuntime.iOS-18-0': devices },
          }),
          stderr: '',
        };
      }
      return { exitCode: 1, stdout: '', stderr: `unexpected command: ${command.join(' ')}` };
    },
    createTempJsonPath: () => join(root, `device-inventory-${sequence++}.json`),
    exists: existsSync,
    readText: (path) => readFileSync(path, 'utf8'),
    remove: (path) => rmSync(path, { force: true }),
  };
}

function confirmedCandidates(
  patches: readonly { type: string; payload: Record<string, unknown> }[],
) {
  const candidates = patches.find((patch) => patch.type === 'candidates_update')?.payload
    .candidates as readonly CandidateLink[] | undefined;
  if (!candidates?.length) {
    const error = patches.find((patch) => patch.type === 'error')?.payload.message;
    throw new Error(
      `production analyzer returned no candidates${error ? `: ${String(error)}` : ''}`,
    );
  }
  return candidates.map((candidate) => ({ ...candidate, confirmed: true }));
}

const physical: DeviceInfo = {
  udid: 'PHYSICAL-1',
  name: 'Developer iPhone',
  model: 'iPhone',
  osVersion: '18.0',
  platform: 'ios',
  targetKind: 'physical',
};

const simulator: DeviceInfo = {
  udid: 'SIM-1',
  name: 'iPhone 16 Pro',
  model: 'iPhone',
  osVersion: '18.0',
  platform: 'ios',
  targetKind: 'simulator',
  state: 'booted',
};

const projectHash = 'a'.repeat(64);

function xcuitestPlan(runId: string): TestPlan {
  return TestPlanSchema.parse({
    schemaVersion: 'itestagent.test-plan.v3',
    runId,
    projectProfileRef: `projects/${projectHash}/project-profile.json`,
    target: { type: 'current_workspace' },
    device: { kind: 'simulator', simulator: { selector: 'by_udid', udid: simulator.udid } },
    appSource: { strategy: 'auto_from_workspace' },
    backendPreference: {},
    execution: {
      prefer: 'xcuitest',
      fallback: 'abort',
      resolvedPath: 'xcuitest',
      selectionReason: 'evidence_backed_xcuitest',
      features: ['MyAppUITests/LoginTests/testFailure', 'MyAppUITests/LoginTests/testControl'],
      testData: { allowAgentGeneratedData: true, askUserInTuiWhenRequired: true },
      assertion: { policy: 'user_goal_then_profile_then_agent_confirmed' },
      xcuitest: { scheme: 'Demo', testPlan: 'Smoke', targets: ['MyAppUITests'] },
    },
    artifacts: {
      collect: ['xcresult'],
      report: { outputs: ['summary_md', 'result_json', 'artifact_index_json'] },
    },
    performance: { baseline: 'skip', baselineDomain: 'simulator', thresholdRequired: false },
    safety: { defaultMode: 'ask', highRiskActions: ['execute_project_build'] },
  });
}

function devicePlan(runId: string): TestPlan {
  const base = xcuitestPlan(runId);
  return TestPlanSchema.parse({
    ...base,
    device: { kind: 'physical', physical: { selector: 'by_udid', udid: physical.udid } },
    execution: {
      ...base.execution,
      prefer: 'device_backend',
      fallback: 'device_backend',
      resolvedPath: 'device_backend',
      selectionReason: 'confirmed_no_xcuitest_candidate',
      features: ['Login'],
      xcuitest: undefined,
    },
    artifacts: {
      collect: [],
      report: { outputs: ['summary_md', 'result_json', 'artifact_index_json'] },
    },
    safety: { defaultMode: 'ask', highRiskActions: [] },
  });
}

function junit(filtered: boolean): string {
  return filtered
    ? '<?xml version="1.0"?><testsuites><testsuite tests="1"><testcase classname="MyAppUITests.LoginTests" name="testFailure()" time="0.1"/></testsuite></testsuites>'
    : '<?xml version="1.0"?><testsuites><testsuite tests="2"><testcase classname="MyAppUITests.LoginTests" name="testFailure()" time="0.1"><failure message="expected true"/></testcase><testcase classname="MyAppUITests.LoginTests" name="testControl()" time="0.1"/></testsuite></testsuites>';
}

function authoritative(filtered: boolean): string {
  const methods = filtered ? ['testFailure'] : ['testFailure', 'testControl'];
  return JSON.stringify({
    testNodes: methods.map((method) => ({
      nodeType: 'Test Case',
      nodeIdentifierURL: `test://com.apple.xcode/Demo/MyAppUITests/LoginTests/${method}`,
    })),
  });
}

describe('T6.11 production physical MVP closed loop', () => {
  test('runs the DeviceBackend lane from the TUI confirmation gate through canonical explain and fail-closed rerun', async () => {
    const { root, store } = await setup('itestagent-611-device-');
    process.env.ITESTAGENT_HOME = root;
    const workspace = createAnalyzerWorkspace(root, false);
    let plannedRunId = '';
    let backendCreations = 0;
    let backendCloses = 0;
    let suggestionCount = 0;
    const backend = {
      name: 'appium',
      async launchApp() {
        return { success: true as const };
      },
      async getUiTree() {
        return {
          raw: '<XCUIElementTypeApplication><XCUIElementTypeButton name="login"/></XCUIElementTypeApplication>',
          format: 'xml',
          capturedAt: new Date().toISOString(),
        };
      },
      async screenshot() {
        const rawEvidence = join(root, 'runs', plannedRunId, 'staging', 'transport-screenshot.png');
        mkdirSync(join(root, 'runs', plannedRunId, 'staging'), { recursive: true });
        writeFileSync(rawEvidence, 'RAW_SCREENSHOT_SECRET');
        return { id: 'device-shot', type: 'screenshot', path: rawEvidence };
      },
    } as unknown as DeviceBackend;
    const production = {
      ...createProductionAgentSessionDependencies({
        dataRoot: root,
        deviceDiscoveryRuntime: createDiscoveryRuntime(root, { physical }),
      }),
      createDeviceBackend: () => {
        backendCreations += 1;
        return backend;
      },
      closeDeviceBackend: async () => {
        backendCloses += 1;
        return { status: 'closed' as const, reusable: true, issues: [] };
      },
      preparesWda: () => true,
    };
    const { createAgentSession } = await import(
      '../../../packages/itestagent-tui/src/agent-session.js'
    );
    const session = await createAgentSession(workspace, {
      loadApiKey: async () => 'test-key',
      createModel: () =>
        ({ specificationVersion: 'v2', provider: 'test', modelId: 'transport' }) as never,
      production,
      suggestExplorationAction: async () => {
        suggestionCount += 1;
        return suggestionCount === 1
          ? { action: 'screenshot', target: 'capture login evidence' }
          : 'done';
      },
    });
    const planningPatches = [];
    for await (const patch of session.processMessage('/plan 用本机 iPhone 探索登录')) {
      planningPatches.push(patch);
    }
    session.confirmCandidates(confirmedCandidates(planningPatches));
    session.confirmPlan();
    const runId = session.getConfirmedPlan()?.runId;
    expect(runId).toBeTruthy();
    plannedRunId = runId as string;

    const execution = capturedTools.executeTestPlan?.execute({}, { toolCallId: 'device-run' });
    expect(execution).toBeTruthy();
    await new Promise((resolve) => setTimeout(resolve, 0));
    await session.resolvePermission('device-run', 'allow');
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(backendCloses).toBe(0);
    await session.resolvePermission('device-run', 'allow');
    const output = (await execution) as { status: string; path: string; runDir: string };
    expect(output).toMatchObject({ status: 'completed', path: 'device_backend' });
    expect(backendCloses).toBe(1);

    const bundle = await store.loadRunBundle(runId as string);
    expect(bundle.result).toMatchObject({ runId, status: 'explored' });
    expect(bundle.steps.steps.some((step) => step.action === 'screenshot')).toBe(true);
    expect(bundle.artifactIndex.artifacts).toEqual([
      expect.objectContaining({ type: 'screenshot', redactionStatus: 'raw-local-only' }),
    ]);
    expect(JSON.stringify(bundle.result)).not.toContain('RAW_SCREENSHOT_SECRET');
    expect(await runExplainCommand(runId as string, { store })).toMatchObject({ runId });

    let rerunDiscovery = 0;
    await expect(
      runRerunCommand(
        runId as string,
        { failedOnly: true },
        {
          store,
          storeRoot: root,
          production: {
            ...production,
            deviceDiscovery: {
              async discover() {
                rerunDiscovery += 1;
                return production.deviceDiscovery.discover();
              },
            },
          },
        },
      ),
    ).rejects.toThrow('rerun_case_not_reproducible');
    expect(rerunDiscovery).toBe(0);
    expect(backendCreations).toBe(2);
    session.dispose();
  });

  test('runs XCUITest and a precise failed-only child through production orchestration, persistence, and shared CLI handlers', async () => {
    const { root, store } = await setup('itestagent-611-xcuitest-');
    process.env.ITESTAGENT_HOME = root;
    const workspace = createAnalyzerWorkspace(root, true);
    const processCalls: Array<{ cmd: string; args: string[]; signal?: AbortSignal }> = [];
    let filtered = false;
    const runner = async (cmd: string, args: string[], options?: { signal?: AbortSignal }) => {
      processCalls.push({ cmd, args, signal: options?.signal });
      if (cmd === 'xcodebuild') {
        filtered = args.some(
          (arg) =>
            arg.startsWith('-only-testing:') && arg.slice('-only-testing:'.length).includes('/'),
        );
        const resultIndex = args.indexOf('-resultBundlePath');
        const resultPath = args[resultIndex + 1];
        if (!resultPath) throw new Error('missing result bundle path');
        mkdirSync(resultPath, { recursive: true });
        writeFileSync(join(resultPath, 'Info.plist'), 'RAW_XCRESULT_SECRET');
        return { exitCode: filtered ? 0 : 65, stdout: '', stderr: '' };
      }
      if (args.includes('junit')) {
        return { exitCode: 0, stdout: junit(filtered), stderr: '' };
      }
      if (args.includes('--target-info')) {
        return { exitCode: 1, stdout: '', stderr: 'unavailable' };
      }
      return { exitCode: 0, stdout: authoritative(filtered), stderr: '' };
    };
    const production = {
      ...createProductionAgentSessionDependencies({
        dataRoot: root,
        deviceDiscoveryRuntime: createDiscoveryRuntime(root, { simulator }),
      }),
      createDeviceBackend: () => {
        throw new Error('XCUITest must not construct a DeviceBackend');
      },
    };
    const permissions: string[] = [];
    const { createAgentSession } = await import(
      '../../../packages/itestagent-tui/src/agent-session.js'
    );
    const session = await createAgentSession(workspace, {
      loadApiKey: async () => 'test-key',
      createModel: () =>
        ({ specificationVersion: 'v2', provider: 'test', modelId: 'transport' }) as never,
      production,
      transports: {
        xcunitProcessRunner: runner,
        revalidateXcuitest: async () => ({ ready: true }),
      },
    });
    const planningPatches = [];
    for await (const patch of session.processMessage('/plan 在 Simulator 跑登录 smoke')) {
      planningPatches.push(patch);
    }
    session.confirmCandidates(confirmedCandidates(planningPatches));
    session.confirmPlan();
    const parentPlan = session.getConfirmedPlan();
    if (!parentPlan) throw new Error('confirmed XCUITest plan was not retained');
    expect(parentPlan?.execution).toMatchObject({
      resolvedPath: 'xcuitest',
      selectionReason: 'evidence_backed_xcuitest',
    });
    const parentPending = capturedTools.executeTestPlan?.execute({}, { toolCallId: 'xui-parent' });
    expect(parentPending).toBeTruthy();
    await new Promise((resolve) => setTimeout(resolve, 0));
    await session.resolvePermission('xui-parent', 'allow');
    await new Promise((resolve) => setTimeout(resolve, 0));
    await session.resolvePermission('xui-parent', 'allow');
    const parentExecution = (await parentPending) as { status: string; path: string };
    expect(parentExecution).toMatchObject({ status: 'failed', path: 'xcuitest' });
    const parent = await store.loadRunBundle(parentPlan.runId);
    expect(parent.result).toMatchObject({ status: 'failed' });
    expect(parent.steps.steps.map((step) => step.action)).toEqual([
      'xcodebuild_test',
      'xcresult_parse',
    ]);
    expect(parent.artifactIndex.artifacts[0]).toMatchObject({
      type: 'xcresult',
      redactionStatus: 'raw-local-only',
    });
    expect(JSON.stringify(parent.result)).not.toContain('RAW_XCRESULT_SECRET');
    expect(await runExplainCommand(parentPlan.runId, { store })).toMatchObject({
      runId: parentPlan.runId,
    });

    const child = await runRerunCommand(
      parentPlan.runId,
      { failedOnly: true },
      {
        store,
        storeRoot: root,
        runId: 'run-611-child',
        production,
        authorize: async (action) => {
          permissions.push(action);
          return true;
        },
        transports: {
          xcunitProcessRunner: runner,
          revalidateXcuitest: async () => ({ ready: true }),
        },
      },
    );
    expect(child.childPlan.rerun).toEqual({
      parentRunId: parentPlan.runId,
      mode: 'failed_only',
      selectedCaseIds: ['MyAppUITests/LoginTests/testFailure'],
    });
    expect(child.child.result).toMatchObject({
      runId: 'run-611-child',
      parentRunId: parentPlan.runId,
      status: 'flaky',
      cases: [{ caseId: 'MyAppUITests/LoginTests/testFailure', status: 'flaky' }],
    });
    const childBuild = processCalls.filter(({ cmd }) => cmd === 'xcodebuild').at(-1);
    expect(childBuild?.args.filter((arg) => arg.startsWith('-only-testing:'))).toEqual([
      '-only-testing:MyAppUITests/LoginTests/testFailure',
    ]);
    expect(childBuild?.args).toContain('-testPlan');
    expect(permissions).toEqual(['execute_project_build', 'replace_device_app']);
    expect(await runExplainCommand('run-611-child', { store })).toMatchObject({
      result: { parentRunId: parentPlan.runId, status: 'flaky' },
      explanation: { explanationType: 'flaky' },
    });
    session.dispose();
  });

  test('propagates one abort signal through DeviceBackend execution and cleanup before committing cancelled', async () => {
    const { root, store } = await setup('itestagent-611-abort-');
    const controller = new AbortController();
    let executionSignal: AbortSignal | undefined;
    let cleanupSignal: AbortSignal | undefined;
    const backend = {
      name: 'appium',
      async launchApp(_input: unknown, signal?: AbortSignal) {
        executionSignal = signal;
        return { success: true as const };
      },
      async getUiTree(_input: unknown, signal?: AbortSignal) {
        executionSignal = signal;
        await new Promise<void>((_resolve, reject) => {
          signal?.addEventListener(
            'abort',
            () => reject(signal.reason ?? new DOMException('Aborted', 'AbortError')),
            { once: true },
          );
        });
        throw new Error('unreachable');
      },
    } as unknown as DeviceBackend;
    const pending = executeProductionTestPlan({
      plan: devicePlan('run-611-cancelled'),
      workspace: '/workspace',
      device: physical,
      bundleId: 'com.example.Demo',
      store,
      storeRoot: root,
      suggest: async () => 'done',
      authorize: async () => true,
      production: {
        analyzeWorkspace: async () => {
          throw new Error('not used');
        },
        deviceDiscovery: {} as never,
        createDeviceBackend: () => backend,
        closeDeviceBackend: async (_backend, signal) => {
          cleanupSignal = signal;
          return { status: 'closed', reusable: true, issues: [] };
        },
      },
      signal: controller.signal,
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    controller.abort(new DOMException('User cancelled', 'AbortError'));
    const execution = await pending;
    expect(execution).toMatchObject({ status: 'cancelled', path: 'device_backend' });
    expect(executionSignal).toBe(controller.signal);
    expect(cleanupSignal).toBe(controller.signal);
    expect((await store.loadRunBundle('run-611-cancelled')).result.status).toBe('cancelled');
  });
});
