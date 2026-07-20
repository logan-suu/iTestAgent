import type {
  ActionResult,
  AppInfo,
  ArtifactRef,
  CrashSummary,
  DeviceInfo,
  UiTreeSnapshot,
} from 'itestagent-contracts';
import type { MockDeviceConfig } from './mock-device-backend.js';

// ─── Default Devices ─────────────────────────────────────────

/**
 * Create a default device list: 2 physical + 2 simulator.
 */
export function createDefaultDevices(): DeviceInfo[] {
  return [
    {
      udid: '00008110-00123456A12B001E',
      name: 'iPhone 15 Pro',
      model: 'iPhone 15 Pro',
      osVersion: '18.3',
      platform: 'ios',
      targetKind: 'physical',
      state: 'booted',
    },
    {
      udid: '00008110-00ABCDEF7890123A',
      name: 'iPhone 14',
      model: 'iPhone 14',
      osVersion: '17.6',
      platform: 'ios',
      targetKind: 'physical',
      state: 'booted',
    },
    {
      udid: 'C9A2B8F1-3D4E-5A6B-7C8D-9E0F1A2B3C4D',
      name: 'iPhone 15 Pro Sim',
      model: 'iPhone 15 Pro',
      osVersion: '18.3',
      platform: 'ios',
      targetKind: 'simulator',
      runtimeIdentifier: 'com.apple.CoreSimulator.SimRuntime.iOS-18-3',
      deviceTypeIdentifier: 'com.apple.CoreSimulator.SimDeviceType.iPhone-15-Pro',
      state: 'booted',
    },
    {
      udid: 'D1B3C9G2-4E5F-6A7B-8C9D-0E1F2A3B4C5D',
      name: 'iPhone SE Sim',
      model: 'iPhone SE (3rd generation)',
      osVersion: '18.3',
      platform: 'ios',
      targetKind: 'simulator',
      runtimeIdentifier: 'com.apple.CoreSimulator.SimRuntime.iOS-18-3',
      deviceTypeIdentifier: 'com.apple.CoreSimulator.SimDeviceType.iPhone-SE-3rd-gen',
      state: 'shutdown',
    },
  ];
}

// ─── Default Apps ────────────────────────────────────────────

/**
 * Create a default app list.
 */
export function createDefaultApps(): AppInfo[] {
  return [
    {
      bundleId: 'com.apple.Preferences',
      name: 'Settings',
      version: '1.0',
      buildNumber: '100',
    },
    {
      bundleId: 'com.apple.mobilesafari',
      name: 'Safari',
      version: '18.3',
      buildNumber: '620B29',
    },
  ];
}

// ─── Default UI Tree ─────────────────────────────────────────

/**
 * Create a default UI tree snapshot (XML format).
 */
export function createDefaultUiTree(): UiTreeSnapshot {
  return {
    raw: `<?xml version="1.0" encoding="UTF-8"?>
<XCUIElementTypeApplication name="Settings" bundleId="com.apple.Preferences">
  <XCUIElementTypeNavigationBar name="Settings">
    <XCUIElementTypeButton name="Back" />
    <XCUIElementTypeStaticText name="Settings" />
  </XCUIElementTypeNavigationBar>
  <XCUIElementTypeTable>
    <XCUIElementTypeCell name="General">
      <XCUIElementTypeStaticText name="General" />
    </XCUIElementTypeCell>
    <XCUIElementTypeCell name="Display &amp; Brightness">
      <XCUIElementTypeStaticText name="Display &amp; Brightness" />
    </XCUIElementTypeCell>
  </XCUIElementTypeTable>
</XCUIElementTypeApplication>`,
    format: 'xml',
    capturedAt: new Date().toISOString(),
  };
}

// ─── Default ActionResult ────────────────────────────────────

/**
 * Create a default success action result.
 */
export function createDefaultActionResult(): ActionResult {
  return { success: true, message: 'ok' };
}

// ─── Default ArtifactRef ─────────────────────────────────────

/**
 * Create a default ArtifactRef for the given type.
 */
export function createDefaultArtifactRef(type: ArtifactRef['type']): ArtifactRef {
  const id = `artifact_${type}_${Date.now()}`;
  const base: ArtifactRef = {
    id,
    type,
    path: `/tmp/mock/artifacts/${type}/${id}`,
    redactionStatus: 'safe',
  };
  return base;
}

// ─── Default Crash Logs ──────────────────────────────────────

/**
 * Create a default (empty) crash logs list.
 */
export function createDefaultCrashLogs(): CrashSummary[] {
  return [];
}

// ─── Default Config ──────────────────────────────────────────

/**
 * Create a complete MockDeviceConfig with all defaults.
 */
export function createDefaultConfig(): MockDeviceConfig {
  return {
    devices: createDefaultDevices(),
    apps: createDefaultApps(),
    uiTree: createDefaultUiTree(),
    screenshot: createDefaultArtifactRef('screenshot'),
    actionResult: createDefaultActionResult(),
    crashLogs: createDefaultCrashLogs(),
    recordingHandle: {
      handleId: 'rec_001',
      startedAt: new Date().toISOString(),
    },
    logArtifact: createDefaultArtifactRef('log'),
  };
}
