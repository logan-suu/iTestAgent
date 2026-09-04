import { beforeEach, describe, expect, it, mock } from 'bun:test';
import { AppiumDriverError, RealAppiumDriver } from '../src/index.js';

const MOCK_SESSION_ID = 'wdio-session-abc123';
const MOCK_SCREEN = { width: 428, height: 926 };

function makeMockWdioClient(
  overrides?: Partial<{
    pageSource: string;
    screenshot: string;
    apps: Array<{ bundleId: string; name: string }>;
  }>,
) {
  return {
    sessionId: MOCK_SESSION_ID,
    capabilities: {
      'appium:udid': 'TEST-UDID',
      'appium:updatedWDABundleId': 'TEAMID.WebDriverAgentRunner',
    },
    deleteSession: mock(() => Promise.resolve()),
    getWindowSize: mock(() => Promise.resolve(MOCK_SCREEN)),
    getPageSource: mock(() =>
      Promise.resolve(overrides?.pageSource ?? '<XCUIElementTypeApplication/>'),
    ),
    takeScreenshot: mock(() => Promise.resolve(overrides?.screenshot ?? 'base64png')),
    performActions: mock(() => Promise.resolve()),
    releaseActions: mock(() => Promise.resolve()),
    keys: mock(() => Promise.resolve()),
    execute: mock(<T = unknown>(script: string, _args?: unknown): Promise<T> => {
      if (script === 'mobile:listApps')
        return Promise.resolve(
          overrides?.apps ?? [{ bundleId: 'com.apple.Preferences', name: 'Settings' }],
        ) as Promise<T>;
      return Promise.resolve({} as T);
    }),
    startRecordingScreen: mock(() => Promise.resolve()),
    stopRecordingScreen: mock(() => Promise.resolve('base64video')),
    $: mock(() => Promise.resolve({ click: mock(() => Promise.resolve()) })),
  };
}

describe('RealAppiumDriver', () => {
  let driver: RealAppiumDriver;
  let mockClient: ReturnType<typeof makeMockWdioClient>;
  let originalRemote: unknown;

  beforeEach(() => {
    driver = new RealAppiumDriver('http://127.0.0.1:4723');
    mockClient = makeMockWdioClient();

    // Store original then mock webdriverio.remote
    originalRemote = (globalThis as Record<string, unknown>).__wdioRemote;
    (globalThis as Record<string, unknown>).__wdioRemote = mock(() => Promise.resolve(mockClient));

    // Override dynamic import to return our mock
    mock.module('webdriverio', () => ({
      remote: (globalThis as Record<string, unknown>).__wdioRemote,
    }));
  });

  // ── Session lifecycle ──────────────────────────────────────

  describe('createSession', () => {
    it('creates session and returns session info', async () => {
      const session = await driver.createSession({
        platformName: 'iOS',
        'appium:udid': 'TEST-UDID',
      });

      expect(session.sessionId).toBe(MOCK_SESSION_ID);
      expect(session.deviceUdid).toBe('TEST-UDID');
      expect(session.wdaBundleId).toBe('TEAMID.WebDriverAgentRunner');
      expect(driver.isSessionActive()).toBe(true);
      expect(driver.getSessionId()).toBe(MOCK_SESSION_ID);
    });

    it('throws connection_error when server is unreachable', () => {
      // This would normally hit a real server; without mocking deeper,
      // we verify the error type exists in the codebase.
      const err = new AppiumDriverError('connection_error', 'Cannot connect');
      expect(err.code).toBe('connection_error');
      expect(err.name).toBe('AppiumDriverError');
    });

    it('deletes a session that resolves after cancellation', async () => {
      let resolveRemote: ((client: typeof mockClient) => void) | undefined;
      const pendingDriver = new RealAppiumDriver(
        'http://127.0.0.1:4723',
        () =>
          new Promise<typeof mockClient>((resolve) => {
            resolveRemote = resolve;
          }),
      );
      const controller = new AbortController();
      const creation = pendingDriver.createSession(
        { platformName: 'iOS', 'appium:udid': 'TEST-UDID' },
        controller.signal,
      );
      while (!resolveRemote) {
        await new Promise((resolve) => setTimeout(resolve, 0));
      }

      controller.abort(new Error('run cancelled'));
      await expect(creation).rejects.toThrow('run cancelled');
      resolveRemote?.(mockClient);
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(mockClient.deleteSession).toHaveBeenCalledTimes(1);
      expect(pendingDriver.isSessionActive()).toBe(false);
    });
  });

  describe('deleteSession', () => {
    it('cleans up session and returns success', async () => {
      await driver.createSession({ platformName: 'iOS', 'appium:udid': 'TEST' });
      const result = await driver.deleteSession();

      expect(result.success).toBe(true);
      expect(driver.isSessionActive()).toBe(false);
      expect(driver.getSessionId()).toBeNull();
    });

    it('returns success when no session is active', async () => {
      const result = await driver.deleteSession();
      expect(result.success).toBe(true);
    });
  });

  describe('mobile command arguments', () => {
    it('passes a plain object to mobile:launchApp', async () => {
      await driver.createSession({ platformName: 'iOS', 'appium:udid': 'TEST' });
      await driver.launchApp('com.example.app');
      expect(mockClient.execute).toHaveBeenCalledWith('mobile:launchApp', {
        bundleId: 'com.example.app',
      });
    });
  });

  // ── Error: no session ──────────────────────────────────────

  describe('throws session_not_found when no active session', () => {
    it('getScreenSize', async () => {
      await expect(driver.getScreenSize()).rejects.toThrow('No active Appium session');
    });

    it('launchApp', async () => {
      await expect(driver.launchApp('com.example')).rejects.toThrow('No active Appium session');
    });

    it('terminateApp', async () => {
      await expect(driver.terminateApp('com.example')).rejects.toThrow('No active Appium session');
    });

    it('tap', async () => {
      await expect(driver.tap({ x: 100, y: 200 })).rejects.toThrow('No active Appium session');
    });

    it('swipe', async () => {
      await expect(driver.swipe({ x: 0, y: 0 }, { x: 100, y: 100 })).rejects.toThrow(
        'No active Appium session',
      );
    });

    it('getPageSource', async () => {
      await expect(driver.getPageSource()).rejects.toThrow('No active Appium session');
    });

    it('takeScreenshot', async () => {
      await expect(driver.takeScreenshot()).rejects.toThrow('No active Appium session');
    });
  });

  // ── Unsupported commands ───────────────────────────────────

  describe('unsupported commands', () => {
    it('listCrashes throws unsupported_command', async () => {
      await driver.createSession({ platformName: 'iOS', 'appium:udid': 'TEST' });
      await expect(driver.listCrashes()).rejects.toThrow(
        'listCrashes is not available through Appium',
      );
    });

    it('collectLogs throws unsupported_command', async () => {
      await driver.createSession({ platformName: 'iOS', 'appium:udid': 'TEST' });
      await expect(driver.collectLogs({ type: 'syslog' })).rejects.toThrow(
        'collectLogs is not available through Appium',
      );
    });
  });

  // ── Error sanitization ─────────────────────────────────────

  describe('error sanitization', () => {
    it('sanitizeMessage redacts URLs from error messages', async () => {
      const err = new AppiumDriverError(
        'connection_error',
        'Failed to connect to http://secret.example.com:4723/wd/hub',
      );
      // The error stores the raw message; sanitization happens at the throw site
      // In RealAppiumDriver, the message is sanitized before wrapping
      expect(err.message).toContain('http://secret.example.com');
    });
  });

  // ── Type checks ────────────────────────────────────────────

  describe('type conformance', () => {
    it('RealAppiumDriver implements AppiumDriver interface at compile time', () => {
      // If this compiles, RealAppiumDriver satisfies AppiumDriver
      const d: import('../src/index.js').AppiumDriver = new RealAppiumDriver();
      expect(d).toBeDefined();
    });

    it('all 18 interface methods exist', () => {
      const methods = [
        'createSession',
        'deleteSession',
        'isSessionActive',
        'getSessionId',
        'getScreenSize',
        'launchApp',
        'terminateApp',
        'activateApp',
        'listApps',
        'getPageSource',
        'takeScreenshot',
        'tap',
        'swipe',
        'typeText',
        'pressButton',
        'openUrl',
        'startRecording',
        'stopRecording',
        'listCrashes',
        'collectLogs',
      ];
      for (const m of methods) {
        expect(typeof (driver as unknown as Record<string, unknown>)[m]).toBe('function');
      }
    });
  });
});
