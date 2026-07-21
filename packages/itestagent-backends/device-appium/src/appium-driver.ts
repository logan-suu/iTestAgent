/**
 * AppiumDriver — abstract interface for Appium/WebDriverIO operations.
 *
 * This interface abstracts the WebDriverIO client so that AppiumDeviceBackend
 * can be tested with a mock driver without requiring a real Appium server.
 *
 * Each method maps to a WebDriverIO or Appium-specific W3C extension command.
 * Errors are thrown as AppiumDriverError with categorized codes — caller is
 * responsible for catching and converting to iTestAgent ActionResult.
 *
 * R2: Uses Appium/WDA (mature open-source), does not re-implement.
 * R5: Methods document what they can/cannot return — never silently degrade.
 */

// ─── Error ──────────────────────────────────────────────────────────────

/** Error codes for Appium driver operations. */
export type AppiumDriverErrorCode =
  | 'session_create_failed'
  | 'session_not_found'
  | 'session_delete_failed'
  | 'command_failed'
  | 'unsupported_command'
  | 'device_not_found'
  | 'app_not_installed'
  | 'timeout'
  | 'connection_error';

export class AppiumDriverError extends Error {
  readonly code: AppiumDriverErrorCode;
  declare readonly cause?: unknown;

  constructor(code: AppiumDriverErrorCode, message: string, cause?: unknown) {
    super(message);
    this.name = 'AppiumDriverError';
    this.code = code;
    if (cause !== undefined) {
      this.cause = cause;
    }
  }
}

// ─── Session types ──────────────────────────────────────────────────────

/** Result of creating an Appium session. */
export interface AppiumSession {
  /** Appium session ID (opaque string from server). */
  sessionId: string;
  /** WDA bundle ID used for this session. */
  wdaBundleId: string;
}

// ─── Capabilities ───────────────────────────────────────────────────────

/**
 * W3C capabilities object for Appium session creation.
 *
 * @see appium-capabilities.ts for builder functions.
 */
export interface AppiumW3CCapabilities {
  platformName: string;
  'appium:automationName': string;
  'appium:udid': string;
  'appium:bundleId'?: string;
  'appium:usePrebuiltWDA'?: boolean;
  'appium:updatedWDABundleId'?: string;
  'appium:wdaLocalPort'?: number;
  'appium:mjpegServerPort'?: number;
  'appium:derivedDataPath'?: string;
  'appium:noReset'?: boolean;
  'appium:fullReset'?: boolean;
  'appium:newCommandTimeout'?: number;
  'appium:deviceName'?: string;
  'appium:platformVersion'?: string;
  [key: string]: unknown;
}

// ─── Coordinate types ───────────────────────────────────────────────────

/** Appium coordinate (pixels, NOT normalized). */
export interface AppiumPoint {
  x: number;
  y: number;
}

/**  Appium rectangular region for screenshot cropping. */
export interface AppiumRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

// ─── Recording types ────────────────────────────────────────────────────

/** Options for starting screen recording. */
export interface AppiumRecordingOptions {
  /** Video FPS (default: 10). */
  fps?: number;
  /** Video codec (default: 'mpeg4'). */
  codec?: 'mpeg4' | 'h264' | 'hevc';
  /** Recording quality: 'low' | 'medium' | 'high' | 'photo'. */
  quality?: 'low' | 'medium' | 'high' | 'photo';
  /** Force restart recording if one is already in progress. */
  forceRestart?: boolean;
}

/**
 * Result of starting screen recording.
 * The recording runs asynchronously on the Appium server; call stopRecording
 * to finalize and retrieve the video.
 */
export interface AppiumRecordingResult {
  /** Server-side recording UUID. */
  recordingId: string;
}

// ─── App listing types ──────────────────────────────────────────────────

/** A single app entry returned by mobile: listApps. */
export interface AppiumAppEntry {
  bundleId: string;
  name?: string;
  version?: string;
  buildNumber?: string;
  /** Whether the app is currently running. */
  isRunning?: boolean;
}

// ─── Crash / diagnostics types ─────────────────────────────────────────

/** A single crash/diagnostic entry from the device. */
export interface AppiumCrashEntry {
  /** Process name or exception type. */
  name: string;
  /** Occurrence date (ISO 8601). */
  date: string;
  /** Associated bundle ID. */
  bundleId?: string;
}

// ─── Log types ─────────────────────────────────────────────────────────

/** Options for collecting device logs. */
export interface AppiumLogOptions {
  /** Log type: 'syslog' or 'crashlog'. */
  type: 'syslog' | 'crashlog';
  /** Maximum collection duration in seconds. */
  durationSeconds?: number;
}

// ─── Action result types ────────────────────────────────────────────────

/** Generic result returned by AppiumDriver action methods. */
export interface AppiumActionResult {
  success: boolean;
  message?: string;
  error?: string;
  /** Extra payload when the command returns data (e.g. PID after launch). */
  data?: unknown;
}

// ─── Element reference ──────────────────────────────────────────────────

/** Lightweight element reference (wraps W3C element ID). */
export interface AppiumElementRef {
  /** W3C element reference ID (opaque). */
  elementId: string;
}

// ─── Screen size ────────────────────────────────────────────────────────

/** Device screen size in Appium coordinate space (pixels). */
export interface AppiumScreenSize {
  width: number;
  height: number;
}

// ─── Driver interface ───────────────────────────────────────────────────

/**
 * AppiumDriver — abstract interface for all Appium/WebDriverIO operations.
 *
 * Implementations:
 *   - RealAppiumDriver: wraps an actual WebDriverIO client connected to Appium.
 *   - MockAppiumDriver: fixture-driven test double (for unit tests).
 *
 * All methods throw AppiumDriverError on failure. The caller (AppiumDeviceBackend)
 * catches and converts to iTestAgent ActionResult.
 */
export interface AppiumDriver {
  // ── Session ──────────────────────────────────────────────────────

  /**
   * Create a new Appium session with the given W3C capabilities.
   *
   * @throws AppiumDriverError (session_create_failed / connection_error / timeout)
   */
  createSession(caps: Record<string, unknown>): Promise<AppiumSession>;

  /**
   * Delete the current session and release resources (WDA ports, etc.).
   * Idempotent — safe to call even if no session is active.
   *
   * @throws AppiumDriverError (session_delete_failed)
   */
  deleteSession(): Promise<AppiumActionResult>;

  /**
   * Check whether a session is currently active.
   */
  isSessionActive(): boolean;

  /**
   * Get the current session ID, or null if no session is active.
   */
  getSessionId(): string | null;

  // ── Screen info ───────────────────────────────────────────────────

  /**
   * Get the device screen size in Appium coordinate space (pixels).
   *
   * @throws AppiumDriverError (session_not_found / command_failed)
   */
  getScreenSize(): Promise<AppiumScreenSize>;

  // ── App management ────────────────────────────────────────────────

  /**
   * Launch an app by bundle ID.
   *
   * @throws AppiumDriverError (app_not_installed / command_failed)
   */
  launchApp(bundleId: string): Promise<AppiumActionResult>;

  /**
   * Terminate (kill) an app by bundle ID.
   *
   * @throws AppiumDriverError (command_failed)
   */
  terminateApp(bundleId: string): Promise<AppiumActionResult>;

  /**
   * Activate (bring to foreground) an app by bundle ID.
   *
   * @throws AppiumDriverError (app_not_installed / command_failed)
   */
  activateApp(bundleId: string): Promise<AppiumActionResult>;

  /**
   * List installed apps on the device.
   *
   * @throws AppiumDriverError (command_failed)
   */
  listApps(): Promise<AppiumAppEntry[]>;

  // ── UI inspection ─────────────────────────────────────────────────

  /**
   * Get the XML page source (accessibility tree).
   *
   * @throws AppiumDriverError (session_not_found / command_failed)
   */
  getPageSource(): Promise<string>;

  /**
   * Take a screenshot of the current screen.
   * Returns base64-encoded PNG data.
   *
   * @throws AppiumDriverError (session_not_found / command_failed)
   */
  takeScreenshot(): Promise<string>;

  // ── Actions ────────────────────────────────────────────────────────

  /**
   * Tap at screen coordinates (pixels, NOT normalized).
   * Translates to W3C Actions pointer down → pointer up.
   *
   * @throws AppiumDriverError (session_not_found / command_failed)
   */
  tap(point: AppiumPoint): Promise<AppiumActionResult>;

  /**
   * Swipe from one coordinate to another (pixels, NOT normalized).
   * Translates to W3C Actions pointer down → move → up.
   *
   * @throws AppiumDriverError (session_not_found / command_failed)
   */
  swipe(from: AppiumPoint, to: AppiumPoint, durationMs?: number): Promise<AppiumActionResult>;

  /**
   * Type text into the currently focused element.
   * Uses W3C Actions key input sequence.
   *
   * @throws AppiumDriverError (session_not_found / command_failed)
   */
  typeText(text: string): Promise<AppiumActionResult>;

  /**
   * Press a hardware button (home/volumeUp/volumeDown).
   * Uses Appium mobile: pressButton command.
   *
   * @throws AppiumDriverError (session_not_found / unsupported_command / command_failed)
   */
  pressButton(button: string): Promise<AppiumActionResult>;

  // ── URL / deep link ────────────────────────────────────────────────

  /**
   * Open a URL or deep link on the device.
   *
   * @throws AppiumDriverError (session_not_found / command_failed)
   */
  openUrl(url: string, bundleId?: string): Promise<AppiumActionResult>;

  // ── Recording ──────────────────────────────────────────────────────

  /**
   * Start screen recording.
   *
   * @throws AppiumDriverError (session_not_found / unsupported_command / command_failed)
   */
  startRecording(options?: AppiumRecordingOptions): Promise<AppiumRecordingResult>;

  /**
   * Stop screen recording and retrieve the video as base64-encoded data.
   *
   * @throws AppiumDriverError (session_not_found / unsupported_command / command_failed)
   */
  stopRecording(recordingId: string): Promise<string>;

  // ── Crashes / diagnostics ──────────────────────────────────────────

  /**
   * List device diagnostic/crash reports.
   *
   * Physical: Reads from devicectl diagnostics.
   * Returns approximate list — some entries may be system crashes unrelated
   * to the target app (R5: approximate, not exhaustive).
   *
   * @throws AppiumDriverError (unsupported_command / command_failed)
   */
  listCrashes(bundleId?: string): Promise<AppiumCrashEntry[]>;

  // ── Logs ───────────────────────────────────────────────────────────

  /**
   * Collect device logs.
   *
   * @throws AppiumDriverError (session_not_found / unsupported_command / command_failed)
   */
  collectLogs(options: AppiumLogOptions): Promise<string>;
}
