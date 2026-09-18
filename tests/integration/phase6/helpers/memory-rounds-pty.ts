import { mock } from 'bun:test';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { MockDeviceBackend } from 'itestagent-device-mock';
import { saveFlow } from 'itestagent-flow';
import * as sessions from '../../../../packages/itestagent-tui/src/agent-session.js';
import * as keys from '../../../../packages/itestagent-tui/src/api-key-loader.js';

const output = process.argv[2];
if (!output) throw new Error('Expected audit path');
const native = process.env.ITESTAGENT_NATIVE_PTY === '1';
let suggestions = 0;
let connectionConfigured = false;
const root = join(homedir(), '.itestagent');
await mkdir(join(root, 'config'), { recursive: true });
await writeFile(
  join(root, 'config/itestagent.jsonc'),
  JSON.stringify({
    model: { baseURL: 'https://api.example.invalid/v1', model: 'fixture' },
    tui: { framework: 'opentui' },
  }),
);
await saveFlow(
  {
    schemaVersion: 'itestagent.flow.v2',
    flowId: 'round-workload',
    source: 'user-authored',
    status: 'confirmed',
    supportedTargetKinds: ['physical'],
    requiredCapabilities: ['coordinateTap', 'uiTree'],
    lastValidatedTargets: [],
    steps: [
      {
        action: 'tap',
        target: 'Allocate workload',
        locator: { strategy: 'identifier', value: 'fixture-workload' },
        safetyGate: 'ask',
      },
      { action: 'assertVisible', locator: { strategy: 'label', value: 'Ready' } },
    ],
  },
  { dataRoot: root, saveConfirmed: true },
);
const device = {
  udid: 'FIXTURE',
  name: native ? 'Fixture simulator' : 'Fixture phone',
  osVersion: '26.0',
  model: 'Fixture',
  platform: 'ios' as const,
  targetKind: native ? ('simulator' as const) : ('physical' as const),
  state: 'booted' as const,
  availability: 'ready' as const,
};
const backend = Object.assign(
  new MockDeviceBackend({
    uiTree: {
      format: 'xml',
      raw: '<XCUIElementTypeApplication x="0" y="0" width="428" height="926"><XCUIElementTypeButton name="fixture-workload" x="24" y="541" width="380" height="31"/><XCUIElementTypeStaticText name="Ready" label="Ready" x="10" y="10" width="100" height="40"/></XCUIElementTypeApplication>',
      capturedAt: new Date().toISOString(),
    },
  }),
  { getAppProcessId: async () => 42 },
);
let artifactDirectory = root;
let screenshots = 0;
backend.screenshot = async () => {
  const id = `fixture-screen-${++screenshots}`;
  await mkdir(artifactDirectory, { recursive: true });
  const path = join(artifactDirectory, `${id}.png`);
  await writeFile(
    path,
    Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a/2sAAAAASUVORK5CYII=',
      'base64',
    ),
  );
  return { id, type: 'screenshot', path, redactionStatus: 'raw-local-only' };
};
let taps = 0;
let captures = 0;
let closed = 0;
let asks = 0;
let disposed = false;
let runId: string | undefined;
let sessionPlanBaseline: string | undefined;
let finish = Promise.resolve();
backend.tap = async ({ x, y }) => {
  const actualX = Math.round(x * 428);
  const actualY = Math.round(y * 926);
  if (actualX < 24 || actualX > 404 || actualY < 541 || actualY > 572) {
    return { success: false, error: 'Fixture workload button was not hit' };
  }
  taps++;
  return { success: true };
};
mock.module('../../../../packages/itestagent-tui/src/api-key-loader.js', () => ({
  ...keys,
  loadApiKey: async () => ({ ok: true, apiKey: 'fixture-key' }),
}));
const actualCreate = sessions.createAgentSession;
mock.module('../../../../packages/itestagent-tui/src/agent-session.js', () => ({
  ...sessions,
  createAgentSession: async (
    _workspace: string,
    entryDependencies: sessions.AgentSessionDependencies = {},
  ) => {
    connectionConfigured = entryDependencies.simulatorAppium?.wdaLocalPort === 8213;
    const session = await actualCreate(homedir(), {
      ...entryDependencies,
      loadApiKey: async () => 'fixture-key',
      createModel: () => ({}) as never,
      listDevices: async () => [device],
      flowDataRoot: root,
      analyzeWorkspace: async () => ({
        profile: {
          schemaVersion: 'itestagent.project-profile.v1',
          projectHash: 'a'.repeat(64),
          app: { name: 'Fixture', bundleId: 'com.example.fixture', scheme: 'Fixture' },
          targets: [{ name: 'Fixture', type: 'app' }],
          testAssets: { hasXCUITest: false, hasScheme: true },
          features: [
            {
              name: 'Workload',
              keywords: ['workload'],
              evidence: ['Fixture.m'],
              confidence: 0.8,
              confirmed: false,
              displayOrder: 0,
            },
          ],
          suggestedSmoke: ['Workload'],
        },
        analysis: {
          analysisTier: 'tier1_static',
          enabledCapabilities: ['static_source_candidates'],
          limitations: [],
          executionAssets: {
            statusByTargetKind: { physical: 'none', simulator: 'none' },
            configurations: [],
            evidence: ['Fixture metadata'],
            limitations: [],
          },
        },
      }),
      preparesWda: () => native,
      production: {
        analyzeWorkspace: async () => {
          throw new Error('Unexpected analyzer');
        },
        deviceDiscovery: {
          discover: async () => ({ devices: [device], status: 'ok', issues: [] }),
        },
        createDeviceBackend: (_device, context) => {
          artifactDirectory = context?.artifactDirectory ?? root;
          return backend;
        },
        closeDeviceBackend: async () => {
          closed++;
          return { status: 'closed', reusable: true, issues: [] };
        },
        physicalPreflight: async () => ({
          status: 'ready',
          stage: 'ready',
          artifact: {
            sourceKind: 'build',
            sourcePath: root,
            appPath: root,
            bundleId: 'com.example.fixture',
            executable: 'Fixture',
            supportedPlatforms: ['iPhoneOS'],
            architectures: ['arm64'],
            signingValid: true,
          },
          wda: {
            route: 'route_b_wda_manager_managed',
            stage: 'ready',
            ready: true,
            targetDeviceUdid: device.udid,
            targetWdaBundleId: 'fixture.wda',
            waitedMs: 0,
          },
        }),
      },
      createPerformanceCapture: async (input) => {
        const n = ++captures;
        if (native) {
          const path = join(input.stagingDir, 'native-audit.jsonl');
          await mkdir(input.stagingDir, { recursive: true });
          await writeFile(path, '{"fixture":"completed scan"}\n');
          return {
            finish: async () => ({
              artifacts: [
                {
                  id: 'native-audit',
                  type: 'log',
                  path,
                  backend: 'native-memory',
                  redactionStatus: 'raw-local-only',
                },
              ],
              metrics: {
                memoryPeakMB: 20,
                memoryPeakUnit: 'MiB',
                memoryPeakSource: 'native-footprint',
                memoryLeaks: {
                  source: 'native-leaks',
                  scope: 'scan_snapshot',
                  status: 'not_detected',
                  allocationCount: 0,
                  totalBytes: 0,
                  startedAt: '2026-09-09T00:00:00Z',
                  finishedAt: '2026-09-09T00:00:01Z',
                  exitCode: 0,
                  completionVerified: true,
                  targetBound: true,
                  artifactId: 'native-audit',
                },
                collection: [
                  {
                    metric: 'memory_leaks',
                    status: 'collected',
                    reasonCode: 'native_memory.observed_value',
                  },
                ],
              },
            }),
          };
        }
        return {
          finish: async () => ({
            artifacts: [],
            metrics: {
              memoryPeakMB: 20 + n,
              memoryPeakUnit: 'MiB',
              approximate: true,
              memoryGrowth: {
                source: 'activity-monitor-process-live',
                approximate: true,
                scope: 'observed_interval',
                coverage: 'complete',
                samples: [
                  { timestampMs: 0, footprintMiB: 10 + n },
                  {
                    timestampMs: input.memoryObservation?.minimumDurationMs ?? 1000,
                    footprintMiB: 20 + n,
                  },
                ],
                sampleCount: 2,
                startMiB: 10 + n,
                endMiB: 20 + n,
                peakMiB: 20 + n,
                deltaMiB: 10,
                durationMs: input.memoryObservation?.minimumDurationMs ?? 1000,
                rateMiBPerMinute: 600000 / (input.memoryObservation?.minimumDurationMs ?? 1000),
                direction: 'increased',
              },
              collection: input.metrics.map((metric) => ({
                metric,
                status: 'collected',
                reasonCode: 'fixture.collected',
              })),
            },
          }),
        };
      },
      suggestExplorationAction: async () => {
        if (native)
          return ++suggestions === 1 ? { action: 'wait', target: 'Ready', waitMs: 1 } : 'done';
        throw new Error('No exploration allowed');
      },
    });
    return {
      ...session,
      confirmPlan() {
        const patches = session.confirmPlan();
        runId = session.getConfirmedPlan()?.runId;
        sessionPlanBaseline = session.getConfirmedPlan()?.performance.baseline;
        return patches;
      },
      executeConfirmedPlan: async function* () {
        let done = () => {};
        finish = new Promise<void>((resolve) => {
          done = resolve;
        });
        try {
          for await (const patch of session.executeConfirmedPlan()) {
            if (patch.type === 'permission_request') asks++;
            yield patch;
          }
        } finally {
          if (runId) {
            const report = JSON.parse(
              await readFile(join(root, 'runs', runId, 'result.json'), 'utf8'),
            );
            await writeFile(
              output,
              JSON.stringify({
                status: report.status,
                rows: report.metrics.memoryRounds,
                cases: report.cases.map((c: { status: string }) => c.status),
              }),
            );
          }
          done();
        }
      },
      dispose() {
        disposed = true;
        session.dispose();
      },
    };
  },
}));
const { startTui } = await import('../../../../packages/itestagent-tui/src/entry.js');
if (native) {
  const { createProgram } = await import('../../../../packages/itestagent-cli/src/cli.js');
  await createProgram().parseAsync([
    'bun',
    'itestagent',
    '--simulator-appium-url',
    'http://127.0.0.1:4727',
    '--simulator-wda-port',
    '8213',
    '--simulator-mjpeg-port',
    '9213',
    '--simulator-wda-derived-data',
    join(root, 'wda'),
  ]);
} else await startTui(homedir());
await finish;
const result = runId
  ? JSON.parse(await readFile(join(root, 'runs', runId, 'result.json'), 'utf8'))
  : undefined;
await writeFile(
  output,
  JSON.stringify({
    taps,
    captures,
    closed,
    asks,
    disposed,
    status: result?.status,
    ...(native
      ? {
          connectionConfigured,
          scan: result?.metrics?.memoryLeaks?.status,
          baseline: sessionPlanBaseline,
          target: result?.environment?.targetKind,
        }
      : {
          baseline: sessionPlanBaseline,
          baselineFiles: (await readdir(join(root, 'baselines', 'physical')).catch(() => []))
            .length,
        }),
    rounds: result?.metrics?.memoryRounds?.rounds.map((r: { status: string }) => r.status),
  }),
);
