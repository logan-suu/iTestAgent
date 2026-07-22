/**
 * Integration tests for DeviceExplorer using MockDeviceBackend.
 *
 * Each test is standalone (no describe/it) per Bun conventions.
 */
import { expect, test } from 'bun:test';
import type { RunStep } from 'itestagent-contracts';
import { createDefaultConfig } from '../../../itestagent-backends/device-mock/src/fixtures.js';
import { MockDeviceBackend } from '../../../itestagent-backends/device-mock/src/mock-device-backend.js';
import { DeviceExplorer } from '../../src/exploration/device-explorer.js';
import type { ExplorerToolDispatcher } from '../../src/exploration/device-explorer.js';
import { RunStepRecorder } from '../../src/exploration/run-step-recorder.js';
import type { ExplorationAction, LocatorResult } from '../../src/exploration/types.js';
import { loginScreenUiTree } from './fixtures/ui-trees.js';

// ─── MockToolDispatcher ──────────────────────────────────────────

/**
 * ExplorerToolDispatcher implementation that wraps MockDeviceBackend.
 * Routes tool calls to the appropriate MockDeviceBackend method
 * and normalises the return value into the ExplorerToolDispatcher format.
 */
class MockToolDispatcher implements ExplorerToolDispatcher {
  private callId = 0;

  constructor(private mock: MockDeviceBackend) {}

  async dispatch(call: {
    id: string;
    name: string;
    arguments: Record<string, unknown>;
  }): Promise<{
    callId: string;
    status: 'ok' | 'error';
    output: unknown;
  }> {
    this.callId++;
    const args = call.arguments;
    const deviceId = (args.deviceId as string) || 'mock-device';

    try {
      let output: unknown;

      switch (call.name) {
        case 'launch_app':
          output = await this.mock.launchApp({
            deviceId,
            bundleId: args.bundleId as string,
          });
          break;

        case 'tap':
          output = await this.mock.tap({
            deviceId,
            x: args.x as number,
            y: args.y as number,
          });
          break;

        case 'swipe':
          output = await this.mock.swipe({
            deviceId,
            fromX: args.fromX as number,
            fromY: args.fromY as number,
            toX: args.toX as number,
            toY: args.toY as number,
          });
          break;

        case 'type_text':
          output = await this.mock.typeText({
            deviceId,
            text: args.text as string,
          });
          break;

        case 'screenshot': {
          const screenshotTarget = { deviceId };
          output = await this.mock.screenshot(screenshotTarget);
          break;
        }

        case 'get_ui_tree': {
          const uiTarget = { deviceId };
          output = await this.mock.getUiTree(uiTarget);
          break;
        }

        default:
          return {
            callId: call.id,
            status: 'error' as const,
            output: { error: `Unknown tool: ${call.name}` },
          };
      }

      return { callId: call.id, status: 'ok' as const, output };
    } catch (err) {
      return {
        callId: call.id,
        status: 'error' as const,
        output: { error: String(err) },
      };
    }
  }
}

// ─── Helpers ─────────────────────────────────────────────────────

const DEFAULT_OPTIONS = {
  deviceId: 'mock-device',
  bundleId: 'com.example.app',
  targetKind: 'simulator' as const,
  settleMs: 0,
};

function createExplorer(): {
  explorer: DeviceExplorer;
  mock: MockDeviceBackend;
  dispatcher: MockToolDispatcher;
} {
  const config = createDefaultConfig();
  config.uiTree = loginScreenUiTree();
  const mock = new MockDeviceBackend(config);
  const dispatcher = new MockToolDispatcher(mock);
  const explorer = new DeviceExplorer(dispatcher, DEFAULT_OPTIONS);
  return { explorer, mock, dispatcher };
}

/**
 * Run a single-action explore and return all steps.
 * Also verifies basic invariants (steps exist, first is launch).
 */
async function exploreSingle(action: ExplorationAction): Promise<RunStep[]> {
  const { explorer } = createExplorer();
  const steps = await explorer.explore([action]);
  return steps;
}

// ─── Tap Action ──────────────────────────────────────────────────

test('explore with tap action records a RunStep with action="tap"', async () => {
  const steps = await exploreSingle({ action: 'tap', target: 'login_button' });

  expect(steps).toHaveLength(2); // launch + tap
  const launchStep = steps[0] as NonNullable<(typeof steps)[number]>;
  const tapStep = steps[1] as NonNullable<(typeof steps)[number]>;
  expect(launchStep.action).toBe('launch');
  expect(launchStep.target).toBe('com.example.app');
  expect(tapStep.action).toBe('tap');
  expect(tapStep.target).toBe('login_button');
});

test('explore with tap action includes locator info in step input', async () => {
  const steps = await exploreSingle({ action: 'tap', target: 'login_button' });

  const tapStep = steps[1] as NonNullable<(typeof steps)[number]>;
  const input = tapStep.input as Record<string, unknown>;
  const locator = input.locator as Record<string, unknown> | undefined;

  expect(locator).toBeDefined();
  expect(locator?.strategy).toBe('accessibility_id');
  expect(locator?.confidence).toBe('high');
});

// ─── Swipe Action ────────────────────────────────────────────────

test('explore with swipe action records a RunStep with action="swipe"', async () => {
  const steps = await exploreSingle({
    action: 'swipe',
    target: 'swipe_down',
    direction: 'down',
  });

  expect(steps).toHaveLength(2);
  const swipeStep = steps[1] as NonNullable<(typeof steps)[number]>;
  expect(swipeStep.action).toBe('swipe');
  expect(swipeStep.target).toBe('swipe_down');
});

test('explore with swipe up action uses correct direction', async () => {
  const steps = await exploreSingle({
    action: 'swipe',
    target: 'swipe_up',
    direction: 'up',
  });

  const usStep = steps[1] as NonNullable<(typeof steps)[number]>;
  expect(usStep.action).toBe('swipe');
  expect(usStep.target).toBe('swipe_up');
});

test('explore with swipe action records swipe result with direction metadata', async () => {
  const steps = await exploreSingle({
    action: 'swipe',
    target: 'swipe_down',
    direction: 'down',
  });

  const step = steps[1] as NonNullable<(typeof steps)[number]>;
  const result = step.result as Record<string, unknown>;

  expect(result.direction).toBe('down');
  expect(result.from).toBeDefined();
  expect(result.to).toBeDefined();
  expect((result.from as Record<string, unknown>).x).toBe(0.5);
  expect((result.from as Record<string, unknown>).y).toBe(0.3);
  expect((result.to as Record<string, unknown>).x).toBe(0.5);
  expect((result.to as Record<string, unknown>).y).toBe(0.7);
});

// ─── Input Action ────────────────────────────────────────────────

test('explore with input action records a RunStep with action="type_text"', async () => {
  const steps = await exploreSingle({
    action: 'input',
    target: 'username_field',
    text: 'testuser',
  });

  expect(steps).toHaveLength(2);
  const inStep = steps[1] as NonNullable<(typeof steps)[number]>;
  expect(inStep.action).toBe('type_text');
  expect(inStep.target).toBe('username_field');
});

test('explore with input action records the input text in step result', async () => {
  const steps = await exploreSingle({
    action: 'input',
    target: 'password_field',
    text: 's3cret!',
  });

  const step = steps[1] as NonNullable<(typeof steps)[number]>;
  const result = step.result as Record<string, unknown>;

  expect(result.text).toBe('s3cret!');
  expect(result.result).toBeDefined();
});

// ─── Screenshot Action ───────────────────────────────────────────

test('explore with screenshot action records a RunStep with action="screenshot"', async () => {
  const steps = await exploreSingle({
    action: 'screenshot',
    target: 'home_screen',
  });

  expect(steps).toHaveLength(2);
  const ssStep = steps[1] as NonNullable<(typeof steps)[number]>;
  expect(ssStep.action).toBe('screenshot');
  expect(ssStep.target).toBe('home_screen');
});

test('explore with screenshot action records artifact reference in step', async () => {
  const steps = await exploreSingle({ action: 'screenshot', target: 'home_screen' });

  const ssStep2 = steps[1] as NonNullable<(typeof steps)[number]>;
  const ssResult = ssStep2.result as Record<string, unknown>;

  expect(ssResult.artifactId).toBeString();
  expect(ssResult.artifactId).toMatch(/^artifact_screenshot_/);
  // Screenshot step should link to the artifact
  expect(ssStep2.artifacts).toHaveLength(1);
  expect(ssStep2.artifacts[0]).toBe(ssResult.artifactId as string);
});

// ─── Multiple Actions ────────────────────────────────────────────

test('explore with multiple actions records all steps in order', async () => {
  const { explorer } = createExplorer();
  const actions: ExplorationAction[] = [
    { action: 'tap', target: 'username_field' },
    { action: 'input', target: 'username_field', text: 'testuser' },
    { action: 'swipe', target: 'swipe_down', direction: 'down' },
    { action: 'screenshot', target: 'home_screen' },
  ];

  const steps = await explorer.explore(actions);

  expect(steps).toHaveLength(5); // launch + 4 actions

  // Step 0: launch
  expect(steps[0]?.action).toBe('launch');
  expect(steps[0]?.target).toBe('com.example.app');

  // Step 1: tap
  expect(steps[1]?.action).toBe('tap');
  expect(steps[1]?.target).toBe('username_field');

  // Step 2: input
  expect(steps[2]?.action).toBe('type_text');
  expect(steps[2]?.target).toBe('username_field');

  // Step 3: swipe
  expect(steps[3]?.action).toBe('swipe');
  expect(steps[3]?.target).toBe('swipe_down');

  // Step 4: screenshot
  expect(steps[4]?.action).toBe('screenshot');
  expect(steps[4]?.target).toBe('home_screen');
});

test('multiple actions produce strictly ordered step IDs', async () => {
  const { explorer } = createExplorer();
  const actions: ExplorationAction[] = [
    { action: 'tap', target: 'login_button' },
    { action: 'screenshot', target: 'after_tap' },
  ];

  const steps = await explorer.explore(actions);

  expect(steps).toHaveLength(3);
  expect(steps.map((s: RunStep) => s.stepId)).toEqual([
    's1', // launch
    's2', // tap
    's3', // screenshot
  ]);
});

// ─── Unknown Target / Degradation ────────────────────────────────

test('explore with unknown target uses coordinate fallback (degradation)', async () => {
  const steps = await exploreSingle({
    action: 'tap',
    target: 'nonexistent_element_xyz',
  });

  expect(steps).toHaveLength(2);
  const dtapStep = steps[1] as NonNullable<(typeof steps)[number]>;

  // Action should still be tap (not failed at action level)
  expect(dtapStep.action).toBe('tap');
  expect(dtapStep.target).toBe('nonexistent_element_xyz');

  // Locator should show coordinate fallback degradation
  const dinput = dtapStep.input as Record<string, unknown>;
  const locator = dinput.locator as Record<string, unknown> | undefined;

  expect(locator).toBeDefined();
  expect(locator?.strategy).toBe('coordinate');
  expect(locator?.confidence).toBe('low');
  expect(locator?.degradation).toBeString();
  expect(locator?.degradation).toMatch(/coordinate|fallback|degrad/i);

  // Step result should still be success from the mock backend
  const dresult = dtapStep.result as Record<string, unknown>;
  expect(dresult.success).toBe(true);
});

// ─── getSteps ────────────────────────────────────────────────────

test('getSteps returns recorded steps', async () => {
  const { explorer } = createExplorer();

  // Before explore: empty
  expect(explorer.getSteps()).toHaveLength(0);

  // After explore: contains recorded steps
  const steps = await explorer.explore([{ action: 'tap', target: 'login_button' }]);
  expect(steps.length).toBeGreaterThan(0);

  // getSteps should return the same steps
  const getStepsResult = explorer.getSteps();
  expect(getStepsResult).toEqual(steps);
});

test('getSteps returns updated steps after additional explores', async () => {
  const { explorer } = createExplorer();

  const steps1 = await explorer.explore([{ action: 'tap', target: 'login_button' }]);
  expect(steps1).toHaveLength(2);

  // Calling explore again on the same explorer adds MORE steps (no reset)
  const steps2 = await explorer.explore([
    { action: 'swipe', target: 'scrolling', direction: 'down' },
  ]);
  expect(steps2).toHaveLength(4); // previous 2 + new launch + new swipe

  // getSteps should reflect all steps
  expect(explorer.getSteps()).toEqual(steps2);
});

// ─── reset ───────────────────────────────────────────────────────

test('reset clears the recorder', async () => {
  const { explorer } = createExplorer();

  await explorer.explore([{ action: 'tap', target: 'login_button' }]);
  expect(explorer.getSteps()).toHaveLength(2);

  explorer.reset();
  expect(explorer.getSteps()).toHaveLength(0);
});

test('reset allows fresh recording cycle', async () => {
  const { explorer } = createExplorer();

  await explorer.explore([{ action: 'screenshot', target: 'first' }]);
  expect(explorer.getSteps()).toHaveLength(2);

  explorer.reset();

  const steps = await explorer.explore([{ action: 'tap', target: 'login_button' }]);
  expect(steps).toHaveLength(2);
  expect(steps[0]?.stepId).toBe('s1');
  expect(steps[0]?.action).toBe('launch');
  expect(steps[1]?.action).toBe('tap');
  expect(steps[1]?.target).toBe('login_button');
});

// ─── Step Format ─────────────────────────────────────────────────

test('steps have correct format (stepId, action, target, backend, startedAt, durationMs)', async () => {
  const { explorer } = createExplorer();
  const steps = await explorer.explore([
    { action: 'tap', target: 'login_button' },
    { action: 'input', target: 'username_field', text: 'admin' },
  ]);

  expect(steps).toHaveLength(3); // launch + tap + input

  for (const step of steps) {
    // stepId: non-empty string
    expect(step.stepId).toBeString();
    expect(step.stepId.length).toBeGreaterThan(0);

    // backend: non-empty string
    expect(step.backend).toBeString();
    expect(step.backend.length).toBeGreaterThan(0);

    // action: non-empty string
    expect(step.action).toBeString();
    expect(step.action.length).toBeGreaterThan(0);

    // target: optional but present for our test
    expect(step.target).toBeString();

    // startedAt: ISO 8601 timestamp
    expect(step.startedAt).toBeString();
    expect(step.startedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);

    // durationMs: non-negative integer
    expect(typeof step.durationMs).toBe('number');
    expect(step.durationMs).toBeGreaterThanOrEqual(0);
    expect(Number.isInteger(step.durationMs)).toBeTrue();

    // artifacts: always an array
    expect(Array.isArray(step.artifacts)).toBeTrue();

    // result: always defined
    expect(step.result).toBeDefined();
  }
});

test('step backend is "appium" (from RunStepRecorder default)', async () => {
  const steps = await exploreSingle({ action: 'tap', target: 'login_button' });

  for (const step of steps) {
    expect(step.backend).toBe('appium');
  }
});
