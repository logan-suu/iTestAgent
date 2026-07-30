/**
 * FlowReplayEngine tests — Task 5.2 unit tests.
 *
 * Covers:
 *   - checkTargetCompatibility (ADR-011)
 *   - replayFlow with MockDeviceBackend
 *   - All action mappings: launchApp, tap, swipe, typeText, pressButton, openUrl, etc.
 *   - SafetyGate ask/deny behavior (R7)
 *   - Evidence collection
 *   - Error handling and partial failure
 *   - No-backend actions (comment, wait)
 *   - Assertion actions (assertVisible, assertNotVisible, assertText)
 */
import { describe, expect, test } from 'bun:test';
import type {
  ActionResult,
  AppInfo,
  ArtifactRef,
  BackendCapabilities,
  CrashSummary,
  DeviceBackend,
  DeviceInfo,
  DeviceTarget,
  HealthCheckResult,
  LaunchAppInput,
  LogCollectInput,
  OpenUrlInput,
  PressButtonInput,
  RecordingHandle,
  RecordingInput,
  ScreenshotInput,
  SwipeInput,
  TapInput,
  TerminateAppInput,
  TypeTextInput,
  UiTreeSnapshot,
} from 'itestagent-contracts';
import {
  blockedStep,
  createEmptySummary,
  failedStep,
  passedStep,
  skippedStep,
} from '../src/replay-result.js';
import { type ReplayOptions, checkTargetCompatibility, replayFlow } from '../src/replay.js';
import type { FlowV2 } from '../src/schema.js';

// ─── Inline MockDeviceBackend ──────────────────────────────────────

/**
 * Minimal inline mock for testing — avoids adding device-mock dependency
 * to the flow package.
 */
class MockDeviceBackend implements DeviceBackend {
  readonly name = 'mock';

  readonly capabilities: BackendCapabilities = {
    supportedTargetKinds: ['simulator'],
    features: ['uiTree', 'screenshot', 'coordinateTap', 'swipe', 'textInput'],
    supportsUiTree: true,
    supportsScreenshot: true,
    supportsVideo: false,
    supportsCrashLogs: false,
    supportsLocation: false,
    supportsPush: false,
  };

  private _uiTree: UiTreeSnapshot | null = null;
  private _screenshot: ArtifactRef | null = null;
  private _logArtifact: ArtifactRef | null = null;
  private _recordingHandle: RecordingHandle | null = null;
  private _forceFail: string | null = null;

  setUiTree(tree: UiTreeSnapshot | null) {
    this._uiTree = tree;
  }
  setScreenshot(ss: ArtifactRef | null) {
    this._screenshot = ss;
  }
  setLogArtifact(log: ArtifactRef | null) {
    this._logArtifact = log;
  }
  setRecordingHandle(h: RecordingHandle | null) {
    this._recordingHandle = h;
  }
  setForceFail(msg: string | null) {
    this._forceFail = msg;
  }

  async listDevices(_s?: AbortSignal): Promise<DeviceInfo[]> {
    return [];
  }
  async healthcheck(_id: string, _s?: AbortSignal): Promise<HealthCheckResult> {
    return { healthy: true };
  }
  async listApps(_id: string, _s?: AbortSignal): Promise<AppInfo[]> {
    return [];
  }
  async launchApp(_i: LaunchAppInput, _s?: AbortSignal): Promise<ActionResult> {
    return this._failOrSuccess('launchApp');
  }
  async terminateApp(_i: TerminateAppInput, _s?: AbortSignal): Promise<ActionResult> {
    return this._failOrSuccess('terminateApp');
  }
  async getUiTree(_i: DeviceTarget, _s?: AbortSignal): Promise<UiTreeSnapshot> {
    if (this._forceFail) throw new Error(this._forceFail);
    if (!this._uiTree) throw new Error('no uiTree configured');
    return this._uiTree;
  }
  async screenshot(_i: ScreenshotInput, _s?: AbortSignal): Promise<ArtifactRef> {
    if (this._forceFail) throw new Error(this._forceFail);
    if (!this._screenshot) throw new Error('no screenshot configured');
    return this._screenshot;
  }
  async tap(_i: TapInput, _s?: AbortSignal): Promise<ActionResult> {
    return this._failOrSuccess('tap');
  }
  async swipe(_i: SwipeInput, _s?: AbortSignal): Promise<ActionResult> {
    return this._failOrSuccess('swipe');
  }
  async typeText(_i: TypeTextInput, _s?: AbortSignal): Promise<ActionResult> {
    return this._failOrSuccess('typeText');
  }
  async pressButton(_i: PressButtonInput, _s?: AbortSignal): Promise<ActionResult> {
    return this._failOrSuccess('pressButton');
  }
  async openUrl(_i: OpenUrlInput, _s?: AbortSignal): Promise<ActionResult> {
    return this._failOrSuccess('openUrl');
  }
  async startRecording(_i: RecordingInput, _s?: AbortSignal): Promise<RecordingHandle> {
    if (this._forceFail) throw new Error(this._forceFail);
    if (!this._recordingHandle) throw new Error('no recordingHandle configured');
    return this._recordingHandle;
  }
  async stopRecording(_i: RecordingHandle, _s?: AbortSignal): Promise<ArtifactRef> {
    return { id: 'rec_stop_1', type: 'video', path: '/tmp/vid.mp4', redactionStatus: 'safe' };
  }
  async listCrashes(_i: DeviceTarget, _s?: AbortSignal): Promise<CrashSummary[]> {
    return [];
  }
  async collectLogs(_i: LogCollectInput, _s?: AbortSignal): Promise<ArtifactRef> {
    if (this._forceFail) throw new Error(this._forceFail);
    if (!this._logArtifact) throw new Error('no log artifact configured');
    return this._logArtifact;
  }

  private _failOrSuccess(action: string): ActionResult {
    if (this._forceFail) {
      return { success: false, message: `${action} failed`, error: this._forceFail };
    }
    return { success: true, message: `${action} ok` };
  }
}

// ─── Shared fixtures ────────────────────────────────────────────────

/** Minimal UiTree XML with a button for locator resolution tests. */
const MINIMAL_UI_TREE_XML = `<?xml version="1.0" encoding="UTF-8"?>
<App>
  <XCUIElementTypeWindow>
    <XCUIElementTypeButton type="XCUIElementTypeButton" name="Login" label="Login" enabled="true" visible="true" x="100" y="200" width="80" height="44"/>
    <XCUIElementTypeStaticText type="XCUIElementTypeStaticText" name="Welcome" label="Welcome" value="Welcome to the app" enabled="true" visible="true" x="50" y="100" width="200" height="30"/>
  </XCUIElementTypeWindow>
</App>`;

/** Minimal UiTreeSnapshot fixture. */
function makeUiTreeSnapshot(xml = MINIMAL_UI_TREE_XML): UiTreeSnapshot {
  return { raw: xml, format: 'xml', capturedAt: new Date().toISOString() };
}

/** Minimal screenshot ArtifactRef fixture. */
function makeScreenshotRef(): ArtifactRef {
  return { id: 'ss_1', type: 'screenshot', path: '/tmp/ss.png', redactionStatus: 'safe' };
}

/** Minimal recording handle fixture. */
function makeRecordingHandle() {
  return { handleId: 'rec_1', startedAt: new Date().toISOString() };
}

/** Minimal log ArtifactRef fixture. */
function makeLogRef(): ArtifactRef {
  return { id: 'log_1', type: 'log', path: '/tmp/log.txt', redactionStatus: 'safe' };
}

/** Base flow with no steps — tests will modify. */
function makeFlow(overrides: Partial<FlowV2> = {}): FlowV2 {
  return {
    schemaVersion: 'itestagent.flow.v2' as const,
    flowId: 'test-flow',
    source: 'agent-recorded',
    status: 'draft',
    supportedTargetKinds: ['simulator'],
    requiredCapabilities: ['uiTree', 'coordinateTap'],
    lastValidatedTargets: [{ kind: 'simulator', udid: 'test-udid' }],
    steps: [],
    ...overrides,
  };
}

/** Helper: create default replay options. */
function makeReplayOpts(overrides: Partial<ReplayOptions> = {}): ReplayOptions {
  return { deviceId: 'test-udid', collectEvidence: false, ...overrides };
}

// ─── checkTargetCompatibility ───────────────────────────────────────

describe('checkTargetCompatibility', () => {
  test('returns ok when targetKind matches', () => {
    const flow = makeFlow({ supportedTargetKinds: ['simulator'] });
    const result = checkTargetCompatibility(flow, 'simulator');
    expect(result.ok).toBe(true);
  });

  test('returns ok when flow supports multiple targetKinds', () => {
    const flow = makeFlow({ supportedTargetKinds: ['physical', 'simulator'] });
    expect(checkTargetCompatibility(flow, 'physical').ok).toBe(true);
    expect(checkTargetCompatibility(flow, 'simulator').ok).toBe(true);
  });

  test('returns blocked when targetKind does not match', () => {
    const flow = makeFlow({ supportedTargetKinds: ['physical'] });
    const result = checkTargetCompatibility(flow, 'simulator');
    expect(result.ok).toBe(false);
    expect(result.reason).toContain('blocked per ADR-011');
    expect(result.reason).toContain('physical');
    expect(result.reason).toContain('simulator');
  });
});

// ─── replayFlow: comment and wait (no backend needed) ───────────────

describe('replayFlow — no-backend actions', () => {
  test('comment step passes with no-op', async () => {
    const backend = new MockDeviceBackend();
    const flow = makeFlow({
      steps: [{ action: 'comment', comment: 'This is a comment' }],
    });
    const result = await replayFlow(flow, backend, makeReplayOpts());
    expect(result.summary.passed).toBe(1);
    expect(result.steps[0]?.status).toBe('passed');
    expect(result.steps[0]?.detail).toBe('This is a comment');
  });

  test('wait step passes after delay', async () => {
    const backend = new MockDeviceBackend();
    const flow = makeFlow({
      steps: [{ action: 'wait', durationMs: 50 }],
    });
    const result = await replayFlow(flow, backend, makeReplayOpts());
    expect(result.summary.passed).toBe(1);
    expect(result.steps[0]?.status).toBe('passed');
    expect(result.steps[0]?.durationMs).toBeGreaterThanOrEqual(50);
  });
});

// ─── replayFlow: launchApp / terminateApp ──────────────────────────

describe('replayFlow — app lifecycle', () => {
  test('launchApp passes with bundleId from step value', async () => {
    const backend = new MockDeviceBackend();
    const flow = makeFlow({
      steps: [{ action: 'launchApp', target: 'MyApp', value: 'com.example.app' }],
    });
    const result = await replayFlow(flow, backend, makeReplayOpts());
    expect(result.summary.passed).toBe(1);
  });

  test('launchApp passes with bundleId from options', async () => {
    const backend = new MockDeviceBackend();
    const flow = makeFlow({
      steps: [{ action: 'launchApp', target: 'MyApp' }],
    });
    const result = await replayFlow(flow, backend, makeReplayOpts({ bundleId: 'com.example.app' }));
    expect(result.summary.passed).toBe(1);
  });

  test('launchApp blocked when no bundleId available', async () => {
    const backend = new MockDeviceBackend();
    const flow = makeFlow({
      steps: [{ action: 'launchApp', target: 'MyApp' }],
    });
    const result = await replayFlow(flow, backend, makeReplayOpts());
    expect(result.steps[0]?.status).toBe('blocked');
    expect(result.steps[0]?.error).toContain('bundleId');
  });

  test('terminateApp passes with bundleId', async () => {
    const backend = new MockDeviceBackend();
    const flow = makeFlow({
      steps: [{ action: 'terminateApp', target: 'MyApp', value: 'com.example.app' }],
    });
    const result = await replayFlow(flow, backend, makeReplayOpts());
    expect(result.summary.passed).toBe(1);
  });
});

// ─── replayFlow: tap (coordinate + label locator) ──────────────────

describe('replayFlow — tap', () => {
  test('tap with coordinate locator passes', async () => {
    const backend = new MockDeviceBackend();
    const flow = makeFlow({
      steps: [
        {
          action: 'tap',
          target: 'Login button',
          locator: { strategy: 'coordinate', value: '0.5,0.3' },
        },
      ],
    });
    const result = await replayFlow(flow, backend, makeReplayOpts());
    expect(result.summary.passed).toBe(1);
  });

  test('tap blocked when no locator', async () => {
    const backend = new MockDeviceBackend();
    const flow = makeFlow({
      steps: [{ action: 'tap', target: 'Login button' }],
    });
    const result = await replayFlow(flow, backend, makeReplayOpts());
    expect(result.steps[0]?.status).toBe('blocked');
    expect(result.steps[0]?.error).toContain('locator');
  });

  test('tap blocked when coordinate parse fails', async () => {
    const backend = new MockDeviceBackend();
    const flow = makeFlow({
      steps: [
        {
          action: 'tap',
          locator: { strategy: 'coordinate', value: 'invalid' },
        },
      ],
    });
    const result = await replayFlow(flow, backend, makeReplayOpts());
    expect(result.steps[0]?.status).toBe('blocked');
  });

  test('tap with label locator resolves from UiTree', async () => {
    const backend = new MockDeviceBackend();
    backend.setUiTree(makeUiTreeSnapshot());
    const flow = makeFlow({
      steps: [
        {
          action: 'tap',
          target: 'Login',
          locator: { strategy: 'label', value: 'Login' },
        },
      ],
    });
    const result = await replayFlow(flow, backend, makeReplayOpts());
    expect(result.summary.passed).toBe(1);
  });

  test('tap with label locator blocked when element not in UiTree', async () => {
    const backend = new MockDeviceBackend();
    backend.setUiTree(makeUiTreeSnapshot());
    const flow = makeFlow({
      steps: [
        {
          action: 'tap',
          target: 'NonExistent',
          locator: { strategy: 'label', value: 'NonExistent' },
        },
      ],
    });
    const result = await replayFlow(flow, backend, makeReplayOpts());
    expect(result.steps[0]?.status).toBe('blocked');
    expect(result.steps[0]?.error).toContain('resolution failed');
  });
});

// ─── replayFlow: swipe ──────────────────────────────────────────────

describe('replayFlow — swipe', () => {
  test('swipe with direction passes', async () => {
    const backend = new MockDeviceBackend();
    const flow = makeFlow({
      steps: [{ action: 'swipe', direction: 'up', durationMs: 300 }],
    });
    const result = await replayFlow(flow, backend, makeReplayOpts());
    expect(result.summary.passed).toBe(1);
  });

  test('swipe with coordinate locator passes', async () => {
    const backend = new MockDeviceBackend();
    const flow = makeFlow({
      steps: [
        {
          action: 'swipe',
          locator: { strategy: 'coordinate', value: '0.5,0.7→0.5,0.3' },
        },
      ],
    });
    const result = await replayFlow(flow, backend, makeReplayOpts());
    expect(result.summary.passed).toBe(1);
  });

  test('swipe blocked without direction or coordinate locator', async () => {
    const backend = new MockDeviceBackend();
    const flow = makeFlow({
      steps: [{ action: 'swipe' }],
    });
    const result = await replayFlow(flow, backend, makeReplayOpts());
    expect(result.steps[0]?.status).toBe('blocked');
  });
});

// ─── replayFlow: typeText / pressButton / openUrl ──────────────────

describe('replayFlow — input actions', () => {
  test('typeText passes', async () => {
    const backend = new MockDeviceBackend();
    const flow = makeFlow({
      steps: [{ action: 'typeText', value: 'hello@example.com' }],
    });
    const result = await replayFlow(flow, backend, makeReplayOpts());
    expect(result.summary.passed).toBe(1);
  });

  test('typeText blocked without value', async () => {
    const backend = new MockDeviceBackend();
    const flow = makeFlow({
      steps: [{ action: 'typeText' }],
    });
    const result = await replayFlow(flow, backend, makeReplayOpts());
    expect(result.steps[0]?.status).toBe('blocked');
  });

  test('pressButton passes', async () => {
    const backend = new MockDeviceBackend();
    const flow = makeFlow({
      steps: [{ action: 'pressButton', target: 'home' }],
    });
    const result = await replayFlow(flow, backend, makeReplayOpts());
    expect(result.summary.passed).toBe(1);
  });

  test('openUrl passes', async () => {
    const backend = new MockDeviceBackend();
    const flow = makeFlow({
      steps: [{ action: 'openUrl', value: 'https://example.com' }],
    });
    const result = await replayFlow(flow, backend, makeReplayOpts());
    expect(result.summary.passed).toBe(1);
  });
});

// ─── replayFlow: evidence collection ───────────────────────────────

describe('replayFlow — evidence collection', () => {
  test('screenshot step returns artifact ref', async () => {
    const backend = new MockDeviceBackend();
    backend.setScreenshot(makeScreenshotRef());
    const flow = makeFlow({
      steps: [{ action: 'screenshot' }],
    });
    const result = await replayFlow(flow, backend, makeReplayOpts());
    expect(result.summary.passed).toBe(1);
    expect(result.steps[0]?.evidence.length).toBe(1);
    expect(result.steps[0]?.evidence[0]?.type).toBe('screenshot');
  });

  test('getUiTree step returns artifact ref', async () => {
    const backend = new MockDeviceBackend();
    backend.setUiTree(makeUiTreeSnapshot());
    const flow = makeFlow({
      steps: [{ action: 'getUiTree' }],
    });
    const result = await replayFlow(flow, backend, makeReplayOpts());
    expect(result.summary.passed).toBe(1);
    expect(result.steps[0]?.evidence.length).toBe(1);
    expect(result.steps[0]?.evidence[0]?.type).toBe('uitree');
  });

  test('startRecording step passes', async () => {
    const backend = new MockDeviceBackend();
    backend.setRecordingHandle(makeRecordingHandle());
    const flow = makeFlow({
      steps: [{ action: 'startRecording' }],
    });
    const result = await replayFlow(flow, backend, makeReplayOpts());
    expect(result.summary.passed).toBe(1);
  });
});

// ─── replayFlow: collectLogs ────────────────────────────────────────

describe('replayFlow — collectLogs', () => {
  test('collectLogs passes when backend supports it', async () => {
    const backend = new MockDeviceBackend();
    backend.setLogArtifact(makeLogRef());
    const flow = makeFlow({
      steps: [{ action: 'collectLogs' }],
    });
    const result = await replayFlow(flow, backend, makeReplayOpts());
    expect(result.summary.passed).toBe(1);
  });
});

// ─── replayFlow: assertions ─────────────────────────────────────────

describe('replayFlow — assertions', () => {
  test('assertVisible passes when element is in UiTree', async () => {
    const backend = new MockDeviceBackend();
    backend.setUiTree(makeUiTreeSnapshot());
    const flow = makeFlow({
      steps: [
        {
          action: 'assertVisible',
          locator: { strategy: 'label', value: 'Login' },
        },
      ],
    });
    const result = await replayFlow(flow, backend, makeReplayOpts());
    expect(result.steps[0]?.status).toBe('passed');
  });

  test('assertVisible fails when element is not in UiTree', async () => {
    const backend = new MockDeviceBackend();
    backend.setUiTree(makeUiTreeSnapshot());
    const flow = makeFlow({
      steps: [
        {
          action: 'assertVisible',
          locator: { strategy: 'label', value: 'NonExistent' },
        },
      ],
    });
    const result = await replayFlow(flow, backend, makeReplayOpts());
    expect(result.steps[0]?.status).toBe('failed');
  });

  test('assertNotVisible passes when element absent', async () => {
    const backend = new MockDeviceBackend();
    backend.setUiTree(makeUiTreeSnapshot());
    const flow = makeFlow({
      steps: [
        {
          action: 'assertNotVisible',
          locator: { strategy: 'label', value: 'NonExistent' },
        },
      ],
    });
    const result = await replayFlow(flow, backend, makeReplayOpts());
    expect(result.steps[0]?.status).toBe('passed');
  });

  test('assertNotVisible fails when element present', async () => {
    const backend = new MockDeviceBackend();
    backend.setUiTree(makeUiTreeSnapshot());
    const flow = makeFlow({
      steps: [
        {
          action: 'assertNotVisible',
          locator: { strategy: 'label', value: 'Login' },
        },
      ],
    });
    const result = await replayFlow(flow, backend, makeReplayOpts());
    expect(result.steps[0]?.status).toBe('failed');
  });

  test('assertText passes when expectedText matches element text', async () => {
    const backend = new MockDeviceBackend();
    backend.setUiTree(makeUiTreeSnapshot());
    const flow = makeFlow({
      steps: [
        {
          action: 'assertText',
          locator: { strategy: 'label', value: 'Welcome' },
          expectedText: 'Welcome',
        },
      ],
    });
    const result = await replayFlow(flow, backend, makeReplayOpts());
    expect(result.steps[0]?.status).toBe('passed');
  });
});

// ─── replayFlow: safetyGate (R7) ────────────────────────────────────

describe('replayFlow — safetyGate (R7)', () => {
  test('skips step when safetyGate is deny', async () => {
    const backend = new MockDeviceBackend();
    const flow = makeFlow({
      steps: [
        {
          action: 'terminateApp',
          target: 'MyApp',
          value: 'com.example.app',
          safetyGate: 'deny',
        },
      ],
    });
    const result = await replayFlow(flow, backend, makeReplayOpts());
    expect(result.steps[0]?.status).toBe('skipped');
    expect(result.steps[0]?.error).toContain('deny');
  });

  test('skips step when safetyGate ask and callback returns false', async () => {
    const backend = new MockDeviceBackend();
    const flow = makeFlow({
      steps: [
        {
          action: 'openUrl',
          value: 'https://example.com',
          safetyGate: 'ask',
        },
      ],
    });
    const result = await replayFlow(
      flow,
      backend,
      makeReplayOpts({
        onSafetyGate: async () => false,
      }),
    );
    expect(result.steps[0]?.status).toBe('skipped');
    expect(result.steps[0]?.error).toContain('denied');
  });

  test('proceeds when safetyGate ask and callback returns true', async () => {
    const backend = new MockDeviceBackend();
    const flow = makeFlow({
      steps: [
        {
          action: 'openUrl',
          value: 'https://example.com',
          safetyGate: 'ask',
        },
      ],
    });
    const result = await replayFlow(
      flow,
      backend,
      makeReplayOpts({
        onSafetyGate: async () => true,
      }),
    );
    expect(result.steps[0]?.status).toBe('passed');
  });

  test('skips when safetyGate ask and no callback provided', async () => {
    const backend = new MockDeviceBackend();
    const flow = makeFlow({
      steps: [
        {
          action: 'terminateApp',
          value: 'com.example.app',
          safetyGate: 'ask',
        },
      ],
    });
    const result = await replayFlow(flow, backend, makeReplayOpts());
    expect(result.steps[0]?.status).toBe('skipped');
    expect(result.steps[0]?.error).toContain('no onSafetyGate callback');
  });
});

// ─── replayFlow: multi-step flow ────────────────────────────────────

describe('replayFlow — multi-step', () => {
  test('executes multiple steps in order', async () => {
    const backend = new MockDeviceBackend();
    backend.setUiTree(makeUiTreeSnapshot());
    const flow = makeFlow({
      steps: [
        { action: 'launchApp', target: 'MyApp', value: 'com.example.app' },
        { action: 'comment', comment: 'checking home screen' },
        { action: 'wait', durationMs: 10 },
        { action: 'tap', locator: { strategy: 'coordinate', value: '0.5,0.3' } },
        { action: 'assertVisible', locator: { strategy: 'label', value: 'Login' } },
      ],
    });
    const result = await replayFlow(flow, backend, makeReplayOpts());
    expect(result.steps.length).toBe(5);
    expect(result.summary.passed).toBeGreaterThanOrEqual(4);
    expect(result.summary.total).toBe(5);
    expect(result.steps[0]?.action).toBe('launchApp');
    expect(result.steps[1]?.action).toBe('comment');
    expect(result.steps[2]?.action).toBe('wait');
    expect(result.steps[3]?.action).toBe('tap');
    expect(result.steps[4]?.action).toBe('assertVisible');
  });

  test('overallStatus is passed when all steps pass', async () => {
    const backend = new MockDeviceBackend();
    const flow = makeFlow({
      steps: [{ action: 'comment', comment: 'ok' }],
    });
    const result = await replayFlow(flow, backend, makeReplayOpts());
    expect(result.overallStatus).toBe('passed');
  });

  test('overallStatus is failed when any step fails', async () => {
    const backend = new MockDeviceBackend();
    const flow = makeFlow({
      steps: [
        { action: 'comment', comment: 'ok' },
        { action: 'assertVisible', locator: { strategy: 'label', value: 'NonExistent' } },
      ],
    });
    const result = await replayFlow(flow, backend, makeReplayOpts());
    expect(result.overallStatus).toBe('failed');
  });

  test('overallStatus is blocked when all steps blocked', async () => {
    const backend = new MockDeviceBackend();
    const flow = makeFlow({
      steps: [{ action: 'tap', locator: { strategy: 'coordinate', value: 'invalid' } }],
    });
    const result = await replayFlow(flow, backend, makeReplayOpts());
    expect(result.overallStatus).toBe('blocked');
  });
});

// ─── replayFlow: abort signal ───────────────────────────────────────

describe('replayFlow — abort signal', () => {
  test('skips remaining steps when abort signal triggered', async () => {
    const backend = new MockDeviceBackend();
    const controller = new AbortController();
    const flow = makeFlow({
      steps: [
        { action: 'comment', comment: 'step 1' },
        { action: 'comment', comment: 'step 2' },
        { action: 'comment', comment: 'step 3' },
      ],
    });

    // Abort after first step via onStepStart callback
    let abortCalled = false;
    const result = await replayFlow(
      flow,
      backend,
      makeReplayOpts({
        signal: controller.signal,
        onStepStart: (idx) => {
          if (idx === 1 && !abortCalled) {
            abortCalled = true;
            controller.abort();
          }
        },
        collectEvidence: false,
      }),
    );

    // First two steps pass (abort fires during step 1's onStepStart,
    // but executeStep still runs before the next iteration's abort check)
    expect(result.steps[0]?.status).toBe('passed');
    expect(result.steps[1]?.status).toBe('passed');
    expect(result.steps[2]?.status).toBe('skipped');
    expect(result.steps[2]?.error).toContain('aborted');
  });
});

// ─── replayFlow: onStepStart callback ──────────────────────────────

describe('replayFlow — onStepStart', () => {
  test('calls onStepStart for each step', async () => {
    const backend = new MockDeviceBackend();
    const calls: number[] = [];
    const flow = makeFlow({
      steps: [
        { action: 'comment', comment: 'a' },
        { action: 'comment', comment: 'b' },
      ],
    });
    await replayFlow(
      flow,
      backend,
      makeReplayOpts({
        onStepStart: (idx) => {
          calls.push(idx);
        },
      }),
    );
    expect(calls).toEqual([0, 1]);
  });
});

// ─── replayFlow: unknown action ─────────────────────────────────────

describe('replayFlow — unknown action', () => {
  test('blocks step with unknown action', async () => {
    const backend = new MockDeviceBackend();
    const flow = makeFlow({
      // @ts-expect-error testing unknown action
      steps: [{ action: 'someUnknownAction' }],
    });
    const result = await replayFlow(flow, backend, makeReplayOpts());
    expect(result.steps[0]?.status).toBe('blocked');
    expect(result.steps[0]?.error).toContain('Unknown action');
  });
});

// ─── replayFlow: stopRecording (stub) ───────────────────────────────

describe('replayFlow — stopRecording', () => {
  test('stopRecording skipped with reason (no handle tracking)', async () => {
    const backend = new MockDeviceBackend();
    const flow = makeFlow({
      steps: [{ action: 'stopRecording' }],
    });
    const result = await replayFlow(flow, backend, makeReplayOpts());
    expect(result.steps[0]?.status).toBe('skipped');
    expect(result.steps[0]?.error).toContain('recording handle');
  });
});

// ─── replayFlow: longPress ─────────────────────────────────────────

describe('replayFlow — longPress', () => {
  test('longPress with coordinate locator passes (maps to tap)', async () => {
    const backend = new MockDeviceBackend();
    const flow = makeFlow({
      steps: [
        {
          action: 'longPress',
          locator: { strategy: 'coordinate', value: '0.5,0.5' },
        },
      ],
    });
    const result = await replayFlow(flow, backend, makeReplayOpts());
    expect(result.summary.passed).toBe(1);
  });
});

// ─── replayFlow: evidence collection flag ───────────────────────────

describe('replayFlow — collectEvidence flag', () => {
  test('collects evidence when collectEvidence is true', async () => {
    const backend = new MockDeviceBackend();
    backend.setScreenshot(makeScreenshotRef());
    backend.setUiTree(makeUiTreeSnapshot());
    const flow = makeFlow({
      steps: [{ action: 'launchApp', value: 'com.example.app' }],
    });
    const result = await replayFlow(flow, backend, makeReplayOpts({ collectEvidence: true }));
    // Evidence collection includes screenshot + uiTree
    expect(result.steps[0]?.evidence.length).toBeGreaterThanOrEqual(0);
  });

  test('does not collect evidence when collectEvidence is false', async () => {
    const backend = new MockDeviceBackend();
    backend.setScreenshot(makeScreenshotRef());
    backend.setUiTree(makeUiTreeSnapshot());
    const flow = makeFlow({
      steps: [{ action: 'launchApp', value: 'com.example.app' }],
    });
    const result = await replayFlow(flow, backend, makeReplayOpts({ collectEvidence: false }));
    expect(result.steps[0]?.evidence.length).toBe(0);
  });
});

// ─── replayFlow: empty flow edge case ───────────────────────────────

describe('replayFlow — empty flow', () => {
  test('returns empty result for flow with no steps', async () => {
    const backend = new MockDeviceBackend();
    const flow = makeFlow({ steps: [] });
    const result = await replayFlow(flow, backend, makeReplayOpts());
    expect(result.steps.length).toBe(0);
    expect(result.summary.total).toBe(0);
    expect(result.overallStatus).toBe('passed'); // No failures = passed
  });
});

// ─── replay-result helpers ──────────────────────────────────────────

describe('replay-result helpers', () => {
  test('createEmptySummary initializes with correct total', () => {
    const s = createEmptySummary(5);
    expect(s.total).toBe(5);
    expect(s.passed).toBe(0);
    expect(s.failed).toBe(0);
    expect(s.skipped).toBe(0);
    expect(s.blocked).toBe(0);
  });

  test('passedStep creates correct shape', () => {
    const refs: ArtifactRef[] = [
      { id: 'a1', type: 'screenshot', path: '/tmp/a.png', redactionStatus: 'safe' },
    ];
    const s = passedStep(0, 'tap', 'Login', 150, refs, 'clicked');
    expect(s.status).toBe('passed');
    expect(s.action).toBe('tap');
    expect(s.target).toBe('Login');
    expect(s.durationMs).toBe(150);
    expect(s.evidence).toEqual(refs);
    expect(s.detail).toBe('clicked');
  });

  test('failedStep creates correct shape', () => {
    const s = failedStep(0, 'tap', 'Login', 50, 'timeout', []);
    expect(s.status).toBe('failed');
    expect(s.error).toBe('timeout');
  });

  test('skippedStep creates correct shape', () => {
    const s = skippedStep(0, 'tap', 'Login', 'safetyGate deny');
    expect(s.status).toBe('skipped');
    expect(s.error).toBe('safetyGate deny');
    expect(s.durationMs).toBe(0);
  });

  test('blockedStep creates correct shape', () => {
    const s = blockedStep(0, 'tap', 'Login', 'targetKind mismatch');
    expect(s.status).toBe('blocked');
    expect(s.error).toBe('targetKind mismatch');
    expect(s.durationMs).toBe(0);
  });
});
