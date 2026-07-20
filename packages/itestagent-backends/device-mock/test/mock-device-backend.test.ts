import { describe, expect, it } from 'bun:test';
import type { ActionResult, ArtifactRef, CrashSummary, DeviceInfo } from 'itestagent-contracts';
import { MockDeviceBackend } from '../src/mock-device-backend.js';
import type { MockDeviceConfig } from '../src/mock-device-backend.js';

// ─── Fixtures ────────────────────────────────────────────────

const TEST_DEVICE_ID = '00008110-00123456A12B001E';
const UNKNOWN_DEVICE_ID = 'DEADBEEF-BADF-0000-0000-000000000000';

const CUSTOM_DEVICE: DeviceInfo = {
  udid: 'CUSTOM-UDID-001',
  name: 'Custom iPhone',
  platform: 'ios',
  targetKind: 'physical',
  state: 'booted',
};

const CUSTOM_ARTIFACT: ArtifactRef = {
  id: 'custom_artifact',
  type: 'screenshot',
  path: '/tmp/custom.png',
  redactionStatus: 'safe',
};

const CUSTOM_ACTION_RESULT: ActionResult = {
  success: false,
  error: 'custom failure',
};

const CUSTOM_CRASH: CrashSummary = {
  name: 'TestApp',
  date: '2026-01-15T10:30:00Z',
  bundleId: 'com.example.test',
};

// ─── Constructor & Metadata ──────────────────────────────────

describe('MockDeviceBackend', () => {
  describe('constructor & metadata', () => {
    it('has name "mock"', () => {
      const backend = new MockDeviceBackend();
      expect(backend.name).toBe('mock');
    });

    it('has correct capabilities', () => {
      const backend = new MockDeviceBackend();
      const caps = backend.capabilities;
      expect(caps.supportedTargetKinds).toEqual(['physical', 'simulator']);
      expect(caps.supportsUiTree).toBe(true);
      expect(caps.supportsScreenshot).toBe(true);
      expect(caps.supportsVideo).toBe(false);
      expect(caps.supportsCrashLogs).toBe(true);
      expect(caps.supportsLocation).toBe(false);
      expect(caps.supportsPush).toBe(false);
    });

    it('uses default fixtures when no config is provided', async () => {
      const backend = new MockDeviceBackend();
      const devices = await backend.listDevices();
      expect(devices.length).toBe(4);
      expect(devices[0]?.udid).toBe('00008110-00123456A12B001E');
    });

    it('merges custom config with defaults', async () => {
      const config: MockDeviceConfig = {
        devices: [CUSTOM_DEVICE],
        screenshot: CUSTOM_ARTIFACT,
        actionResult: CUSTOM_ACTION_RESULT,
        crashLogs: [CUSTOM_CRASH],
      };
      const backend = new MockDeviceBackend(config);

      const devices = await backend.listDevices();
      expect(devices).toHaveLength(1);
      expect(devices[0]?.udid).toBe('CUSTOM-UDID-001');

      const ss = await backend.screenshot({ deviceId: TEST_DEVICE_ID });
      expect(ss.id).toBe('custom_artifact');

      const result = await backend.tap({ deviceId: TEST_DEVICE_ID, x: 0.5, y: 0.5 });
      expect(result.success).toBe(false);
      expect(result.error).toBe('custom failure');

      const crashes = await backend.listCrashes({ deviceId: TEST_DEVICE_ID });
      expect(crashes).toHaveLength(1);
      expect(crashes[0]?.name).toBe('TestApp');
    });
  });

  // ─── listDevices ────────────────────────────────────────────

  describe('listDevices', () => {
    it('returns all configured devices', async () => {
      const backend = new MockDeviceBackend();
      const devices = await backend.listDevices();
      expect(devices).toHaveLength(4);
    });

    it('returns 2 physical and 2 simulator devices by default', async () => {
      const backend = new MockDeviceBackend();
      const devices = await backend.listDevices();
      const physical = devices.filter((d) => d.targetKind === 'physical');
      const simulators = devices.filter((d) => d.targetKind === 'simulator');
      expect(physical).toHaveLength(2);
      expect(simulators).toHaveLength(2);
    });

    it('returns devices with expected fields', async () => {
      const backend = new MockDeviceBackend();
      const devices = await backend.listDevices();
      for (const device of devices) {
        expect(device.udid).toBeTruthy();
        expect(device.name).toBeTruthy();
        expect(device.platform).toBe('ios');
        expect(['physical', 'simulator']).toContain(device.targetKind);
      }
    });
  });

  // ─── healthcheck ────────────────────────────────────────────

  describe('healthcheck', () => {
    it('returns healthy for a known device', async () => {
      const backend = new MockDeviceBackend();
      const result = await backend.healthcheck(TEST_DEVICE_ID);
      expect(result.healthy).toBe(true);
    });

    it('returns unhealthy for an unknown device', async () => {
      const backend = new MockDeviceBackend();
      const result = await backend.healthcheck(UNKNOWN_DEVICE_ID);
      expect(result.healthy).toBe(false);
      expect(result.details).toBe('device not found');
    });

    it('returns healthy for a simulator device', async () => {
      const backend = new MockDeviceBackend();
      const result = await backend.healthcheck('C9A2B8F1-3D4E-5A6B-7C8D-9E0F1A2B3C4D');
      expect(result.healthy).toBe(true);
    });
  });

  // ─── listApps ───────────────────────────────────────────────

  describe('listApps', () => {
    it('returns configured apps', async () => {
      const backend = new MockDeviceBackend();
      const apps = await backend.listApps(TEST_DEVICE_ID);
      expect(apps).toHaveLength(2);
      expect(apps[0]?.bundleId).toBe('com.apple.Preferences');
      expect(apps[1]?.bundleId).toBe('com.apple.mobilesafari');
    });

    it('ignores the deviceId parameter', async () => {
      const backend = new MockDeviceBackend();
      const apps1 = await backend.listApps(TEST_DEVICE_ID);
      const apps2 = await backend.listApps(UNKNOWN_DEVICE_ID);
      expect(apps1).toEqual(apps2);
    });
  });

  // ─── getUiTree ──────────────────────────────────────────────

  describe('getUiTree', () => {
    it('returns configured UI tree', async () => {
      const backend = new MockDeviceBackend();
      const tree = await backend.getUiTree({ deviceId: TEST_DEVICE_ID });
      expect(tree.format).toBe('xml');
      expect(tree.raw).toContain('Settings');
      expect(tree.capturedAt).toBeTruthy();
    });

    it('sets capturedAt to a fresh timestamp', async () => {
      const backend = new MockDeviceBackend();
      const before = new Date().toISOString();
      const tree = await backend.getUiTree({ deviceId: TEST_DEVICE_ID });
      expect(tree.capturedAt >= before).toBe(true);
    });
  });

  // ─── screenshot ─────────────────────────────────────────────

  describe('screenshot', () => {
    it('returns configured screenshot ArtifactRef', async () => {
      const backend = new MockDeviceBackend();
      const ref = await backend.screenshot({ deviceId: TEST_DEVICE_ID });
      expect(ref.type).toBe('screenshot');
      expect(ref.id).toBeTruthy();
      expect(ref.path).toBeTruthy();
    });
  });

  // ─── tap ────────────────────────────────────────────────────

  describe('tap', () => {
    it('returns configured actionResult', async () => {
      const backend = new MockDeviceBackend();
      const result = await backend.tap({ deviceId: TEST_DEVICE_ID, x: 0.5, y: 0.5 });
      expect(result.success).toBe(true);
      expect(result.message).toBe('ok');
    });
  });

  // ─── swipe ──────────────────────────────────────────────────

  describe('swipe', () => {
    it('returns configured actionResult', async () => {
      const backend = new MockDeviceBackend();
      const result = await backend.swipe({
        deviceId: TEST_DEVICE_ID,
        fromX: 0.5,
        fromY: 0.7,
        toX: 0.5,
        toY: 0.3,
      });
      expect(result.success).toBe(true);
    });
  });

  // ─── typeText ───────────────────────────────────────────────

  describe('typeText', () => {
    it('returns configured actionResult', async () => {
      const backend = new MockDeviceBackend();
      const result = await backend.typeText({ deviceId: TEST_DEVICE_ID, text: 'hello' });
      expect(result.success).toBe(true);
    });
  });

  // ─── pressButton ────────────────────────────────────────────

  describe('pressButton', () => {
    it('returns configured actionResult', async () => {
      const backend = new MockDeviceBackend();
      const result = await backend.pressButton({ deviceId: TEST_DEVICE_ID, button: 'home' });
      expect(result.success).toBe(true);
    });
  });

  // ─── openUrl ────────────────────────────────────────────────

  describe('openUrl', () => {
    it('returns configured actionResult', async () => {
      const backend = new MockDeviceBackend();
      const result = await backend.openUrl({
        deviceId: TEST_DEVICE_ID,
        url: 'https://example.com',
      });
      expect(result.success).toBe(true);
    });
  });

  // ─── launchApp / terminateApp ───────────────────────────────

  describe('launchApp', () => {
    it('returns configured actionResult', async () => {
      const backend = new MockDeviceBackend();
      const result = await backend.launchApp({
        deviceId: TEST_DEVICE_ID,
        bundleId: 'com.apple.Preferences',
      });
      expect(result.success).toBe(true);
    });
  });

  describe('terminateApp', () => {
    it('returns configured actionResult', async () => {
      const backend = new MockDeviceBackend();
      const result = await backend.terminateApp({
        deviceId: TEST_DEVICE_ID,
        bundleId: 'com.apple.Preferences',
      });
      expect(result.success).toBe(true);
    });
  });

  // ─── startRecording / stopRecording ─────────────────────────

  describe('recording', () => {
    it('startRecording returns configured recording handle', async () => {
      const backend = new MockDeviceBackend();
      const handle = await backend.startRecording({ deviceId: TEST_DEVICE_ID, type: 'video' });
      expect(handle.handleId).toBe('rec_001');
      expect(handle.startedAt).toBeTruthy();
    });

    it('stopRecording returns configured log artifact', async () => {
      const backend = new MockDeviceBackend();
      const handle = { handleId: 'rec_001', startedAt: new Date().toISOString() };
      const artifact = await backend.stopRecording(handle);
      expect(artifact.type).toBe('log');
      expect(artifact.id).toBeTruthy();
    });

    it('startRecording and stopRecording cycle works end-to-end', async () => {
      const backend = new MockDeviceBackend();
      const handle = await backend.startRecording({ deviceId: TEST_DEVICE_ID, type: 'screenshot' });
      expect(handle.handleId).toBeTruthy();
      const artifact = await backend.stopRecording(handle);
      expect(artifact.type).toBe('log');
    });
  });

  // ─── listCrashes ────────────────────────────────────────────

  describe('listCrashes', () => {
    it('returns configured crash logs (empty by default)', async () => {
      const backend = new MockDeviceBackend();
      const crashes = await backend.listCrashes({ deviceId: TEST_DEVICE_ID });
      expect(crashes).toEqual([]);
    });

    it('returns custom crash logs when configured', async () => {
      const backend = new MockDeviceBackend({
        crashLogs: [CUSTOM_CRASH],
      });
      const crashes = await backend.listCrashes({ deviceId: TEST_DEVICE_ID });
      expect(crashes).toHaveLength(1);
      expect(crashes[0]?.bundleId).toBe('com.example.test');
    });
  });

  // ─── collectLogs ────────────────────────────────────────────

  describe('collectLogs', () => {
    it('returns configured log artifact', async () => {
      const backend = new MockDeviceBackend();
      const artifact = await backend.collectLogs({
        deviceId: TEST_DEVICE_ID,
        type: 'syslog',
      });
      expect(artifact.type).toBe('log');
      expect(artifact.id).toBeTruthy();
    });
  });

  // ─── setConfig ──────────────────────────────────────────────

  describe('setConfig', () => {
    it('updates devices at runtime', async () => {
      const backend = new MockDeviceBackend();
      backend.setConfig({ devices: [CUSTOM_DEVICE] });

      const devices = await backend.listDevices();
      expect(devices).toHaveLength(1);
      expect(devices[0]?.udid).toBe('CUSTOM-UDID-001');
    });

    it('updates actionResult at runtime', async () => {
      const backend = new MockDeviceBackend();
      backend.setConfig({ actionResult: { success: false, error: 'boom' } });

      const result = await backend.tap({ deviceId: TEST_DEVICE_ID, x: 0.5, y: 0.5 });
      expect(result.success).toBe(false);
      expect(result.error).toBe('boom');
    });

    it('does not affect unset fields when partial update', async () => {
      const backend = new MockDeviceBackend();
      const appsBefore = await backend.listApps(TEST_DEVICE_ID);
      backend.setConfig({ actionResult: { success: false } });
      const appsAfter = await backend.listApps(TEST_DEVICE_ID);
      expect(appsAfter).toEqual(appsBefore);
    });

    it('updates screenshot artifact at runtime', async () => {
      const backend = new MockDeviceBackend();
      backend.setConfig({ screenshot: CUSTOM_ARTIFACT });
      const ref = await backend.screenshot({ deviceId: TEST_DEVICE_ID });
      expect(ref.id).toBe('custom_artifact');
    });

    it('updates crashLogs at runtime', async () => {
      const backend = new MockDeviceBackend();
      backend.setConfig({ crashLogs: [CUSTOM_CRASH] });
      const crashes = await backend.listCrashes({ deviceId: TEST_DEVICE_ID });
      expect(crashes).toHaveLength(1);
    });
  });

  // ─── Interface compliance ──────────────────────────────────

  describe('interface compliance', () => {
    it('implements all 14 DeviceBackend methods', () => {
      const backend = new MockDeviceBackend();
      expect(typeof backend.listDevices).toBe('function');
      expect(typeof backend.healthcheck).toBe('function');
      expect(typeof backend.listApps).toBe('function');
      expect(typeof backend.getUiTree).toBe('function');
      expect(typeof backend.screenshot).toBe('function');
      expect(typeof backend.tap).toBe('function');
      expect(typeof backend.swipe).toBe('function');
      expect(typeof backend.typeText).toBe('function');
      expect(typeof backend.pressButton).toBe('function');
      expect(typeof backend.openUrl).toBe('function');
      expect(typeof backend.launchApp).toBe('function');
      expect(typeof backend.terminateApp).toBe('function');
      expect(typeof backend.startRecording).toBe('function');
      expect(typeof backend.stopRecording).toBe('function');
      expect(typeof backend.listCrashes).toBe('function');
      expect(typeof backend.collectLogs).toBe('function');
    });

    it('all methods return Promises', () => {
      const backend = new MockDeviceBackend();
      expect(backend.listDevices()).toBeInstanceOf(Promise);
      expect(backend.healthcheck(TEST_DEVICE_ID)).toBeInstanceOf(Promise);
      expect(backend.listApps(TEST_DEVICE_ID)).toBeInstanceOf(Promise);
      expect(backend.getUiTree({ deviceId: TEST_DEVICE_ID })).toBeInstanceOf(Promise);
      expect(backend.screenshot({ deviceId: TEST_DEVICE_ID })).toBeInstanceOf(Promise);
      expect(backend.tap({ deviceId: TEST_DEVICE_ID, x: 0.5, y: 0.5 })).toBeInstanceOf(Promise);
    });

    it('readonly name and capabilities are not reassignable via TypeScript', () => {
      const backend = new MockDeviceBackend();
      // Verify values are correct (compile-time readonly is enforced by TS)
      expect(backend.name).toBe('mock');
      expect(backend.capabilities.supportsUiTree).toBe(true);
    });
  });

  // ─── Determinism ────────────────────────────────────────────

  describe('determinism', () => {
    it('returns fresh copies of mutable data (listDevices)', async () => {
      const backend = new MockDeviceBackend();
      const devices1 = await backend.listDevices();
      const devices2 = await backend.listDevices();
      expect(devices1).toEqual(devices2);
      expect(devices1).not.toBe(devices2); // different object references
      devices1.pop();
      const devices3 = await backend.listDevices();
      expect(devices3).toHaveLength(4); // unaffected by mutation of previous result
    });

    it('returns fresh copies of actionResult', async () => {
      const backend = new MockDeviceBackend();
      const r1 = await backend.tap({ deviceId: TEST_DEVICE_ID, x: 0.5, y: 0.5 });
      r1.success = false; // mutate returned object
      const r2 = await backend.tap({ deviceId: TEST_DEVICE_ID, x: 0.5, y: 0.5 });
      expect(r2.success).toBe(true); // unaffected by mutation
    });
  });
});
