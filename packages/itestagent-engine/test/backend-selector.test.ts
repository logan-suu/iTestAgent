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
import { BackendRegistry, BackendSelector, DEFAULT_PREFERENCES } from '../src/backend-selector.js';

import type { BackendPreferences, SelectResult } from '../src/backend-selector.js';

// ─── FakeDeviceBackend ──────────────────────────────────────

/**
 * Minimal in-memory DeviceBackend for testing the selector.
 * All 16 action methods return sensible defaults (no real device interaction).
 */
class FakeDeviceBackend implements DeviceBackend {
  public readonly name: string;
  public readonly capabilities: BackendCapabilities;
  private healthy: boolean;

  constructor(name: string, supportedTargetKinds: ('physical' | 'simulator')[], healthy = true) {
    this.name = name;
    this.healthy = healthy;
    this.capabilities = {
      supportedTargetKinds,
      features: [],
      supportsUiTree: true,
      supportsScreenshot: true,
      supportsVideo: false,
      supportsCrashLogs: false,
      supportsLocation: false,
      supportsPush: false,
    };
  }

  async healthcheck(_deviceId: string): Promise<HealthCheckResult> {
    return {
      healthy: this.healthy,
      details: this.healthy ? undefined : 'simulated unhealthy',
    };
  }

  async listDevices(): Promise<DeviceInfo[]> {
    return [];
  }

  async listApps(_deviceId: string): Promise<AppInfo[]> {
    return [];
  }

  async launchApp(_input: LaunchAppInput): Promise<ActionResult> {
    return { success: true };
  }

  async terminateApp(_input: TerminateAppInput): Promise<ActionResult> {
    return { success: true };
  }

  async getUiTree(_input: DeviceTarget): Promise<UiTreeSnapshot> {
    return { raw: '<root/>', format: 'xml', capturedAt: new Date().toISOString() };
  }

  async screenshot(_input: ScreenshotInput): Promise<ArtifactRef> {
    return {
      id: 'fake-screenshot',
      type: 'screenshot',
      path: '/fake/screenshot.png',
      redactionStatus: 'safe',
    };
  }

  async tap(_input: TapInput): Promise<ActionResult> {
    return { success: true };
  }

  async swipe(_input: SwipeInput): Promise<ActionResult> {
    return { success: true };
  }

  async typeText(_input: TypeTextInput): Promise<ActionResult> {
    return { success: true };
  }

  async pressButton(_input: PressButtonInput): Promise<ActionResult> {
    return { success: true };
  }

  async openUrl(_input: OpenUrlInput): Promise<ActionResult> {
    return { success: true };
  }

  async startRecording(_input: RecordingInput): Promise<RecordingHandle> {
    return { handleId: 'fake-rec', startedAt: new Date().toISOString() };
  }

  async stopRecording(_input: RecordingHandle): Promise<ArtifactRef> {
    return {
      id: 'fake-video',
      type: 'video',
      path: '/fake/video.mp4',
      redactionStatus: 'safe',
    };
  }

  async listCrashes(_input: DeviceTarget): Promise<CrashSummary[]> {
    return [];
  }

  async collectLogs(_input: LogCollectInput): Promise<ArtifactRef> {
    return {
      id: 'fake-log',
      type: 'log',
      path: '/fake/system.log',
      redactionStatus: 'safe',
    };
  }
}

// ─── Helpers ───────────────────────────────────────────────

/** Create a registry seeded with the standard test backends. */
function createRegistry(): BackendRegistry {
  const registry = new BackendRegistry();
  registry.register('appium', new FakeDeviceBackend('appium', ['physical', 'simulator']));
  registry.register('mobile-mcp', new FakeDeviceBackend('mobile-mcp', ['physical']));
  registry.register('mock', new FakeDeviceBackend('mock', ['physical', 'simulator']));
  return registry;
}

/** Create a BackendSelector with a standard registry and default preferences. */
function createSelector(
  registry?: BackendRegistry,
  prefs?: Partial<BackendPreferences>,
): BackendSelector {
  return new BackendSelector(registry ?? createRegistry(), prefs);
}

// ────────────────────────────────────────────────────────────
//  BackendRegistry
// ────────────────────────────────────────────────────────────

describe('BackendRegistry', () => {
  test('registers and retrieves backends by name', () => {
    const registry = new BackendRegistry();
    const backend = new FakeDeviceBackend('test-backend', ['physical']);

    registry.register('test-backend', backend);

    expect(registry.has('test-backend')).toBe(true);
    expect(registry.get('test-backend')).toBe(backend);
  });

  test('get returns undefined for unregistered name', () => {
    const registry = new BackendRegistry();

    expect(registry.get('nonexistent')).toBeUndefined();
    expect(registry.has('nonexistent')).toBe(false);
  });

  test('list returns all registered backends', () => {
    const registry = new BackendRegistry();
    const a = new FakeDeviceBackend('a', ['physical']);
    const b = new FakeDeviceBackend('b', ['simulator']);

    registry.register('a', a);
    registry.register('b', b);

    const list = registry.list();
    expect(list).toHaveLength(2);
    expect(list).toContain(a);
    expect(list).toContain(b);
  });

  test('re-register overwrites previous backend', () => {
    const registry = new BackendRegistry();
    const first = new FakeDeviceBackend('same', ['physical']);
    const second = new FakeDeviceBackend('same', ['simulator']);

    registry.register('same', first);
    registry.register('same', second);

    expect(registry.get('same')).toBe(second);
  });
});

// ────────────────────────────────────────────────────────────
//  filterByTargetKind (Rule 1)
// ────────────────────────────────────────────────────────────

describe('filterByTargetKind', () => {
  test('only returns backends supporting the given targetKind', () => {
    const selector = createSelector();

    const physical = selector.filterByTargetKind('physical');
    const physicalNames = physical.map((b) => b.name);
    expect(physicalNames).toContain('appium');
    expect(physicalNames).toContain('mobile-mcp');
    expect(physicalNames).toContain('mock');
    expect(physical).toHaveLength(3);

    const simulator = selector.filterByTargetKind('simulator');
    const simNames = simulator.map((b) => b.name);
    expect(simNames).toContain('appium');
    expect(simNames).toContain('mock');
    expect(simNames).not.toContain('mobile-mcp');
    expect(simulator).toHaveLength(2);
  });

  test('returns empty array when no backend supports targetKind', () => {
    const registry = new BackendRegistry();
    registry.register('phys-only', new FakeDeviceBackend('phys-only', ['physical']));
    const selector = new BackendSelector(registry);

    const result = selector.filterByTargetKind('simulator');
    expect(result).toHaveLength(0);
  });
});

// ────────────────────────────────────────────────────────────
//  applyPreference (Rule 2)
// ────────────────────────────────────────────────────────────

describe('applyPreference', () => {
  test('returns the explicitly preferred backend when present', () => {
    const selector = createSelector();
    const candidates = selector.filterByTargetKind('simulator'); // appium, mock

    const result = selector.applyPreference(candidates, 'mock');
    expect(result).not.toBeNull();
    expect(result?.name).toBe('mock');
  });

  test('returns null when preferred backend is not in candidates', () => {
    const selector = createSelector();
    const candidates = selector.filterByTargetKind('simulator'); // appium, mock (no mobile-mcp)

    const result = selector.applyPreference(candidates, 'mobile-mcp');
    expect(result).toBeNull();
  });

  test('returns null when candidates list is empty', () => {
    const selector = createSelector();

    const result = selector.applyPreference([], 'appium');
    expect(result).toBeNull();
  });
});

// ────────────────────────────────────────────────────────────
//  autoPick (Rule 3 & 8)
// ────────────────────────────────────────────────────────────

describe('autoPick', () => {
  test('orders by physical preference: appium > mobile-mcp > mock', () => {
    const selector = createSelector();
    const candidates = selector.filterByTargetKind('physical');

    const result = selector.autoPick(candidates, 'physical');
    const names = result.map((b) => b.name);

    expect(names).toEqual(['appium', 'mobile-mcp', 'mock']);
  });

  test('orders by simulator preference: appium > mock', () => {
    const selector = createSelector();
    const candidates = selector.filterByTargetKind('simulator');

    const result = selector.autoPick(candidates, 'simulator');
    const names = result.map((b) => b.name);

    expect(names).toEqual(['appium', 'mock']);
  });

  test('backends not in preference list go to the end', () => {
    const registry = new BackendRegistry();
    registry.register('unknown-backend', new FakeDeviceBackend('unknown-backend', ['physical']));
    registry.register('appium', new FakeDeviceBackend('appium', ['physical']));
    const selector = new BackendSelector(registry);

    const candidates = selector.filterByTargetKind('physical');
    const result = selector.autoPick(candidates, 'physical');

    expect(result[0]?.name).toBe('appium');
    expect(result[result.length - 1]?.name).toBe('unknown-backend');
  });

  test('respects custom preferences', () => {
    const registry = new BackendRegistry();
    registry.register('appium', new FakeDeviceBackend('appium', ['physical']));
    registry.register('mock', new FakeDeviceBackend('mock', ['physical']));
    const customPrefs: Partial<BackendPreferences> = {
      device: { physical: ['mock', 'appium'], simulator: ['mock'] },
    };
    const selector = new BackendSelector(registry, customPrefs);

    const candidates = selector.filterByTargetKind('physical');
    const result = selector.autoPick(candidates, 'physical');

    expect(result[0]?.name).toBe('mock');
    expect(result[1]?.name).toBe('appium');
  });
});

// ────────────────────────────────────────────────────────────
//  healthcheckGate (Rule 4 — placeholder)
// ────────────────────────────────────────────────────────────

describe('healthcheckGate', () => {
  test('returns first backend without running healthcheck', async () => {
    const selector = createSelector();
    const candidates = selector.filterByTargetKind('simulator');

    const result = await selector.healthcheckGate(candidates, 'any-device');
    expect(result).not.toBeNull();
    expect(result?.name).toBe('appium'); // first in filterByTargetKind order
  });

  test('returns null for empty list', async () => {
    const selector = createSelector();

    const result = await selector.healthcheckGate([], 'any-device');
    expect(result).toBeNull();
  });
});

// ────────────────────────────────────────────────────────────
//  select — full pipeline
// ────────────────────────────────────────────────────────────

describe('select', () => {
  // ── success paths ────────────────────────────────────

  test('auto-picks first preference when no explicit backend specified (physical)', () => {
    const selector = createSelector();

    const result = selector.select('physical');
    expect(result.success).toBe(true);
    expect(result.backend?.name).toBe('appium');
    expect(result.healthcheckNotImplemented).toBe(true);
  });

  test('auto-picks first preference when no explicit backend specified (simulator)', () => {
    const selector = createSelector();

    const result = selector.select('simulator');
    expect(result.success).toBe(true);
    expect(result.backend?.name).toBe('appium');
    expect(result.healthcheckNotImplemented).toBe(true);
  });

  test('picks user-preferred backend over auto-pick when capabilities match (Rule 2)', () => {
    const selector = createSelector();

    const result = selector.select('physical', 'mock');
    expect(result.success).toBe(true);
    expect(result.backend?.name).toBe('mock');
    expect(result.fallbackChain).toBeUndefined();
  });

  test('falls back to next preference when preferred backend does not support targetKind (Rule 5)', () => {
    const selector = createSelector();

    // mobile-mcp supports physical only, not simulator
    const result = selector.select('simulator', 'mobile-mcp');
    expect(result.success).toBe(true);
    // Falls back to next available (appium is first in simulator preference)
    expect(result.backend?.name).toBe('appium');
    // fallbackChain records the preferred + the chain
    expect(result.fallbackChain).toBeDefined();
    expect(result.fallbackChain?.[0]).toBe('mobile-mcp');
  });

  test('records fallbackChain when auto-pick reorders or skips (Rule 5)', () => {
    const registry = new BackendRegistry();
    // Register in reverse preference order: mock before appium
    registry.register('mock', new FakeDeviceBackend('mock', ['physical']));
    registry.register('appium', new FakeDeviceBackend('appium', ['physical']));
    const selector = new BackendSelector(registry);

    const result = selector.select('physical');
    expect(result.success).toBe(true);
    // autoPick sorted — appium was chosen over the first-registered mock
    expect(result.backend?.name).toBe('appium');
    // fallbackChain recorded because ordering changed
    expect(result.fallbackChain).toBeDefined();
  });

  // ── failure paths ────────────────────────────────────

  test('returns error when no backend supports targetKind (Rule 1)', () => {
    const registry = new BackendRegistry();
    // Only physical backend registered — no simulator support
    registry.register('phys-only', new FakeDeviceBackend('phys-only', ['physical']));
    const selector = new BackendSelector(registry);

    const result = selector.select('simulator');
    expect(result.success).toBe(false);
    expect(result.errorCode).toBe('blocked.target_unsupported');
    expect(result.error).toContain('simulator');
    expect(result.backend).toBeUndefined();
  });

  test('returns error for unknown preferred backend name (Rule 7)', () => {
    const selector = createSelector();

    const result = selector.select('physical', 'nonexistent-backend');
    expect(result.success).toBe(false);
    expect(result.errorCode).toBe('blocked.setup');
    expect(result.error).toContain('not registered');
    expect(result.error).toContain('nonexistent-backend');
  });

  test('cross-targetKind fallback is blocked — simulator-only backend cannot serve physical request', () => {
    const registry = new BackendRegistry();
    // Only simulator backends registered
    registry.register('appium', new FakeDeviceBackend('appium', ['simulator']));
    const selector = new BackendSelector(registry);

    const result = selector.select('physical');
    expect(result.success).toBe(false);
    expect(result.errorCode).toBe('blocked.target_unsupported');
  });

  test('preferred backend exists but does not support targetKind — falls back correctly', () => {
    const registry = new BackendRegistry();
    registry.register('appium', new FakeDeviceBackend('appium', ['simulator']));
    registry.register('mock', new FakeDeviceBackend('mock', ['simulator']));
    const selector = new BackendSelector(registry);

    const result = selector.select('simulator', 'mock');
    expect(result.success).toBe(true);
    expect(result.backend?.name).toBe('mock');
  });

  test('no silent hardcoded fallback to Appium — uses preference chain only (Rule 8)', () => {
    const registry = new BackendRegistry();
    // Register only mobile-mcp and mock — no appium
    registry.register('mobile-mcp', new FakeDeviceBackend('mobile-mcp', ['physical']));
    registry.register('mock', new FakeDeviceBackend('mock', ['physical']));
    const selector = new BackendSelector(registry);

    const result = selector.select('physical');
    expect(result.success).toBe(true);
    // Preference order for physical: appium > mobile-mcp > mock
    // appium not registered → mobile-mcp is first available
    expect(result.backend?.name).toBe('mobile-mcp');
    // Should NOT silently fall back to appium (which isn't even registered)
  });

  test('fallbackChain includes only backends in the selection path', () => {
    const registry = new BackendRegistry();
    registry.register('mobile-mcp', new FakeDeviceBackend('mobile-mcp', ['physical']));
    registry.register('mock', new FakeDeviceBackend('mock', ['physical']));
    const selector = new BackendSelector(registry);

    // Prefer appium (not registered) → should error, not fallback
    const result = selector.select('physical', 'appium');
    expect(result.success).toBe(false);
    expect(result.errorCode).toBe('blocked.setup');
  });

  test('select with preferred backend that matches — no fallbackChain', () => {
    const selector = createSelector();

    const result = selector.select('physical', 'appium');
    expect(result.success).toBe(true);
    expect(result.backend?.name).toBe('appium');
    expect(result.fallbackChain).toBeUndefined();
  });
});

// ────────────────────────────────────────────────────────────
//  DEFAULT_PREFERENCES
// ────────────────────────────────────────────────────────────

describe('DEFAULT_PREFERENCES', () => {
  test('physical order is appium > mobile-mcp > mock', () => {
    expect(DEFAULT_PREFERENCES.device.physical).toEqual(['appium', 'mobile-mcp', 'mock']);
  });

  test('simulator order is appium > mock', () => {
    expect(DEFAULT_PREFERENCES.device.simulator).toEqual(['appium', 'mock']);
  });

  test('crossTargetFallback is false by default', () => {
    expect(DEFAULT_PREFERENCES.allowCrossTargetFallback).toBe(false);
  });
});
