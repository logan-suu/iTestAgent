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
} from './appium-driver.js';
import { AppiumDriverError } from './appium-driver.js';

// ─── Types ────────────────────────────────────────────────────────────────

interface WdioClient {
  sessionId: string;
  capabilities: Record<string, unknown>;
  deleteSession(): Promise<void>;
  getWindowSize(): Promise<{ width: number; height: number }>;
  getPageSource(): Promise<string>;
  takeScreenshot(): Promise<string>;
  performActions(actions: unknown[]): Promise<void>;
  releaseActions(): Promise<void>;
  keys(keys: string | string[]): Promise<void>;
  execute<T = unknown>(script: string, args?: unknown[]): Promise<T>;
  startRecordingScreen(options?: Record<string, unknown>): Promise<void>;
  stopRecordingScreen(): Promise<string>;
}

type WdioRemoteFn = (options: Record<string, unknown>) => Promise<WdioClient>;

// ─── Helpers ──────────────────────────────────────────────────────────────

function sanitizeMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message
      .replace(/(https?:\/\/[^\s]+)/g, '[url]')
      .replace(/[a-fA-F0-9]{8,}/g, '[id]');
  }
  return String(error);
}

// ─── Implementation ───────────────────────────────────────────────────────

export class RealAppiumDriver implements AppiumDriver {
  private readonly serverUrl: string;
  private client: WdioClient | null = null;
  private sessionId: string | null = null;
  private active = false;

  constructor(serverUrl = 'http://127.0.0.1:4723') {
    this.serverUrl = serverUrl;
  }

  // ── Session ──────────────────────────────────────────────────────

  async createSession(caps: Record<string, unknown>): Promise<AppiumSession> {
    let remoteFn: WdioRemoteFn;
    try {
      const mod = await import('webdriverio');
      remoteFn = mod.remote as unknown as WdioRemoteFn;
    } catch {
      throw new AppiumDriverError(
        'connection_error',
        'webdriverio module not found. Install with: bun add webdriverio',
      );
    }

    try {
      const wdioCaps = {
        ...caps,
        hostname: new URL(this.serverUrl).hostname,
        port: Number(new URL(this.serverUrl).port) || 4723,
        path: '/',
        logLevel: 'warn',
      };

      this.client = await remoteFn(wdioCaps);
      this.sessionId = this.client.sessionId;
      this.active = true;

      const wdaBundleId = (this.client.capabilities as Record<string, unknown>)?.[
        'appium:updatedWDABundleId'
      ] as string | undefined;

      return {
        sessionId: this.sessionId,
        wdaBundleId: wdaBundleId ?? 'unknown',
      };
    } catch (error) {
      const msg = sanitizeMessage(error);
      if (msg.includes('ECONNREFUSED') || msg.includes('Could not connect')) {
        throw new AppiumDriverError(
          'connection_error',
          `Cannot connect to Appium server at ${this.serverUrl}`,
        );
      }
      throw new AppiumDriverError(
        'session_create_failed',
        `Failed to create Appium session: ${msg}`,
      );
    }
  }

  async deleteSession(): Promise<AppiumActionResult> {
    if (!this.client || !this.active) {
      return { success: true, message: 'no active session' };
    }

    try {
      await this.client.deleteSession();
      return { success: true, message: 'session deleted' };
    } catch (error) {
      throw new AppiumDriverError('session_delete_failed', sanitizeMessage(error));
    } finally {
      this.client = null;
      this.sessionId = null;
      this.active = false;
    }
  }

  isSessionActive(): boolean {
    return this.active && this.client !== null;
  }

  getSessionId(): string | null {
    return this.sessionId;
  }

  // ── Screen info ───────────────────────────────────────────────────

  async getScreenSize(): Promise<AppiumScreenSize> {
    const c = this.requireClient();
    try {
      const size = await c.getWindowSize();
      return { width: size.width, height: size.height };
    } catch (error) {
      throw new AppiumDriverError('command_failed', `getScreenSize: ${sanitizeMessage(error)}`);
    }
  }

  // ── App management ────────────────────────────────────────────────

  async launchApp(bundleId: string): Promise<AppiumActionResult> {
    const c = this.requireClient();
    try {
      await c.execute('mobile:launchApp', [{ bundleId }] as unknown[]);
      return { success: true, message: `Launched ${bundleId}` };
    } catch (error) {
      throw new AppiumDriverError(
        'app_not_installed',
        `launchApp ${bundleId}: ${sanitizeMessage(error)}`,
      );
    }
  }

  async terminateApp(bundleId: string): Promise<AppiumActionResult> {
    const c = this.requireClient();
    try {
      await c.execute('mobile:terminateApp', [{ bundleId }] as unknown[]);
      return { success: true, message: `Terminated ${bundleId}` };
    } catch (error) {
      throw new AppiumDriverError(
        'command_failed',
        `terminateApp ${bundleId}: ${sanitizeMessage(error)}`,
      );
    }
  }

  async activateApp(bundleId: string): Promise<AppiumActionResult> {
    const c = this.requireClient();
    try {
      await c.execute('mobile:activateApp', [{ bundleId }] as unknown[]);
      return { success: true, message: `Activated ${bundleId}` };
    } catch (error) {
      throw new AppiumDriverError(
        'app_not_installed',
        `activateApp ${bundleId}: ${sanitizeMessage(error)}`,
      );
    }
  }

  async listApps(): Promise<AppiumAppEntry[]> {
    const c = this.requireClient();
    try {
      const result = await c.execute<AppiumAppEntry[]>('mobile:listApps', [] as unknown[]);
      return result ?? [];
    } catch (error) {
      throw new AppiumDriverError('command_failed', `listApps: ${sanitizeMessage(error)}`);
    }
  }

  // ── UI inspection ─────────────────────────────────────────────────

  async getPageSource(): Promise<string> {
    const c = this.requireClient();
    try {
      return await c.getPageSource();
    } catch (error) {
      throw new AppiumDriverError('command_failed', `getPageSource: ${sanitizeMessage(error)}`);
    }
  }

  async takeScreenshot(): Promise<string> {
    const c = this.requireClient();
    try {
      return await c.takeScreenshot();
    } catch (error) {
      throw new AppiumDriverError('command_failed', `takeScreenshot: ${sanitizeMessage(error)}`);
    }
  }

  // ── Actions ────────────────────────────────────────────────────────

  async tap(point: AppiumPoint): Promise<AppiumActionResult> {
    const c = this.requireClient();
    try {
      await c.performActions([
        {
          type: 'pointer',
          id: 'tap',
          parameters: { pointerType: 'touch' },
          actions: [
            { type: 'pointerMove', duration: 0, x: point.x, y: point.y },
            { type: 'pointerDown', button: 0 },
            { type: 'pause', duration: 50 },
            { type: 'pointerUp', button: 0 },
          ],
        },
      ]);
      await c.releaseActions();
      return { success: true, message: `Tap at (${point.x}, ${point.y})` };
    } catch (error) {
      throw new AppiumDriverError('command_failed', `tap: ${sanitizeMessage(error)}`);
    }
  }

  async swipe(
    from: AppiumPoint,
    to: AppiumPoint,
    durationMs?: number,
  ): Promise<AppiumActionResult> {
    const c = this.requireClient();
    const duration = durationMs ?? 300;
    try {
      await c.performActions([
        {
          type: 'pointer',
          id: 'swipe',
          parameters: { pointerType: 'touch' },
          actions: [
            { type: 'pointerMove', duration: 0, x: from.x, y: from.y },
            { type: 'pointerDown', button: 0 },
            { type: 'pointerMove', duration, x: to.x, y: to.y },
            { type: 'pointerUp', button: 0 },
          ],
        },
      ]);
      await c.releaseActions();
      return { success: true, message: `Swipe (${from.x},${from.y})→(${to.x},${to.y})` };
    } catch (error) {
      throw new AppiumDriverError('command_failed', `swipe: ${sanitizeMessage(error)}`);
    }
  }

  async typeText(text: string): Promise<AppiumActionResult> {
    const c = this.requireClient();
    try {
      await c.keys(text.split(''));
      return { success: true, message: `Typed ${text.length} chars` };
    } catch (error) {
      throw new AppiumDriverError('command_failed', `typeText: ${sanitizeMessage(error)}`);
    }
  }

  async pressButton(button: string): Promise<AppiumActionResult> {
    const c = this.requireClient();
    try {
      await c.execute('mobile:pressButton', [{ name: button }] as unknown[]);
      return { success: true, message: `Pressed ${button}` };
    } catch (error) {
      throw new AppiumDriverError(
        'unsupported_command',
        `pressButton ${button}: ${sanitizeMessage(error)}`,
      );
    }
  }

  // ── URL / deep link ────────────────────────────────────────────────

  async openUrl(url: string, bundleId?: string): Promise<AppiumActionResult> {
    const c = this.requireClient();
    try {
      if (bundleId) {
        await c.execute('mobile:deepLink', [{ url, bundleId }] as unknown[]);
      } else {
        await c.execute('mobile:deepLink', [{ url }] as unknown[]);
      }
      return { success: true, message: `Opened ${url}` };
    } catch (error) {
      throw new AppiumDriverError('command_failed', `openUrl: ${sanitizeMessage(error)}`);
    }
  }

  // ── Recording ──────────────────────────────────────────────────────

  async startRecording(options?: AppiumRecordingOptions): Promise<AppiumRecordingResult> {
    const c = this.requireClient();
    try {
      const recOptions: Record<string, unknown> = {};
      if (options?.fps) recOptions.fps = options.fps;
      if (options?.codec) recOptions.codec = options.codec;
      if (options?.quality) recOptions.videoQuality = options.quality;
      if (options?.forceRestart) recOptions.forceRestart = options.forceRestart;

      await c.startRecordingScreen(Object.keys(recOptions).length > 0 ? recOptions : undefined);
      return { recordingId: `rec_${Date.now()}` };
    } catch (error) {
      throw new AppiumDriverError(
        'unsupported_command',
        `startRecording: ${sanitizeMessage(error)}`,
      );
    }
  }

  async stopRecording(_recordingId: string): Promise<string> {
    const c = this.requireClient();
    try {
      return await c.stopRecordingScreen();
    } catch (error) {
      throw new AppiumDriverError('command_failed', `stopRecording: ${sanitizeMessage(error)}`);
    }
  }

  // ── Crashes / diagnostics ──────────────────────────────────────────

  async listCrashes(_bundleId?: string): Promise<AppiumCrashEntry[]> {
    throw new AppiumDriverError(
      'unsupported_command',
      'listCrashes is not available through Appium. Use devicectl diagnostics or simctl directly.',
    );
  }

  // ── Logs ───────────────────────────────────────────────────────────

  async collectLogs(_options: AppiumLogOptions): Promise<string> {
    throw new AppiumDriverError(
      'unsupported_command',
      'collectLogs is not available through Appium. Use simctl or devicectl syslog directly.',
    );
  }

  // ── Internal ───────────────────────────────────────────────────────

  private requireClient(): WdioClient {
    if (!this.client || !this.active) {
      throw new AppiumDriverError(
        'session_not_found',
        'No active Appium session. Call createSession first.',
      );
    }
    return this.client;
  }
}
