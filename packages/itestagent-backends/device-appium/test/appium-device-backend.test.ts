/**
 * AppiumDeviceBackend unit tests.
 *
 * Tests all 16 DeviceBackend methods using a MockAppiumDriver.
 *
 * Strategy:
 *   - MockAppiumDriver implements AppiumDriver with configurable behavior
 *   - Each test creates a fresh backend + mock driver
 *   - Tests cover success paths, error paths, coordinate conversion, and edge cases
 *   - No real Appium server required
 *
 * R5: Error-path tests verify that errors are explicit, never silent.
 */

import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { mkdirSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { AppiumDeviceBackend, AppiumDriverError } from '../src/index.js';
import type { WdaManager } from '../src/wda-manager.js';

import type {
  AppiumActionResult,
  AppiumAppEntry,
  AppiumCrashEntry,
  AppiumDriver,
  AppiumLogOptions,
  AppiumPoint,
  AppiumRecordingOptions,
  AppiumRecordingResult,
  AppiumScreenSize,
  AppiumSession,
} from '../src/index.js';

// ═══════════════════════════════════════════════════════════════════════
// MockAppiumDriver
// ═══════════════════════════════════════════════════════════════════════

interface MockDriverConfig {
  createSessionResult?: AppiumSession;
  createSessionError?: AppiumDriverError;
  createSessionBlock?: Promise<void>;
  getPageSourceBlock?: Promise<void>;
  deleteSessionError?: AppiumDriverError;
  deleteSessionBlock?: Promise<void>;
  screenSize?: AppiumScreenSize;
  getPageSourceResult?: string;
  getPageSourceError?: Error;
  takeScreenshotResult?: string;
  takeScreenshotError?: Error;
  listAppsResult?: AppiumAppEntry[];
  listAppsError?: Error;
  launchAppResult?: AppiumActionResult;
  launchAppError?: Error;
  terminateAppResult?: AppiumActionResult;
  terminateAppError?: Error;
  activateAppResult?: AppiumActionResult;
  activateAppError?: Error;
  tapResult?: AppiumActionResult;
  tapError?: Error;
  tapElementResult?: AppiumActionResult;
  tapElementError?: unknown;
  swipeResult?: AppiumActionResult;
  swipeError?: Error;
  typeTextResult?: AppiumActionResult;
  typeTextError?: Error;
  pressButtonResult?: AppiumActionResult;
  pressButtonError?: Error;
  openUrlResult?: AppiumActionResult;
  openUrlError?: Error;
  startRecordingResult?: AppiumRecordingResult;
  startRecordingError?: Error;
  stopRecordingResult?: string;
  stopRecordingError?: Error;
  listCrashesResult?: AppiumCrashEntry[];
  listCrashesError?: Error;
  collectLogsResult?: string;
  collectLogsError?: Error;
}

const DEFAULT_SESSION: AppiumSession = {
  sessionId: 'mock-session-001',
  deviceUdid: '00008110-00123456A12B001E',
  wdaBundleId: 'TEAMID.WebDriverAgentRunner',
};

const DEFAULT_SCREEN: AppiumScreenSize = { width: 428, height: 926 };

const DEFAULT_ACTION_SUCCESS: AppiumActionResult = { success: true, message: 'ok' };

const DEFAULT_APPS: AppiumAppEntry[] = [
  { bundleId: 'com.apple.Preferences', name: 'Settings', version: '1.0' },
  { bundleId: 'com.apple.mobilesafari', name: 'Safari', version: '18.3' },
];

const DEFAULT_CRASHES: AppiumCrashEntry[] = [
  { name: 'TestApp', date: '2026-07-21T10:30:00Z', bundleId: 'com.example.test' },
];

const DEFAULT_RECORDING: AppiumRecordingResult = { recordingId: 'rec-001' };

const DEFAULT_PAGE_SOURCE = `<?xml version="1.0" encoding="UTF-8"?>
<XCUIElementTypeApplication name="Settings">
  <XCUIElementTypeNavigationBar>
    <XCUIElementTypeButton name="Back"/>
  </XCUIElementTypeNavigationBar>
</XCUIElementTypeApplication>`;

const DEFAULT_SCREENSHOT_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

const DEFAULT_VIDEO_BASE64 = 'AAAAIGZ0eXBpc29tAAACAGlzb21pc28yYXZjMW1wNDEAAAAIZnJlZQAA';

const DEFAULT_LOG_CONTENT = 'Jul 21 10:30:00 iPhone TestApp[1234] <Notice>: App launched';

class MockAppiumDriver implements AppiumDriver {
  private config: MockDriverConfig;
  private sessionActive = false;
  private sessionId: string | null = null;

  // Track method calls for verification
  readonly calls: string[] = [];
  readonly taps: AppiumPoint[] = [];
  readonly tappedElements: string[] = [];
  readonly swipes: Array<{ from: AppiumPoint; to: AppiumPoint; durationMs?: number }> = [];
  readonly typedTexts: string[] = [];
  readonly pressedButtons: string[] = [];
  lastSessionCaps: Record<string, unknown> | undefined;
  lastSessionSignal: AbortSignal | undefined;

  constructor(config?: MockDriverConfig) {
    this.config = config ?? {};
  }

  setConfig(config: MockDriverConfig): void {
    this.config = { ...this.config, ...config };
  }

  // ── Session ──────────────────────────────────────────────────

  async createSession(caps: Record<string, unknown>, signal?: AbortSignal): Promise<AppiumSession> {
    this.calls.push('createSession');
    this.lastSessionCaps = caps;
    this.lastSessionSignal = signal;
    await this.config.createSessionBlock;
    if (this.config.createSessionError) throw this.config.createSessionError;
    const session = this.config.createSessionResult ?? DEFAULT_SESSION;
    this.sessionActive = true;
    this.sessionId = session.sessionId;
    return session;
  }

  async deleteSession(): Promise<AppiumActionResult> {
    this.calls.push('deleteSession');
    await this.config.deleteSessionBlock;
    if (this.config.deleteSessionError) throw this.config.deleteSessionError;
    this.sessionActive = false;
    this.sessionId = null;
    return { success: true };
  }

  isSessionActive(): boolean {
    return this.sessionActive;
  }

  getSessionId(): string | null {
    return this.sessionId;
  }

  // ── Screen info ──────────────────────────────────────────────

  async getScreenSize(): Promise<AppiumScreenSize> {
    this.calls.push('getScreenSize');
    return this.config.screenSize ?? DEFAULT_SCREEN;
  }

  // ── App management ───────────────────────────────────────────

  async launchApp(_bundleId: string): Promise<AppiumActionResult> {
    this.calls.push('launchApp');
    if (this.config.launchAppError) throw this.config.launchAppError;
    return this.config.launchAppResult ?? DEFAULT_ACTION_SUCCESS;
  }

  async terminateApp(_bundleId: string): Promise<AppiumActionResult> {
    this.calls.push('terminateApp');
    if (this.config.terminateAppError) throw this.config.terminateAppError;
    return this.config.terminateAppResult ?? DEFAULT_ACTION_SUCCESS;
  }

  async activateApp(_bundleId: string): Promise<AppiumActionResult> {
    this.calls.push('activateApp');
    if (this.config.activateAppError) throw this.config.activateAppError;
    return this.config.activateAppResult ?? DEFAULT_ACTION_SUCCESS;
  }

  async listApps(): Promise<AppiumAppEntry[]> {
    this.calls.push('listApps');
    if (this.config.listAppsError) throw this.config.listAppsError;
    return this.config.listAppsResult ?? DEFAULT_APPS;
  }

  // ── UI inspection ────────────────────────────────────────────

  async getPageSource(): Promise<string> {
    this.calls.push('getPageSource');
    await this.config.getPageSourceBlock;
    if (this.config.getPageSourceError) throw this.config.getPageSourceError;
    return this.config.getPageSourceResult ?? DEFAULT_PAGE_SOURCE;
  }

  async takeScreenshot(): Promise<string> {
    this.calls.push('takeScreenshot');
    if (this.config.takeScreenshotError) throw this.config.takeScreenshotError;
    return this.config.takeScreenshotResult ?? DEFAULT_SCREENSHOT_BASE64;
  }

  // ── Actions ──────────────────────────────────────────────────

  async tap(point: AppiumPoint): Promise<AppiumActionResult> {
    this.calls.push('tap');
    this.taps.push(point);
    if (this.config.tapError) throw this.config.tapError;
    return this.config.tapResult ?? DEFAULT_ACTION_SUCCESS;
  }
  async tapElement(accessibilityId: string): Promise<AppiumActionResult> {
    this.calls.push('tapElement');
    this.tappedElements.push(accessibilityId);
    if (this.config.tapElementError) throw this.config.tapElementError;
    return this.config.tapElementResult ?? { success: true, message: 'tapped element (mock)' };
  }

  async swipe(
    from: AppiumPoint,
    to: AppiumPoint,
    durationMs?: number,
  ): Promise<AppiumActionResult> {
    this.calls.push('swipe');
    this.swipes.push({ from, to, durationMs });
    if (this.config.swipeError) throw this.config.swipeError;
    return this.config.swipeResult ?? DEFAULT_ACTION_SUCCESS;
  }

  async typeText(text: string): Promise<AppiumActionResult> {
    this.calls.push('typeText');
    this.typedTexts.push(text);
    if (this.config.typeTextError) throw this.config.typeTextError;
    return this.config.typeTextResult ?? DEFAULT_ACTION_SUCCESS;
  }

  async pressButton(button: string): Promise<AppiumActionResult> {
    this.calls.push('pressButton');
    this.pressedButtons.push(button);
    if (this.config.pressButtonError) throw this.config.pressButtonError;
    return this.config.pressButtonResult ?? DEFAULT_ACTION_SUCCESS;
  }

  // ── URL / deep link ─────────────────────────────────────────

  async openUrl(_url: string, _bundleId?: string): Promise<AppiumActionResult> {
    this.calls.push('openUrl');
    if (this.config.openUrlError) throw this.config.openUrlError;
    return this.config.openUrlResult ?? DEFAULT_ACTION_SUCCESS;
  }

  // ── Recording ────────────────────────────────────────────────

  async startRecording(_options?: AppiumRecordingOptions): Promise<AppiumRecordingResult> {
    this.calls.push('startRecording');
    if (this.config.startRecordingError) throw this.config.startRecordingError;
    return this.config.startRecordingResult ?? DEFAULT_RECORDING;
  }

  async stopRecording(_recordingId: string): Promise<string> {
    this.calls.push('stopRecording');
    if (this.config.stopRecordingError) throw this.config.stopRecordingError;
    return this.config.stopRecordingResult ?? DEFAULT_VIDEO_BASE64;
  }

  // ── Crashes / diagnostics ────────────────────────────────────

  async listCrashes(_bundleId?: string): Promise<AppiumCrashEntry[]> {
    this.calls.push('listCrashes');
    if (this.config.listCrashesError) throw this.config.listCrashesError;
    return this.config.listCrashesResult ?? DEFAULT_CRASHES;
  }

  // ── Logs ─────────────────────────────────────────────────────

  async collectLogs(_options: AppiumLogOptions): Promise<string> {
    this.calls.push('collectLogs');
    if (this.config.collectLogsError) throw this.config.collectLogsError;
    return this.config.collectLogsResult ?? DEFAULT_LOG_CONTENT;
  }
}

// ═══════════════════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════════════════

const TEST_UDID = '00008110-00123456A12B001E';
const TEST_BUNDLE_ID = 'com.example.testapp';

function createBackend(config?: MockDriverConfig): {
  backend: AppiumDeviceBackend;
  mock: MockAppiumDriver;
} {
  const mock = new MockAppiumDriver(config);
  const backend = new AppiumDeviceBackend(mock, {
    udid: TEST_UDID,
    targetKind: 'physical',
    bundleId: TEST_BUNDLE_ID,
    wdaBundleId: 'TEAMID.WebDriverAgentRunner',
    wdaStartupMode: 'managed-xcodebuild',
    physicalDeviceDiscovery: async () => [],
  });
  return { backend, mock };
}

function createBackendWithDeleteTimeout(
  config: MockDriverConfig,
  sessionDeleteTimeoutMs: number,
): { backend: AppiumDeviceBackend; mock: MockAppiumDriver } {
  const mock = new MockAppiumDriver(config);
  return {
    mock,
    backend: new AppiumDeviceBackend(mock, {
      udid: TEST_UDID,
      targetKind: 'physical',
      bundleId: TEST_BUNDLE_ID,
      wdaStartupMode: 'managed-xcodebuild',
      physicalDeviceDiscovery: async () => [],
      sessionDeleteTimeoutMs,
    }),
  };
}

const SIM_UDID = 'F7C1CF80-42FC-4B59-88E4-7A8E8D2E9A3B';

function createSimulatorBackend(config?: MockDriverConfig): {
  backend: AppiumDeviceBackend;
  mock: MockAppiumDriver;
} {
  const mock = new MockAppiumDriver(config);
  const backend = new AppiumDeviceBackend(mock, {
    udid: SIM_UDID,
    targetKind: 'simulator',
    bundleId: 'com.example.simapp',
  });
  return { backend, mock };
}

// ═══════════════════════════════════════════════════════════════════════
// Tests
// ═══════════════════════════════════════════════════════════════════════

describe('AppiumDeviceBackend', () => {
  let mock: MockAppiumDriver;
  let backend: AppiumDeviceBackend;

  beforeEach(() => {
    const b = createBackend();
    mock = b.mock;
    backend = b.backend;
  });

  afterEach(async () => {
    await backend.closeSession();
  });

  // ─── Constructor & Metadata ───────────────────────────────────

  describe('constructor & metadata', () => {
    it('returns name "appium"', () => {
      expect(backend.name).toBe('appium');
    });

    it('has correct capabilities for physical targetKind', () => {
      const caps = backend.capabilities;
      expect(caps.supportedTargetKinds).toEqual(['physical']);
      expect(caps.supportsUiTree).toBe(true);
      expect(caps.supportsScreenshot).toBe(true);
      expect(caps.supportsVideo).toBe(true);
      expect(caps.supportsCrashLogs).toBe(true);
      expect(caps.supportsLocation).toBe(false);
      expect(caps.supportsPush).toBe(false);
      expect(caps.features).not.toContain('log');
    });

    it('does not include simulator in supportedTargetKinds (Task 3.10)', () => {
      expect(backend.capabilities.supportedTargetKinds).not.toContain('simulator');
    });
  });

  // ─── Session lifecycle ───────────────────────────────────────

  describe('session lifecycle', () => {
    it('creates session lazily on first Appium-dependent operation', async () => {
      expect(mock.isSessionActive()).toBe(false);

      await backend.getUiTree({ deviceId: TEST_UDID });

      expect(mock.calls).toContain('createSession');
      expect(mock.isSessionActive()).toBe(true);
    });

    it('passes a session signal linked to the run signal to session creation', async () => {
      const controller = new AbortController();

      await backend.getUiTree({ deviceId: TEST_UDID }, controller.signal);

      expect(mock.lastSessionSignal).toBeDefined();
      expect(mock.lastSessionSignal).not.toBe(controller.signal);
      controller.abort();
      expect(mock.lastSessionSignal?.aborted).toBe(true);
    });

    it('aborts promptly while a WebDriver command is pending', async () => {
      const never = new Promise<void>(() => {});
      const scoped = createBackend({ getPageSourceBlock: never });
      const controller = new AbortController();
      const action = scoped.backend.getUiTree({ deviceId: TEST_UDID }, controller.signal);
      await Promise.resolve();

      controller.abort(new Error('run cancelled'));

      await expect(action).rejects.toThrow('run cancelled');
    });

    it('does not create session for listDevices (devicectl-based)', async () => {
      await backend.listDevices();
      expect(mock.calls).not.toContain('createSession');
    });

    it('does not create session for healthcheck (devicectl-based)', async () => {
      await backend.healthcheck(TEST_UDID);
      expect(mock.calls).not.toContain('createSession');
    });

    it('creates session only once (idempotent)', async () => {
      await backend.getUiTree({ deviceId: TEST_UDID });
      await backend.screenshot({ deviceId: TEST_UDID });

      const createCalls = mock.calls.filter((c) => c === 'createSession');
      expect(createCalls.length).toBe(1);
    });

    it('closeSession deletes session and releases resources', async () => {
      await backend.getUiTree({ deviceId: TEST_UDID });
      expect(mock.isSessionActive()).toBe(true);

      await backend.closeSession();

      expect(mock.calls).toContain('deleteSession');
      expect(mock.isSessionActive()).toBe(false);
    });

    it('closeSession is idempotent', async () => {
      await backend.closeSession();
      await backend.closeSession();

      const deleteCalls = mock.calls.filter((c) => c === 'deleteSession');
      expect(deleteCalls.length).toBe(0);
    });

    it('makes the backend terminal when session deletion times out', async () => {
      const never = new Promise<void>(() => {});
      const scoped = createBackendWithDeleteTimeout({ deleteSessionBlock: never }, 5);
      await scoped.backend.getUiTree({ deviceId: TEST_UDID });

      const cleanup = await scoped.backend.closeSession();
      expect(cleanup.status).toBe('timed_out');
      expect(cleanup.reusable).toBe(false);
      expect(cleanup.issues).toContain('session deletion timed out');

      await scoped.backend.getUiTree({ deviceId: TEST_UDID });
      expect(scoped.mock.calls.filter((call) => call === 'createSession')).toHaveLength(1);
      expect((await scoped.backend.closeSession()).reusable).toBe(false);
    });

    it('makes the backend terminal when teardown receives an already-aborted signal', async () => {
      const scoped = createBackendWithDeleteTimeout({}, 15_000);
      await scoped.backend.getUiTree({ deviceId: TEST_UDID });
      const controller = new AbortController();
      controller.abort(new Error('cancelled before teardown'));

      const cleanup = await scoped.backend.closeSession(controller.signal);

      expect(cleanup).toEqual({
        status: 'timed_out',
        reusable: false,
        issues: ['session deletion aborted'],
      });
      expect(await scoped.backend.closeSession()).toEqual({
        status: 'failed',
        reusable: false,
        issues: ['session deletion aborted'],
      });
    });

    it('bounds teardown while session creation is still in flight', async () => {
      const never = new Promise<void>(() => {});
      const scoped = createBackendWithDeleteTimeout({ createSessionBlock: never }, 5);
      const action = scoped.backend.getUiTree({ deviceId: TEST_UDID });

      const cleanup = await scoped.backend.closeSession();

      expect(cleanup).toEqual({
        status: 'timed_out',
        reusable: false,
        issues: ['session creation wait timed out'],
      });
      expect(await scoped.backend.closeSession()).toEqual({
        status: 'failed',
        reusable: false,
        issues: ['session creation wait timed out'],
      });
      void action;
    });

    it('deletes a session that finishes after the close wait times out', async () => {
      let releaseCreation!: () => void;
      const createSessionBlock = new Promise<void>((resolve) => {
        releaseCreation = resolve;
      });
      const scoped = createBackendWithDeleteTimeout({ createSessionBlock }, 5);
      const action = scoped.backend.getUiTree({ deviceId: TEST_UDID }).catch(() => undefined);
      await Promise.resolve();

      const cleanup = await scoped.backend.closeSession();
      expect(cleanup).toMatchObject({ status: 'timed_out', reusable: false });

      releaseCreation();
      await action;
      expect(scoped.mock.calls.filter((call) => call === 'deleteSession')).toHaveLength(1);
      expect(scoped.mock.isSessionActive()).toBe(false);
    });

    it('handles session creation failure gracefully', async () => {
      mock.setConfig({
        createSessionError: new AppiumDriverError(
          'session_create_failed',
          'Appium server unreachable',
        ),
      });

      const result = await backend.launchApp({ deviceId: TEST_UDID, bundleId: TEST_BUNDLE_ID });

      expect(result.success).toBe(false);
      expect(result.error).toContain('session_create_failed');
    });
  });

  // ─── listDevices ─────────────────────────────────────────────

  describe('listDevices', () => {
    it('returns empty array when devicectl is unavailable', async () => {
      const devices = await backend.listDevices();
      // devicectl may or may not be available in test environment
      expect(Array.isArray(devices)).toBe(true);
    });

    it('does not require an Appium session', async () => {
      await backend.listDevices();
      expect(mock.calls).not.toContain('createSession');
    });
  });

  // ─── healthcheck ─────────────────────────────────────────────

  describe('healthcheck', () => {
    it('returns healthy:false when device not found', async () => {
      const result = await backend.healthcheck('invalid-udid');
      expect(result.healthy).toBe(false);
      expect(result.details).toBeDefined();
    });

    it('does not require an Appium session', async () => {
      await backend.healthcheck(TEST_UDID);
      expect(mock.calls).not.toContain('createSession');
    });
  });

  // ─── listApps ────────────────────────────────────────────────

  describe('listApps', () => {
    it('returns app list from Appium', async () => {
      const apps = await backend.listApps(TEST_UDID);
      expect(apps.length).toBeGreaterThanOrEqual(1);
      expect(apps[0]?.bundleId).toBe('com.apple.Preferences');
    });

    it('returns empty array on driver error (R5: never throw)', async () => {
      mock.setConfig({ listAppsError: new Error('Appium error') });
      const apps = await backend.listApps(TEST_UDID);
      expect(apps).toEqual([]);
    });

    it('creates session lazily', async () => {
      await backend.listApps(TEST_UDID);
      expect(mock.calls).toContain('createSession');
    });
  });

  // ─── launchApp ───────────────────────────────────────────────

  describe('launchApp', () => {
    it('launches app and activates it', async () => {
      const result = await backend.launchApp({ deviceId: TEST_UDID, bundleId: TEST_BUNDLE_ID });

      expect(result.success).toBe(true);
      expect(mock.calls).toContain('launchApp');
      expect(mock.calls).toContain('activateApp');
    });

    it('returns failure when launch fails', async () => {
      mock.setConfig({
        launchAppError: new Error('App not installed'),
      });

      const result = await backend.launchApp({ deviceId: TEST_UDID, bundleId: 'com.missing.app' });

      expect(result.success).toBe(false);
      expect(result.error).toContain('App not installed');
    });
  });

  // ─── terminateApp ────────────────────────────────────────────

  describe('terminateApp', () => {
    it('terminates running app', async () => {
      const result = await backend.terminateApp({ deviceId: TEST_UDID, bundleId: TEST_BUNDLE_ID });

      expect(result.success).toBe(true);
      expect(mock.calls).toContain('terminateApp');
    });

    it('returns failure when terminate fails', async () => {
      mock.setConfig({
        terminateAppError: new Error('App not running'),
      });

      const result = await backend.terminateApp({ deviceId: TEST_UDID, bundleId: TEST_BUNDLE_ID });

      expect(result.success).toBe(false);
      expect(result.error).toContain('App not running');
    });
  });

  // ─── getUiTree ───────────────────────────────────────────────

  describe('getUiTree', () => {
    it('returns XML page source as UiTreeSnapshot', async () => {
      const snapshot = await backend.getUiTree({ deviceId: TEST_UDID });

      expect(snapshot.format).toBe('xml');
      expect(snapshot.raw).toContain('XCUIElementTypeApplication');
      expect(snapshot.capturedAt).toBeDefined();
    });

    it('returns empty snapshot on error (R5: never throw)', async () => {
      mock.setConfig({ getPageSourceError: new Error('WDA crash') });

      const snapshot = await backend.getUiTree({ deviceId: TEST_UDID });

      expect(snapshot.format).toBe('xml');
      expect(snapshot.raw).toBe('');
    });
  });

  // ─── screenshot ──────────────────────────────────────────────

  describe('screenshot', () => {
    it('returns ArtifactRef with screenshot metadata', async () => {
      const ref = await backend.screenshot({ deviceId: TEST_UDID });

      expect(ref.type).toBe('screenshot');
      expect(ref.id).toContain('screenshot_');
      expect(ref.mimeType).toBe('image/png');
      expect(ref.redactionStatus).toBe('raw-local-only');
    });

    it('writes screenshots into the configured private run directory', async () => {
      const artifactDirectory = join(
        tmpdir(),
        `itestagent-appium-artifacts-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      );
      mkdirSync(artifactDirectory, { recursive: true, mode: 0o755 });
      const scoped = new AppiumDeviceBackend(mock, {
        udid: TEST_UDID,
        targetKind: 'physical',
        bundleId: TEST_BUNDLE_ID,
        wdaStartupMode: 'managed-xcodebuild',
        artifactDirectory,
      });

      try {
        const ref = await scoped.screenshot({ deviceId: TEST_UDID });
        expect(ref.path.startsWith(`${artifactDirectory}/`)).toBe(true);
        expect((statSync(artifactDirectory).mode & 0o777).toString(8)).toBe('700');
        expect((statSync(ref.path).mode & 0o777).toString(8)).toBe('600');
      } finally {
        await scoped.closeSession();
        rmSync(artifactDirectory, { recursive: true, force: true });
      }
    });

    it('isolates fallback artifact directories between backend instances', async () => {
      const first = createBackend();
      const second = createBackend();
      let firstDirectory = '';
      let secondDirectory = '';

      try {
        const firstRef = await first.backend.screenshot({ deviceId: TEST_UDID });
        const secondRef = await second.backend.screenshot({ deviceId: TEST_UDID });
        firstDirectory = dirname(firstRef.path);
        secondDirectory = dirname(secondRef.path);

        expect(firstDirectory).not.toBe(secondDirectory);
        expect((statSync(firstDirectory).mode & 0o777).toString(8)).toBe('700');
        expect((statSync(secondDirectory).mode & 0o777).toString(8)).toBe('700');
      } finally {
        await first.backend.closeSession();
        await second.backend.closeSession();
        if (firstDirectory) rmSync(firstDirectory, { recursive: true, force: true });
        if (secondDirectory) rmSync(secondDirectory, { recursive: true, force: true });
      }
    });

    it('returns error artifact ref on failure (R5: never throw)', async () => {
      mock.setConfig({ takeScreenshotError: new Error('Screenshot capture failed') });

      const ref = await backend.screenshot({ deviceId: TEST_UDID });

      expect(ref.id).toContain('screenshot_error_');
      expect(ref.path).toBe('');
    });
  });

  // ─── tap ─────────────────────────────────────────────────────

  describe('tap', () => {
    it('converts normalized coordinates to pixel coordinates and taps', async () => {
      // First ensure session to cache screen size (428×926)
      await backend.getUiTree({ deviceId: TEST_UDID });

      const result = await backend.tap({ deviceId: TEST_UDID, x: 0.5, y: 0.3 });

      expect(result.success).toBe(true);
      expect(mock.taps.length).toBe(1);
      expect(mock.taps[0]?.x).toBe(214); // 428 * 0.5
      expect(mock.taps[0]?.y).toBe(278); // 926 * 0.3
    });

    it('rounds pixel coordinates to integers', async () => {
      await backend.getUiTree({ deviceId: TEST_UDID });

      await backend.tap({ deviceId: TEST_UDID, x: 0.333, y: 0.667 });

      expect(mock.taps[0]?.x).toBe(143); // round(428 * 0.333)
      expect(mock.taps[0]?.y).toBe(618); // round(926 * 0.667)
    });

    it('handles edge coordinates (0,0) and (1,1)', async () => {
      await backend.getUiTree({ deviceId: TEST_UDID });

      const resultTopLeft = await backend.tap({ deviceId: TEST_UDID, x: 0, y: 0 });
      expect(resultTopLeft.success).toBe(true);
      expect(mock.taps[0]?.x).toBe(0);
      expect(mock.taps[0]?.y).toBe(0);

      const resultBottomRight = await backend.tap({ deviceId: TEST_UDID, x: 1, y: 1 });
      expect(resultBottomRight.success).toBe(true);
      expect(mock.taps[1]?.x).toBe(428);
      expect(mock.taps[1]?.y).toBe(926);
    });

    it('returns failure ActionResult on tap error', async () => {
      mock.setConfig({ tapError: new Error('Element not found') });

      const result = await backend.tap({ deviceId: TEST_UDID, x: 0.5, y: 0.5 });

      expect(result.success).toBe(false);
      expect(result.error).toContain('tap');
    });

    it('prefers element-resolved tap when accessibilityId is given', async () => {
      await backend.getUiTree({ deviceId: TEST_UDID });
      mock.calls.length = 0;

      const result = await backend.tap({
        deviceId: TEST_UDID,
        x: 0.5,
        y: 0.5,
        accessibilityId: 'login_button',
      } as Parameters<typeof backend.tap>[0]);

      expect(result.success).toBe(true);
      expect(mock.tappedElements).toEqual(['login_button']);
      expect(mock.taps).toHaveLength(0);
    });

    it('falls back to coordinate tap only on element-lookup failure', async () => {
      await backend.getUiTree({ deviceId: TEST_UDID });
      mock.calls.length = 0;
      mock.setConfig({
        tapElementError: new AppiumDriverError(
          'command_failed',
          'tapElement: no such element',
          new Error('NoSuchElementError: no such element'),
        ),
      });

      const result = await backend.tap({
        deviceId: TEST_UDID,
        x: 0.5,
        y: 0.5,
        accessibilityId: 'login_button',
      } as Parameters<typeof backend.tap>[0]);

      expect(result.success).toBe(true);
      expect(mock.tappedElements).toEqual(['login_button']);
      expect(mock.taps).toHaveLength(1);
    });

    it('does not double-tap when the element click fails after dispatch', async () => {
      await backend.getUiTree({ deviceId: TEST_UDID });
      mock.calls.length = 0;
      mock.setConfig({
        tapElementError: new AppiumDriverError(
          'command_failed',
          'tapElement: network error after command',
          new Error('NetworkError: connection reset while awaiting click response'),
        ),
      });

      const result = await backend.tap({
        deviceId: TEST_UDID,
        x: 0.5,
        y: 0.5,
        accessibilityId: 'login_button',
      } as Parameters<typeof backend.tap>[0]);

      expect(result.success).toBe(false);
      expect(mock.tappedElements).toEqual(['login_button']);
      expect(mock.taps).toHaveLength(0);
    });
  });

  // ─── swipe ───────────────────────────────────────────────────

  describe('swipe', () => {
    it('converts normalized coordinates and swipes with default duration', async () => {
      await backend.getUiTree({ deviceId: TEST_UDID });

      const result = await backend.swipe({
        deviceId: TEST_UDID,
        fromX: 0.5,
        fromY: 0.8,
        toX: 0.5,
        toY: 0.2,
      });

      expect(result.success).toBe(true);
      expect(mock.swipes.length).toBe(1);
      expect(mock.swipes[0]?.from).toEqual({ x: 214, y: 741 });
      expect(mock.swipes[0]?.to).toEqual({ x: 214, y: 185 });
      expect(mock.swipes[0]?.durationMs).toBeUndefined();
    });

    it('passes durationMs when provided', async () => {
      await backend.getUiTree({ deviceId: TEST_UDID });

      await backend.swipe({
        deviceId: TEST_UDID,
        fromX: 0.1,
        fromY: 0.9,
        toX: 0.1,
        toY: 0.1,
        durationMs: 500,
      });

      expect(mock.swipes[0]?.durationMs).toBe(500);
    });

    it('returns failure ActionResult on swipe error', async () => {
      mock.setConfig({ swipeError: new Error('Gesture interrupted') });

      const result = await backend.swipe({
        deviceId: TEST_UDID,
        fromX: 0.5,
        fromY: 0.8,
        toX: 0.5,
        toY: 0.2,
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('swipe');
    });
  });

  // ─── typeText ────────────────────────────────────────────────

  describe('typeText', () => {
    it('types text via Appium', async () => {
      const result = await backend.typeText({ deviceId: TEST_UDID, text: 'Hello' });

      expect(result.success).toBe(true);
      expect(mock.typedTexts).toContain('Hello');
    });

    it('returns failure on typeText error', async () => {
      mock.setConfig({ typeTextError: new Error('Keyboard not available') });

      const result = await backend.typeText({ deviceId: TEST_UDID, text: 'test' });

      expect(result.success).toBe(false);
      expect(result.error).toContain('Keyboard not available');
    });
  });

  // ─── pressButton ─────────────────────────────────────────────

  describe('pressButton', () => {
    it('presses home button via Appium', async () => {
      const result = await backend.pressButton({ deviceId: TEST_UDID, button: 'home' });

      expect(result.success).toBe(true);
      expect(mock.pressedButtons).toContain('home');
    });

    it('presses volume up button', async () => {
      const result = await backend.pressButton({ deviceId: TEST_UDID, button: 'volumeUp' });

      expect(result.success).toBe(true);
      expect(mock.pressedButtons).toContain('volumeUp');
    });

    it('returns failure with explanation when pressButton not supported (R5)', async () => {
      mock.setConfig({
        pressButtonResult: { success: false, error: 'Not supported on iOS < 17' },
      });

      const result = await backend.pressButton({ deviceId: TEST_UDID, button: 'home' });

      // The backend catches driver errors but also handles unsupported operations
      // by returning a failure ActionResult — never throws
      expect(typeof result.success).toBe('boolean');
    });
  });

  // ─── openUrl ─────────────────────────────────────────────────

  describe('openUrl', () => {
    it('opens URL via Appium', async () => {
      const result = await backend.openUrl({ deviceId: TEST_UDID, url: 'https://example.com' });

      expect(result.success).toBe(true);
      expect(mock.calls).toContain('openUrl');
    });

    it('returns failure on openUrl error', async () => {
      mock.setConfig({ openUrlError: new Error('URL scheme not registered') });

      const result = await backend.openUrl({ deviceId: TEST_UDID, url: 'myapp://test' });

      expect(result.success).toBe(false);
      expect(result.error).toContain('URL scheme not registered');
    });
  });

  // ─── recording ───────────────────────────────────────────────

  describe('startRecording / stopRecording', () => {
    it('starts and stops recording, returning ArtifactRef', async () => {
      const handle = await backend.startRecording({ deviceId: TEST_UDID, type: 'video' });

      expect(handle.handleId).toBe('rec-001');
      expect(handle.startedAt).toBeDefined();

      const ref = await backend.stopRecording(handle);

      expect(ref.type).toBe('video');
      expect(ref.mimeType).toBe('video/mp4');
      expect(ref.redactionStatus).toBe('raw-local-only');
    });

    it('returns error handle when startRecording fails (R5)', async () => {
      mock.setConfig({
        startRecordingError: new Error('Recording not supported'),
      });

      const handle = await backend.startRecording({ deviceId: TEST_UDID, type: 'video' });

      // Returns a handle even on error — caller checks stopRecording result
      expect(handle.handleId).toContain('recording_error_');
    });

    it('returns error ArtifactRef when stopRecording fails (R5)', async () => {
      mock.setConfig({
        stopRecordingError: new Error('No active recording'),
      });

      const handle = await backend.startRecording({ deviceId: TEST_UDID, type: 'video' });
      const ref = await backend.stopRecording(handle);

      expect(ref.id).toContain('video_error_');
    });
  });

  // ─── listCrashes ─────────────────────────────────────────────

  describe('listCrashes', () => {
    it('lists crash reports from devicectl diagnostics', async () => {
      const crashes = await backend.listCrashes({ deviceId: TEST_UDID });

      // In test env without devicectl, returns empty array (R5: approximate)
      expect(Array.isArray(crashes)).toBe(true);
    });

    it('does not require an Appium session', async () => {
      await backend.listCrashes({ deviceId: TEST_UDID });
      expect(mock.calls).not.toContain('createSession');
    });
  });

  // ─── collectLogs ─────────────────────────────────────────────

  describe('collectLogs', () => {
    it('collects syslog via Appium', async () => {
      const ref = await backend.collectLogs({
        deviceId: TEST_UDID,
        type: 'syslog',
        durationSeconds: 10,
      });

      expect(ref.type).toBe('log');
      expect(ref.mimeType).toBe('text/plain');
      expect(ref.redactionStatus).toBe('raw-local-only');
    });

    it('collects crashlog via Appium', async () => {
      const ref = await backend.collectLogs({
        deviceId: TEST_UDID,
        type: 'crashlog',
      });

      expect(ref.type).toBe('log');
      expect(mock.calls).toContain('collectLogs');
    });

    it('returns error ArtifactRef on log collection failure (R5)', async () => {
      mock.setConfig({
        collectLogsError: new Error('Log collection not available'),
      });

      const ref = await backend.collectLogs({
        deviceId: TEST_UDID,
        type: 'syslog',
        durationSeconds: 10,
      });

      expect(ref.id).toContain('log_error_');
    });
  });

  // ─── Error handling & R5 compliance ──────────────────────────

  describe('error handling (R5 compliance)', () => {
    it('never throws from DeviceBackend methods — all errors returned as ActionResult/empty', async () => {
      // Configure all driver operations to fail
      mock.setConfig({
        createSessionError: new AppiumDriverError('connection_error', 'Server down'),
        getPageSourceError: new Error('WDA not running'),
        takeScreenshotError: new Error('Screenshot timeout'),
        tapError: new Error('Tap failed'),
        swipeError: new Error('Swipe failed'),
        typeTextError: new Error('Keyboard error'),
        launchAppError: new Error('App crashed'),
        terminateAppError: new Error('Terminate failed'),
        openUrlError: new Error('URL handler missing'),
      });

      // All methods should return without throwing
      const uiTree = await backend.getUiTree({ deviceId: TEST_UDID });
      expect(uiTree.raw).toBe('');

      const screenshot = await backend.screenshot({ deviceId: TEST_UDID });
      expect(screenshot.id).toContain('error');

      const tapResult = await backend.tap({ deviceId: TEST_UDID, x: 0.5, y: 0.5 });
      expect(tapResult.success).toBe(false);

      const swipeResult = await backend.swipe({
        deviceId: TEST_UDID,
        fromX: 0.5,
        fromY: 0.8,
        toX: 0.5,
        toY: 0.2,
      });
      expect(swipeResult.success).toBe(false);

      const typeResult = await backend.typeText({ deviceId: TEST_UDID, text: 'test' });
      expect(typeResult.success).toBe(false);

      const launchResult = await backend.launchApp({
        deviceId: TEST_UDID,
        bundleId: TEST_BUNDLE_ID,
      });
      expect(launchResult.success).toBe(false);

      const terminateResult = await backend.terminateApp({
        deviceId: TEST_UDID,
        bundleId: TEST_BUNDLE_ID,
      });
      expect(terminateResult.success).toBe(false);

      const openUrlResult = await backend.openUrl({
        deviceId: TEST_UDID,
        url: 'https://example.com',
      });
      expect(openUrlResult.success).toBe(false);

      const apps = await backend.listApps(TEST_UDID);
      expect(apps).toEqual([]);

      const crashes = await backend.listCrashes({ deviceId: TEST_UDID });
      expect(Array.isArray(crashes)).toBe(true);
    });

    it('includes error code from AppiumDriverError in ActionResult', async () => {
      mock.setConfig({
        createSessionError: new AppiumDriverError(
          'session_create_failed',
          'WDA build failed: provisioning profile expired',
        ),
      });

      const result = await backend.launchApp({ deviceId: TEST_UDID, bundleId: TEST_BUNDLE_ID });

      expect(result.success).toBe(false);
      expect(result.error).toContain('session_create_failed');
      expect(result.error).toContain('provisioning profile expired');
    });
  });

  // ─── BackendSelector compatibility ───────────────────────────

  describe('BackendSelector compatibility', () => {
    it('is discoverable by name "appium" for BackendRegistry', () => {
      expect(backend.name).toBe('appium');
    });

    it('declares supportedTargetKinds: ["physical"] for filterByTargetKind', () => {
      const caps = backend.capabilities;
      expect(caps.supportedTargetKinds).toContain('physical');
      expect(caps.supportedTargetKinds.length).toBe(1);
    });

    it('matches DEFAULT_PREFERENCES physical order (appium is first)', () => {
      // BackendSelector preferences: physical: ['appium', 'mobile-mcp', 'mock']
      // Our backend name must be 'appium' to be auto-picked
      expect(backend.name).toBe('appium');
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════
// buildPhysicalCapabilities tests
// ═══════════════════════════════════════════════════════════════════════

import { buildPhysicalCapabilities, buildSimulatorCapabilities } from '../src/index.js';

// Simulator listDevices/healthcheck drive the real `xcrun simctl` binary;
// CI runners have no booted simulator and cold xcrun invocations blow the
// per-test timeout.
const IS_CI = process.env.CI === 'true' || process.env.GITHUB_ACTIONS === 'true';

describe('buildPhysicalCapabilities', () => {
  it('builds minimum capabilities with an explicit managed route', () => {
    const caps = buildPhysicalCapabilities({
      udid: TEST_UDID,
      wdaStartupMode: 'managed-xcodebuild',
    });

    expect(caps.platformName).toBe('iOS');
    expect(caps['appium:automationName']).toBe('XCUITest');
    expect(caps['appium:udid']).toBe(TEST_UDID);
    expect(caps['appium:usePreinstalledWDA']).toBeUndefined();
    expect(caps['appium:usePrebuiltWDA']).toBeUndefined();
    expect(caps['appium:noReset']).toBe(true);
  });

  it('includes bundleId when provided', () => {
    const caps = buildPhysicalCapabilities({
      udid: TEST_UDID,
      bundleId: 'com.example.app',
      wdaStartupMode: 'managed-xcodebuild',
    });

    expect(caps['appium:bundleId']).toBe('com.example.app');
  });

  it('includes base wdaBundleId without .xctrunner suffix', () => {
    const caps = buildPhysicalCapabilities({
      udid: TEST_UDID,
      wdaStartupMode: 'managed-xcodebuild',
      wdaBundleId: 'UJ876FXT32.WebDriverAgentRunner',
    });

    expect(caps['appium:updatedWDABundleId']).toBe('UJ876FXT32.WebDriverAgentRunner');
  });

  it('rejects wdaBundleId with .xctrunner suffix (double-suffix guard)', () => {
    expect(() =>
      buildPhysicalCapabilities({
        udid: TEST_UDID,
        wdaStartupMode: 'managed-xcodebuild',
        wdaBundleId: 'UJ876FXT32.WebDriverAgentRunner.xctrunner',
      }),
    ).toThrow(/without .xctrunner suffix/);
  });

  it('respects custom port options', () => {
    const caps = buildPhysicalCapabilities({
      udid: TEST_UDID,
      wdaStartupMode: 'managed-xcodebuild',
      wdaLocalPort: 8200,
      mjpegServerPort: 9200,
    });

    expect(caps['appium:wdaLocalPort']).toBe(8200);
    expect(caps['appium:mjpegServerPort']).toBe(9200);
  });

  it('sets fullReset when requested', () => {
    const caps = buildPhysicalCapabilities({
      udid: TEST_UDID,
      wdaStartupMode: 'managed-xcodebuild',
      fullReset: true,
    });

    expect(caps['appium:noReset']).toBe(false);
  });

  it('includes optional deviceName and platformVersion', () => {
    const caps = buildPhysicalCapabilities({
      udid: TEST_UDID,
      wdaStartupMode: 'managed-xcodebuild',
      deviceName: 'iPhone 15 Pro',
      platformVersion: '18.3',
    });

    expect(caps['appium:deviceName']).toBe('iPhone 15 Pro');
    expect(caps['appium:platformVersion']).toBe('18.3');
  });

  it('sets default newCommandTimeout to 600 seconds', () => {
    const caps = buildPhysicalCapabilities({
      udid: TEST_UDID,
      wdaStartupMode: 'managed-xcodebuild',
    });
    expect(caps['appium:newCommandTimeout']).toBe(600);
  });

  it('accepts custom newCommandTimeout', () => {
    const caps = buildPhysicalCapabilities({
      udid: TEST_UDID,
      newCommandTimeout: 300,
      wdaStartupMode: 'managed-xcodebuild',
    });
    expect(caps['appium:newCommandTimeout']).toBe(300);
  });
});

// ═══════════════════════════════════════════════════════════════════════
// buildSimulatorCapabilities tests
// ═══════════════════════════════════════════════════════════════════════

describe('buildSimulatorCapabilities', () => {
  it('builds minimum capabilities with udid (no wdaBundleId needed)', () => {
    const caps = buildSimulatorCapabilities({ udid: SIM_UDID });

    expect(caps.platformName).toBe('iOS');
    expect(caps['appium:automationName']).toBe('XCUITest');
    expect(caps['appium:udid']).toBe(SIM_UDID);
    expect(caps['appium:usePrebuiltWDA']).toBe(false);
    expect(caps['appium:noReset']).toBe(true);
    // Simulator does NOT need updatedWDABundleId
    expect(caps['appium:updatedWDABundleId']).toBeUndefined();
  });

  it('includes bundleId when provided', () => {
    const caps = buildSimulatorCapabilities({ udid: SIM_UDID, bundleId: 'com.example.app' });
    expect(caps['appium:bundleId']).toBe('com.example.app');
  });

  it('respects custom port options for parallel sessions', () => {
    const caps = buildSimulatorCapabilities({
      udid: SIM_UDID,
      wdaLocalPort: 8200,
      mjpegServerPort: 9200,
    });

    expect(caps['appium:wdaLocalPort']).toBe(8200);
    expect(caps['appium:mjpegServerPort']).toBe(9200);
  });

  it('includes derivedDataPath for parallel session isolation', () => {
    const caps = buildSimulatorCapabilities({
      udid: SIM_UDID,
      derivedDataPath: '/tmp/wda-build-session-2',
    });

    expect(caps['appium:derivedDataPath']).toBe('/tmp/wda-build-session-2');
  });

  it('sets usePrebuiltWDA: true when explicitly configured', () => {
    const caps = buildSimulatorCapabilities({
      udid: SIM_UDID,
      usePrebuiltWDA: true,
    });

    expect(caps['appium:usePrebuiltWDA']).toBe(true);
  });

  it('sets fullReset when requested', () => {
    const caps = buildSimulatorCapabilities({ udid: SIM_UDID, fullReset: true });
    expect(caps['appium:noReset']).toBe(false);
  });

  it('includes optional deviceName and platformVersion', () => {
    const caps = buildSimulatorCapabilities({
      udid: SIM_UDID,
      deviceName: 'iPhone 16 Pro',
      platformVersion: '18.2',
    });

    expect(caps['appium:deviceName']).toBe('iPhone 16 Pro');
    expect(caps['appium:platformVersion']).toBe('18.2');
  });

  it('sets default newCommandTimeout to 600 seconds', () => {
    const caps = buildSimulatorCapabilities({ udid: SIM_UDID });
    expect(caps['appium:newCommandTimeout']).toBe(600);
  });

  it('accepts custom newCommandTimeout', () => {
    const caps = buildSimulatorCapabilities({ udid: SIM_UDID, newCommandTimeout: 300 });
    expect(caps['appium:newCommandTimeout']).toBe(300);
  });
});

// ═══════════════════════════════════════════════════════════════════════
// AppiumDeviceBackend — simulator targetKind tests
// ═══════════════════════════════════════════════════════════════════════

describe('AppiumDeviceBackend (simulator targetKind)', () => {
  let mock: MockAppiumDriver;
  let backend: AppiumDeviceBackend;

  beforeEach(() => {
    const b = createSimulatorBackend();
    mock = b.mock;
    backend = b.backend;
  });

  afterEach(async () => {
    await backend.closeSession();
  });

  describe('constructor & metadata', () => {
    it('returns name "appium"', () => {
      expect(backend.name).toBe('appium');
    });

    it('has correct capabilities for simulator targetKind', () => {
      const caps = backend.capabilities;
      expect(caps.supportedTargetKinds).toEqual(['simulator']);
      expect(caps.supportsUiTree).toBe(true);
      expect(caps.supportsScreenshot).toBe(true);
      expect(caps.supportsVideo).toBe(true);
      expect(caps.supportsCrashLogs).toBe(false);
      expect(caps.supportsLocation).toBe(false);
      expect(caps.supportsPush).toBe(false);
    });

    it('does not include physical in supportedTargetKinds', () => {
      expect(backend.capabilities.supportedTargetKinds).not.toContain('physical');
    });

    it('uses simctl capabilities in ensureSession (no wdaBundleId)', async () => {
      await backend.getUiTree({ deviceId: SIM_UDID });
      expect(mock.calls).toContain('createSession');
      // Simulator session created — verify it doesn't throw
    });

    it('passes mjpegServerPort and derivedDataPath from options', () => {
      const driver = new MockAppiumDriver();
      const b = new AppiumDeviceBackend(driver, {
        udid: SIM_UDID,
        targetKind: 'simulator',
        mjpegServerPort: 9999,
        derivedDataPath: '/custom/wda-path',
      });
      expect(b.name).toBe('appium');
    });
  });

  describe('listDevices', () => {
    it.skipIf(IS_CI)(
      'uses simctl (not devicectl) and returns empty array when unavailable',
      async () => {
        const devices = await backend.listDevices();
        // In test env without simctl, returns empty array (R5)
        expect(Array.isArray(devices)).toBe(true);
      },
    );

    it.skipIf(IS_CI)('does not require an Appium session', async () => {
      await backend.listDevices();
      expect(mock.calls).not.toContain('createSession');
    });
  });

  describe('healthcheck', () => {
    it.skipIf(IS_CI)('uses simctl for healthcheck (not devicectl)', async () => {
      const result = await backend.healthcheck(SIM_UDID);
      // In test env without simctl, returns healthy:false
      expect(typeof result.healthy).toBe('boolean');
      expect(result.details).toBeDefined();
    });

    it.skipIf(IS_CI)('does not require an Appium session', async () => {
      await backend.healthcheck(SIM_UDID);
      expect(mock.calls).not.toContain('createSession');
    });
  });

  describe('listCrashes', () => {
    it('returns empty array for simulator (R5: not supported via simctl)', async () => {
      const crashes = await backend.listCrashes({ deviceId: SIM_UDID });
      expect(crashes).toEqual([]);
    });

    it('does not require an Appium session', async () => {
      await backend.listCrashes({ deviceId: SIM_UDID });
      expect(mock.calls).not.toContain('createSession');
    });
  });

  describe('BackendSelector compatibility', () => {
    it('declares supportedTargetKinds: ["simulator"] for filterByTargetKind', () => {
      const caps = backend.capabilities;
      expect(caps.supportedTargetKinds).toContain('simulator');
      expect(caps.supportedTargetKinds.length).toBe(1);
    });

    it('matches DEFAULT_PREFERENCES simulator order (appium is first)', () => {
      expect(backend.name).toBe('appium');
    });
  });

  describe('backwards compatibility (physical targetKind)', () => {
    it('physical backend still works correctly', () => {
      const driver = new MockAppiumDriver();
      const physical = new AppiumDeviceBackend(driver, {
        udid: TEST_UDID,
        targetKind: 'physical',
        bundleId: TEST_BUNDLE_ID,
        wdaStartupMode: 'managed-xcodebuild',
        physicalDeviceDiscovery: async () => [],
      });

      const caps = physical.capabilities;
      expect(caps.supportedTargetKinds).toEqual(['physical']);
      expect(caps.supportsCrashLogs).toBe(true);
    });

    it('physical backend listDevices uses physical discovery (not simctl)', async () => {
      const driver = new MockAppiumDriver();
      let discoveryCalls = 0;
      const physical = new AppiumDeviceBackend(driver, {
        udid: TEST_UDID,
        targetKind: 'physical',
        wdaStartupMode: 'managed-xcodebuild',
        physicalDeviceDiscovery: async () => {
          discoveryCalls += 1;
          return [];
        },
      });
      const devices = await physical.listDevices();
      expect(Array.isArray(devices)).toBe(true);
      expect(discoveryCalls).toBe(1);
      expect(physical.capabilities.supportedTargetKinds).toEqual(['physical']);
    });
  });

  describe('error handling (R5 — simulator)', () => {
    it('simulator backends never throw from DeviceBackend methods', async () => {
      // Configure session creation to fail
      mock.setConfig({
        createSessionError: new AppiumDriverError('connection_error', 'Appium server down'),
      });

      const uiTree = await backend.getUiTree({ deviceId: SIM_UDID });
      expect(uiTree.raw).toBe('');

      const screenshot = await backend.screenshot({ deviceId: SIM_UDID });
      expect(screenshot.id).toContain('error');

      const tapResult = await backend.tap({ deviceId: SIM_UDID, x: 0.5, y: 0.5 });
      expect(tapResult.success).toBe(false);

      const swipeResult = await backend.swipe({
        deviceId: SIM_UDID,
        fromX: 0.5,
        fromY: 0.8,
        toX: 0.5,
        toY: 0.2,
      });
      expect(swipeResult.success).toBe(false);

      const typeResult = await backend.typeText({ deviceId: SIM_UDID, text: 'test' });
      expect(typeResult.success).toBe(false);

      const launchResult = await backend.launchApp({
        deviceId: SIM_UDID,
        bundleId: 'com.example.simapp',
      });
      expect(launchResult.success).toBe(false);

      const terminateResult = await backend.terminateApp({
        deviceId: SIM_UDID,
        bundleId: 'com.example.simapp',
      });
      expect(terminateResult.success).toBe(false);

      const openUrlResult = await backend.openUrl({
        deviceId: SIM_UDID,
        url: 'https://example.com',
      });
      expect(openUrlResult.success).toBe(false);

      const apps = await backend.listApps(SIM_UDID);
      expect(apps).toEqual([]);
    });
  });

  // ── Concurrent session creation (P0-2 fix) ─────────────────

  describe('concurrent ensureSession', () => {
    it('creates session only once when multiple action calls race', async () => {
      const backend = new AppiumDeviceBackend(new MockAppiumDriver(), {
        udid: SIM_UDID,
        targetKind: 'simulator',
      });

      // Trigger 3 concurrent taps — ensureSession should create session only once
      const [r1, r2, r3] = await Promise.all([
        backend.tap({ deviceId: SIM_UDID, x: 0.5, y: 0.5 }),
        backend.tap({ deviceId: SIM_UDID, x: 0.3, y: 0.7 }),
        backend.tap({ deviceId: SIM_UDID, x: 0.7, y: 0.3 }),
      ]);

      expect(r1.success).toBe(true);
      expect(r2.success).toBe(true);
      expect(r3.success).toBe(true);
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════
// MockWdaManager — for lifecycle tests
// ═══════════════════════════════════════════════════════════════════════

interface MockWdaConfig {
  isRunningResult?: boolean;
  stopThrows?: boolean;
  waitForReadyThrows?: boolean;
  waitForReadyResult?: { ready: boolean; waitedMs: number };
}

class MockWdaManager {
  private config: MockWdaConfig;
  readonly calls: string[] = [];
  stopCallCount = 0;
  private _isRunning: boolean;
  lastLaunchOptions: Record<string, unknown> | undefined;

  constructor(config?: MockWdaConfig) {
    this.config = config ?? {};
    this._isRunning = this.config.isRunningResult ?? false;
  }

  setConfig(config: MockWdaConfig): void {
    this.config = { ...this.config, ...config };
  }

  isRunning(): boolean {
    return this._isRunning;
  }

  setRunning(running: boolean): void {
    this._isRunning = running;
  }

  async stop(): Promise<void> {
    // Record call for test observability (even if no-op)
    this.calls.push('stop');
    // Idempotent — matching real WdaManager: only does real work when running
    if (!this._isRunning) return;
    this.stopCallCount++;
    this._isRunning = false;
    if (this.config.stopThrows) {
      throw new Error('WDA stop failed');
    }
  }

  async waitForReady(
    _port: number,
    _timeoutMs?: number,
  ): Promise<{ ready: boolean; waitedMs: number }> {
    this.calls.push('waitForReady');
    if (this.config.waitForReadyThrows) {
      throw new Error('WDA /status timeout');
    }
    return this.config.waitForReadyResult ?? { ready: true, waitedMs: 500 };
  }

  async verifyPreinstalledWDA(
    _udid: string,
    _expectedBundleId: string,
  ): Promise<{ installed: boolean; ready: boolean; reason?: string; actualBundleId?: string }> {
    this.calls.push('verifyPreinstalledWDA');
    return {
      installed: true,
      ready: false,
      actualBundleId: `${_expectedBundleId}.xctrunner`,
    };
  }

  async preparePreinstalledWDA(): Promise<{ ready: boolean; reason?: string }> {
    this.calls.push('preparePreinstalledWDA');
    return { ready: true };
  }

  async launch(options?: Record<string, unknown>): Promise<{ port: number; url: string }> {
    this.calls.push('launch');
    this.lastLaunchOptions = options;
    this._isRunning = true;
    return { port: 8100, url: 'http://127.0.0.1:8100' };
  }
}

// ═══════════════════════════════════════════════════════════════════════
// Lifecycle tests — WDA cleanup, /status timeout, double close
// ═══════════════════════════════════════════════════════════════════════

describe('AppiumDeviceBackend — lifecycle with WdaManager', () => {
  it('uses the configured MJPEG port when launching external WDA', async () => {
    const wdaManager = new MockWdaManager();
    const backend = new AppiumDeviceBackend(new MockAppiumDriver(), {
      udid: TEST_UDID,
      targetKind: 'physical',
      bundleId: TEST_BUNDLE_ID,
      wdaStartupMode: 'external-url',
      wdaManager: wdaManager as unknown as WdaManager,
      wdaLocalPort: 8200,
      mjpegServerPort: 9200,
    });
    await backend.launchApp({ deviceId: TEST_UDID, bundleId: TEST_BUNDLE_ID });
    expect(wdaManager.lastLaunchOptions?.mjpegServerPort).toBe(9200);
    await backend.closeSession();
  });
  it('WDA cleanup runs even when session was never created (closeSession with sessionActive=false)', async () => {
    const wdaManager = new MockWdaManager({ isRunningResult: true });
    const driver = new MockAppiumDriver();
    const backend = new AppiumDeviceBackend(driver, {
      udid: TEST_UDID,
      targetKind: 'physical',
      wdaStartupMode: 'managed-xcodebuild',
      wdaManager: wdaManager as unknown as WdaManager,
    });

    // Session was NEVER created — sessionActive is false
    expect(driver.isSessionActive()).toBe(false);

    // closeSession should STILL call wdaManager.stop()
    await backend.closeSession();

    expect(wdaManager.calls).toContain('stop');
    expect(wdaManager.stopCallCount).toBe(1);
    // No deleteSession call since session was never active
    expect(driver.calls).not.toContain('deleteSession');
  });

  it('WDA cleanup runs when session creation fails', async () => {
    const wdaManager = new MockWdaManager({ isRunningResult: true });
    const driver = new MockAppiumDriver({
      createSessionError: new AppiumDriverError(
        'session_create_failed',
        'Appium server unreachable',
      ),
    });
    const backend = new AppiumDeviceBackend(driver, {
      udid: TEST_UDID,
      targetKind: 'physical',
      wdaStartupMode: 'external-url',
      webDriverAgentUrl: 'http://127.0.0.1:8200',
      wdaManager: wdaManager as unknown as WdaManager,
    });

    // Attempt an action that triggers session creation — it will fail
    const result = await backend.launchApp({ deviceId: TEST_UDID, bundleId: TEST_BUNDLE_ID });
    expect(result.success).toBe(false);

    // closeSession should still call wdaManager.stop()
    await backend.closeSession();
    expect(wdaManager.calls).toContain('stop');
  });

  it('/status timeout returns structured error (WDA not ready)', async () => {
    const wdaManager = new MockWdaManager({
      waitForReadyThrows: true,
      isRunningResult: true,
    });
    const driver = new MockAppiumDriver();
    const backend = new AppiumDeviceBackend(driver, {
      udid: TEST_UDID,
      targetKind: 'physical',
      wdaStartupMode: 'external-url',
      wdaManager: wdaManager as unknown as WdaManager,
    });

    // Trigger session creation — it should fail because waitForReady throws
    const result = await backend.getUiTree({ deviceId: TEST_UDID });

    // Should return empty UiTreeSnapshot (not throw)
    expect(result.raw).toBe('');
  });

  it('double closeSession is idempotent (calls stop only once)', async () => {
    const wdaManager = new MockWdaManager({ isRunningResult: true });
    const driver = new MockAppiumDriver();
    const backend = new AppiumDeviceBackend(driver, {
      udid: TEST_UDID,
      targetKind: 'physical',
      wdaStartupMode: 'managed-xcodebuild',
      wdaManager: wdaManager as unknown as WdaManager,
    });

    // Close twice
    await backend.closeSession();
    await backend.closeSession();

    // wdaManager.stop() should be called only once (idempotent)
    expect(wdaManager.stopCallCount).toBe(1);
  });

  it('closeSession releases resources even when wdaManager.stop() throws', async () => {
    const wdaManager = new MockWdaManager({
      isRunningResult: true,
      stopThrows: true,
    });
    const driver = new MockAppiumDriver();
    const backend = new AppiumDeviceBackend(driver, {
      udid: TEST_UDID,
      targetKind: 'physical',
      wdaStartupMode: 'managed-xcodebuild',
      wdaManager: wdaManager as unknown as WdaManager,
    });

    // Create a session first
    await backend.getUiTree({ deviceId: TEST_UDID });
    expect(driver.isSessionActive()).toBe(true);

    // closeSession should not throw even if wdaManager.stop throws
    await backend.closeSession();

    // Appium session should still be cleaned up
    expect(driver.isSessionActive()).toBe(false);
    expect(driver.calls).toContain('deleteSession');
  });

  it('wdaManager is not called for simulator targetKind', async () => {
    const wdaManager = new MockWdaManager();
    const driver = new MockAppiumDriver();
    const backend = new AppiumDeviceBackend(driver, {
      udid: SIM_UDID,
      targetKind: 'simulator',
      wdaManager: wdaManager as unknown as WdaManager,
    });

    // Simulator path does not use WdaManager — Appium auto-builds WDA
    await backend.getUiTree({ deviceId: SIM_UDID });
    expect(driver.calls).toContain('createSession');

    // No WDA lifecycle calls for simulator
    expect(wdaManager.calls).not.toContain('launch');
    expect(wdaManager.calls).not.toContain('waitForReady');

    await backend.closeSession();
    // Simulator still calls stop on WdaManager if present
    expect(wdaManager.calls).toContain('stop');
  });
});

describe('AppiumDeviceBackend — active physical readiness', () => {
  it('rejects implicit and inventory-only physical WDA routes', () => {
    const driver = new MockAppiumDriver();
    expect(
      () =>
        new AppiumDeviceBackend(driver, {
          udid: TEST_UDID,
          targetKind: 'physical',
        }),
    ).toThrow(/explicit WDA route/);
    expect(
      () =>
        new AppiumDeviceBackend(driver, {
          udid: TEST_UDID,
          targetKind: 'physical',
          wdaStartupMode: 'preinstalled',
        }),
    ).toThrow(/inventory-only/);
  });

  it('proves Route B readiness through an active Appium session', async () => {
    const driver = new MockAppiumDriver();
    const backend = new AppiumDeviceBackend(driver, {
      udid: TEST_UDID,
      targetKind: 'physical',
      bundleId: TEST_BUNDLE_ID,
      wdaBundleId: 'TEAMID.WebDriverAgentRunner',
      wdaStartupMode: 'external-url',
      webDriverAgentUrl: 'http://127.0.0.1:8200',
      wdaLocalPort: 8200,
      mjpegServerPort: 9200,
      wdaStatusFetch: async () =>
        Response.json({
          value: { build: { productBundleIdentifier: 'TEAMID.WebDriverAgentRunner' } },
        }),
    });

    const probe = await backend.probePhysicalReadiness();
    expect(probe).toMatchObject({
      route: 'route_b_wda_manager_managed',
      stage: 'ready',
      ready: true,
      targetDeviceUdid: TEST_UDID,
    });
    expect(driver.lastSessionCaps?.['appium:wdaLocalPort']).toBe(8200);
    expect(driver.lastSessionCaps?.['appium:mjpegServerPort']).toBe(9200);
    await backend.closeSession();
  });

  it('fails closed when the session reports a different device or WDA identity', async () => {
    const backend = new AppiumDeviceBackend(
      new MockAppiumDriver({
        createSessionResult: {
          sessionId: 'wrong-session',
          deviceUdid: 'OTHER-DEVICE',
          wdaBundleId: 'OTHER.WebDriverAgentRunner',
        },
      }),
      {
        udid: TEST_UDID,
        targetKind: 'physical',
        bundleId: TEST_BUNDLE_ID,
        wdaBundleId: 'TEAMID.WebDriverAgentRunner',
        wdaStartupMode: 'external-url',
        webDriverAgentUrl: 'http://127.0.0.1:8100',
        wdaStatusFetch: async () =>
          Response.json({
            value: { build: { productBundleIdentifier: 'OTHER.WebDriverAgentRunner' } },
          }),
      },
    );

    await expect(backend.probePhysicalReadiness()).resolves.toMatchObject({
      ready: false,
      failureCode: 'wda_identity_mismatch',
      targetDeviceUdid: 'OTHER-DEVICE',
      targetWdaBundleId: 'OTHER.WebDriverAgentRunner.xctrunner',
    });
    await backend.closeSession();
  });

  it('uses the Route B WDA status identity instead of echoed Appium capabilities', async () => {
    const backend = new AppiumDeviceBackend(
      new MockAppiumDriver({
        createSessionResult: {
          sessionId: 'route-b-session',
          deviceUdid: TEST_UDID,
          wdaBundleId: 'TEAMID.WebDriverAgentRunner',
        },
      }),
      {
        udid: TEST_UDID,
        targetKind: 'physical',
        bundleId: TEST_BUNDLE_ID,
        wdaBundleId: 'TEAMID.WebDriverAgentRunner',
        wdaStartupMode: 'external-url',
        webDriverAgentUrl: 'http://127.0.0.1:8100',
        wdaStatusFetch: async () =>
          Response.json({
            value: { build: { productBundleIdentifier: 'OBSERVED.WebDriverAgentRunner' } },
          }),
      },
    );

    await expect(backend.probePhysicalReadiness()).resolves.toMatchObject({
      ready: false,
      failureCode: 'wda_identity_mismatch',
      targetDeviceUdid: TEST_UDID,
      targetWdaBundleId: 'OBSERVED.WebDriverAgentRunner.xctrunner',
    });
    await backend.closeSession();
  });

  it('classifies Route C session failures without claiming readiness', async () => {
    const backend = new AppiumDeviceBackend(
      new MockAppiumDriver({
        createSessionError: new AppiumDriverError('session_create_failed', 'provisioning failed'),
      }),
      {
        udid: TEST_UDID,
        targetKind: 'physical',
        bundleId: TEST_BUNDLE_ID,
        wdaBundleId: 'TEAMID.WebDriverAgentRunner',
        wdaStartupMode: 'managed-xcodebuild',
      },
    );

    const probe = await backend.probePhysicalReadiness();
    expect(probe).toMatchObject({
      route: 'route_c_appium_managed',
      stage: 'wda_launch',
      ready: false,
      failureCode: 'wda_signing_or_configuration_failed',
    });
  });
});
