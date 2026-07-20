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
import { createDefaultConfig } from './fixtures.js';

// ─── MockDeviceConfig ────────────────────────────────────────

export interface MockDeviceConfig {
  devices?: DeviceInfo[];
  apps?: AppInfo[];
  uiTree?: UiTreeSnapshot;
  screenshot?: ArtifactRef;
  actionResult?: ActionResult;
  crashLogs?: CrashSummary[];
  recordingHandle?: RecordingHandle;
  logArtifact?: ArtifactRef;
}

// ─── MockDeviceBackend ───────────────────────────────────────

/**
 * MockDeviceBackend — test double for DeviceBackend interface.
 *
 * Implements DeviceBackend with fixture-driven responses.
 * All methods return Promise.resolve() synchronously — no real async operations.
 * Configurable at construction and at runtime via setConfig().
 *
 * Follows the MockAgentRuntime pattern:
 *   - Constructor accepts optional config, merging with defaults
 *   - setConfig() allows runtime reconfiguration
 *   - All responses are deterministic
 */
export class MockDeviceBackend implements DeviceBackend {
  readonly name = 'mock';

  readonly capabilities: BackendCapabilities = {
    supportedTargetKinds: ['physical', 'simulator'],
    features: [
      'uitree',
      'screenshot',
      'tap',
      'swipe',
      'text',
      'button',
      'url',
      'launch',
      'crash',
      'log',
      'recording',
    ],
    supportsUiTree: true,
    supportsScreenshot: true,
    supportsVideo: false,
    supportsCrashLogs: true,
    supportsLocation: false,
    supportsPush: false,
  };

  /** All fixture data stored in a single object to avoid field/method name shadowing. */
  private cfg: Required<MockDeviceConfig>;

  constructor(config?: MockDeviceConfig) {
    this.cfg = { ...createDefaultConfig(), ...config } as Required<MockDeviceConfig>;
  }

  // ─── Runtime Configuration ──────────────────────────────────

  /**
   * Update the mock configuration at runtime.
   * Partial updates are merged with current state.
   */
  setConfig(partial: MockDeviceConfig): void {
    this.cfg = { ...this.cfg, ...partial };
  }

  // ─── DeviceBackend Interface ────────────────────────────────

  listDevices(): Promise<DeviceInfo[]> {
    return Promise.resolve([...this.cfg.devices]);
  }

  healthcheck(deviceId: string): Promise<HealthCheckResult> {
    const found = this.cfg.devices.some((d) => d.udid === deviceId);
    if (found) {
      return Promise.resolve({ healthy: true });
    }
    return Promise.resolve({ healthy: false, details: 'device not found' });
  }

  listApps(_deviceId: string): Promise<AppInfo[]> {
    return Promise.resolve([...this.cfg.apps]);
  }

  launchApp(_input: LaunchAppInput): Promise<ActionResult> {
    return Promise.resolve({ ...this.cfg.actionResult });
  }

  terminateApp(_input: TerminateAppInput): Promise<ActionResult> {
    return Promise.resolve({ ...this.cfg.actionResult });
  }

  getUiTree(_input: DeviceTarget): Promise<UiTreeSnapshot> {
    return Promise.resolve({ ...this.cfg.uiTree, capturedAt: new Date().toISOString() });
  }

  screenshot(_input: ScreenshotInput): Promise<ArtifactRef> {
    return Promise.resolve({ ...this.cfg.screenshot });
  }

  tap(_input: TapInput): Promise<ActionResult> {
    return Promise.resolve({ ...this.cfg.actionResult });
  }

  swipe(_input: SwipeInput): Promise<ActionResult> {
    return Promise.resolve({ ...this.cfg.actionResult });
  }

  typeText(_input: TypeTextInput): Promise<ActionResult> {
    return Promise.resolve({ ...this.cfg.actionResult });
  }

  pressButton(_input: PressButtonInput): Promise<ActionResult> {
    return Promise.resolve({ ...this.cfg.actionResult });
  }

  openUrl(_input: OpenUrlInput): Promise<ActionResult> {
    return Promise.resolve({ ...this.cfg.actionResult });
  }

  startRecording(_input: RecordingInput): Promise<RecordingHandle> {
    return Promise.resolve({ ...this.cfg.recordingHandle });
  }

  stopRecording(_input: RecordingHandle): Promise<ArtifactRef> {
    return Promise.resolve({ ...this.cfg.logArtifact });
  }

  listCrashes(_input: DeviceTarget): Promise<CrashSummary[]> {
    return Promise.resolve([...this.cfg.crashLogs]);
  }

  collectLogs(_input: LogCollectInput): Promise<ArtifactRef> {
    return Promise.resolve({ ...this.cfg.logArtifact });
  }
}
