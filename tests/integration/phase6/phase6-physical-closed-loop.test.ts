import { afterEach, describe, expect, mock, test } from 'bun:test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as aiReal from 'ai';
import type { DeviceBackend, DeviceInfo, TestPlan } from 'itestagent-contracts';
import { TestPlanSchema } from 'itestagent-contracts';
import { executeProductionTestPlan } from 'itestagent-engine';
import { saveProfile } from 'itestagent-project-analyzer';
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
  if (originalHome === undefined) process.env.ITESTAGENT_HOME = undefined;
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

function profile(hasXcuitest: boolean) {
  return {
    schemaVersion: 'itestagent.project-profile.v1' as const,
    projectHash,
    app: {
      name: 'Demo',
      bundleId: 'com.example.Demo',
      workspace: '/workspace/Demo.xcworkspace',
      scheme: 'Demo',
    },
    targets: [{ name: 'Demo', type: 'app' as const }],
    testAssets: { hasXCUITest: hasXcuitest, hasScheme: true },
    features: [
      {
        name: 'Login',
        keywords: ['login'],
        evidence: ['LoginView.swift'],
        confidence: 0.9,
        confirmed: false,
        displayOrder: 0,
      },
    ],
    suggestedSmoke: ['launch', 'Login'],
  };
}

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
      features: ['DemoUITests/LoginTests/testFailure', 'DemoUITests/LoginTests/testControl'],
      testData: { allowAgentGeneratedData: true, askUserInTuiWhenRequired: true },
      assertion: { policy: 'user_goal_then_profile_then_agent_confirmed' },
      xcuitest: { scheme: 'Demo', testPlan: 'Smoke', targets: ['DemoUITests'] },
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
    ? '<?xml version="1.0"?><testsuites><testsuite tests="1"><testcase classname="DemoUITests.LoginTests" name="testFailure()" time="0.1"/></testsuite></testsuites>'
    : '<?xml version="1.0"?><testsuites><testsuite tests="2"><testcase classname="DemoUITests.LoginTests" name="testFailure()" time="0.1"><failure message="expected true"/></testcase><testcase classname="DemoUITests.LoginTests" name="testControl()" time="0.1"/></testsuite></testsuites>';
}

function authoritative(filtered: boolean): string {
  const methods = filtered ? ['testFailure'] : ['testFailure', 'testControl'];
  return JSON.stringify({
    testNodes: methods.map((method) => ({
      nodeType: 'Test Case',
      nodeIdentifierURL: `test://com.apple.xcode/Demo/DemoUITests/LoginTests/${method}`,
    })),
  });
}

describe('T6.11 production physical MVP closed loop', () => {
  test('runs the DeviceBackend lane from the TUI confirmation gate through canonical explain and fail-closed rerun', async () => {
    const { root, store } = await setup('itestagent-611-device-');
    process.env.ITESTAGENT_HOME = root;
    const analysis = {
      profile: profile(false),
      analysis: {
        analysisTier: 'tier1_static' as const,
        enabledCapabilities: ['xcodebuild_discovery', 'static_source_candidates'],
        limitations: ['Candidates require confirmation.'],
        executionAssets: {
          statusByTargetKind: { physical: 'none' as const, simulator: 'none' as const },
          configurations: [],
          evidence: ['No metadata-only XCUITest candidate.'],
          limitations: [],
        },
      },
    };
    saveProfile(analysis.profile, { dataRoot: root });
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
    const { createAgentSession } = await import(
      '../../../packages/itestagent-tui/src/agent-session.js'
    );
    const session = await createAgentSession('/workspace', {
      loadApiKey: async () => 'test-key',
      createModel: () =>
        ({ specificationVersion: 'v2', provider: 'test', modelId: 'transport' }) as never,
      analyzeWorkspace: async () => analysis,
      listDevices: async () => [physical],
      createDeviceBackend: () => {
        backendCreations += 1;
        return backend;
      },
      closeDeviceBackend: async () => {
        backendCloses += 1;
        return { status: 'closed', reusable: true, issues: [] };
      },
      suggestExplorationAction: async () => {
        suggestionCount += 1;
        return suggestionCount === 1
          ? { action: 'screenshot', target: 'capture login evidence' }
          : 'done';
      },
    });
    for await (const _patch of session.processMessage('/plan 用本机 iPhone 探索登录')) {
      // Drain the production session turn so its tools are registered.
    }
    session.confirmCandidates(
      analysis.profile.features.map((candidate) => ({ ...candidate, confirmed: true })),
    );
    session.confirmPlan();
    const runId = session.getConfirmedPlan()?.runId;
    expect(runId).toBeTruthy();
    plannedRunId = runId as string;

    const execution = capturedTools.executeTestPlan?.execute({}, { toolCallId: 'device-run' });
    expect(execution).toBeTruthy();
    await new Promise((resolve) => setTimeout(resolve, 0));
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
            analyzeWorkspace: async () => analysis,
            deviceDiscovery: {
              async discover() {
                rerunDiscovery += 1;
                return { devices: [physical], status: 'ok', issues: [] };
              },
            },
            createDeviceBackend: () => backend,
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
    saveProfile(profile(true), { dataRoot: root });
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
      analyzeWorkspace: async () => {
        throw new Error('analysis is outside the execution transport');
      },
      deviceDiscovery: {
        async discover() {
          return { devices: [simulator], status: 'ok' as const, issues: [] };
        },
      },
      createDeviceBackend: () => {
        throw new Error('XCUITest must not construct a DeviceBackend');
      },
    };
    const permissions: string[] = [];
    process.env.ITESTAGENT_HOME = root;
    const analysis = {
      profile: profile(true),
      analysis: {
        analysisTier: 'tier1_static' as const,
        enabledCapabilities: ['xcodebuild_discovery', 'static_source_candidates'],
        limitations: ['Candidates require confirmation.'],
        executionAssets: {
          statusByTargetKind: { physical: 'none' as const, simulator: 'available' as const },
          configurations: [
            {
              scheme: 'Demo',
              testPlan: 'Smoke',
              targets: ['DemoUITests'],
              targetKind: 'simulator' as const,
              isDefault: true,
              evidence: ['shared scheme TestAction metadata'],
              limitations: [],
            },
          ],
          evidence: ['shared scheme TestAction metadata'],
          limitations: [],
        },
      },
    };
    const { createAgentSession } = await import(
      '../../../packages/itestagent-tui/src/agent-session.js'
    );
    const session = await createAgentSession('/workspace', {
      loadApiKey: async () => 'test-key',
      createModel: () =>
        ({ specificationVersion: 'v2', provider: 'test', modelId: 'transport' }) as never,
      analyzeWorkspace: async () => analysis,
      listDevices: async () => [simulator],
      createDeviceBackend: production.createDeviceBackend,
      transports: {
        xcunitProcessRunner: runner,
        revalidateXcuitest: async () => ({ ready: true }),
      },
    });
    for await (const _patch of session.processMessage('/plan 在 Simulator 跑登录 smoke')) {
      // Drain the production session turn so its tools are registered.
    }
    session.confirmCandidates(
      analysis.profile.features.map((candidate) => ({ ...candidate, confirmed: true })),
    );
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
      selectedCaseIds: ['DemoUITests/LoginTests/testFailure'],
    });
    expect(child.child.result).toMatchObject({
      runId: 'run-611-child',
      parentRunId: parentPlan.runId,
      status: 'flaky',
      cases: [{ caseId: 'DemoUITests/LoginTests/testFailure', status: 'flaky' }],
    });
    const childBuild = processCalls.filter(({ cmd }) => cmd === 'xcodebuild').at(-1);
    expect(childBuild?.args.filter((arg) => arg.startsWith('-only-testing:'))).toEqual([
      '-only-testing:DemoUITests/LoginTests/testFailure',
    ]);
    expect(childBuild?.args).toContain('-testPlan');
    expect(
      processCalls.every(({ signal }) => signal === undefined || signal instanceof AbortSignal),
    ).toBe(true);
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
