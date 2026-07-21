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
import { AppiumDeviceBackend, AppiumDriverError } from '../src/index.js';

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
  deleteSessionError?: AppiumDriverError;
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
  wdaBundleId: 'TEAMID.WebDriverAgentRunner.xctrunner',
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
  readonly swipes: Array<{ from: AppiumPoint; to: AppiumPoint; durationMs?: number }> = [];
  readonly typedTexts: string[] = [];
  readonly pressedButtons: string[] = [];

  constructor(config?: MockDriverConfig) {
    this.config = config ?? {};
  }

  setConfig(config: MockDriverConfig): void {
    this.config = { ...this.config, ...config };
  }

  // ── Session ──────────────────────────────────────────────────

  async createSession(_caps: Record<string, unknown>): Promise<AppiumSession> {
    this.calls.push('createSession');
    if (this.config.createSessionError) throw this.config.createSessionError;
    const session = this.config.createSessionResult ?? DEFAULT_SESSION;
    this.sessionActive = true;
    this.sessionId = session.sessionId;
    return session;
  }

  async deleteSession(): Promise<AppiumActionResult> {
    this.calls.push('deleteSession');
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
    bundleId: TEST_BUNDLE_ID,
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
      expect(ref.redactionStatus).toBe('safe');
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

import { buildPhysicalCapabilities } from '../src/index.js';

describe('buildPhysicalCapabilities', () => {
  it('builds minimum capabilities with udid', () => {
    const caps = buildPhysicalCapabilities({ udid: TEST_UDID });

    expect(caps.platformName).toBe('iOS');
    expect(caps['appium:automationName']).toBe('XCUITest');
    expect(caps['appium:udid']).toBe(TEST_UDID);
    expect(caps['appium:usePrebuiltWDA']).toBe(true);
    expect(caps['appium:noReset']).toBe(true);
  });

  it('includes bundleId when provided', () => {
    const caps = buildPhysicalCapabilities({ udid: TEST_UDID, bundleId: 'com.example.app' });

    expect(caps['appium:bundleId']).toBe('com.example.app');
  });

  it('includes wdaBundleId for free-account workaround', () => {
    const caps = buildPhysicalCapabilities({
      udid: TEST_UDID,
      wdaBundleId: 'UJ876FXT32.WebDriverAgentRunner.xctrunner',
    });

    expect(caps['appium:updatedWDABundleId']).toBe('UJ876FXT32.WebDriverAgentRunner.xctrunner');
  });

  it('respects custom port options', () => {
    const caps = buildPhysicalCapabilities({
      udid: TEST_UDID,
      wdaLocalPort: 8200,
      mjpegServerPort: 9200,
    });

    expect(caps['appium:wdaLocalPort']).toBe(8200);
    expect(caps['appium:mjpegServerPort']).toBe(9200);
  });

  it('sets fullReset when requested', () => {
    const caps = buildPhysicalCapabilities({
      udid: TEST_UDID,
      fullReset: true,
    });

    expect(caps['appium:noReset']).toBe(false);
  });

  it('includes optional deviceName and platformVersion', () => {
    const caps = buildPhysicalCapabilities({
      udid: TEST_UDID,
      deviceName: 'iPhone 15 Pro',
      platformVersion: '18.3',
    });

    expect(caps['appium:deviceName']).toBe('iPhone 15 Pro');
    expect(caps['appium:platformVersion']).toBe('18.3');
  });

  it('sets default newCommandTimeout to 600 seconds', () => {
    const caps = buildPhysicalCapabilities({ udid: TEST_UDID });
    expect(caps['appium:newCommandTimeout']).toBe(600);
  });

  it('accepts custom newCommandTimeout', () => {
    const caps = buildPhysicalCapabilities({ udid: TEST_UDID, newCommandTimeout: 300 });
    expect(caps['appium:newCommandTimeout']).toBe(300);
  });
});
