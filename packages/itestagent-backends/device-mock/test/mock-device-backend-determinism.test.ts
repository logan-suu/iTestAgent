import { describe, expect, it } from 'bun:test';
import type { ArtifactRef, DeviceInfo, UiTreeSnapshot } from 'itestagent-contracts';
import { MockDeviceBackend } from '../src/mock-device-backend.js';
import type { MockDeviceConfig } from '../src/mock-device-backend.js';

const DEVICE_ID = '00008110-00FEEDFACE000001';

const EXPLICIT_DEVICES: DeviceInfo[] = [
  {
    udid: '00008110-00FEEDFACE000001',
    name: 'Determinism iPhone',
    platform: 'ios',
    targetKind: 'physical',
    state: 'booted',
  },
];

const EXPLICIT_SCREENSHOT: ArtifactRef = {
  id: 'artifact_screenshot_fixed',
  type: 'screenshot',
  path: '/tmp/mock/artifacts/screenshot/fixed',
  redactionStatus: 'safe',
};

const EXPLICIT_CONFIG: MockDeviceConfig = {
  devices: EXPLICIT_DEVICES,
  screenshot: EXPLICIT_SCREENSHOT,
};

type UiTreeWithoutCapturedAt = Omit<UiTreeSnapshot, 'capturedAt'>;

function withoutCapturedAt(tree: UiTreeSnapshot): UiTreeWithoutCapturedAt {
  const { capturedAt: _capturedAt, ...rest } = tree;
  return rest;
}

function assertIsoTimestamp(value: string): void {
  expect(Number.isNaN(Date.parse(value))).toBe(false);
}

describe('MockDeviceBackend determinism', () => {
  it('returns identical output on repeated calls for every method of one instance', async () => {
    const backend = new MockDeviceBackend();

    const devices1 = await backend.listDevices();
    const devices2 = await backend.listDevices();
    expect(devices2).toEqual(devices1);

    const apps1 = await backend.listApps(DEVICE_ID);
    const apps2 = await backend.listApps(DEVICE_ID);
    expect(apps2).toEqual(apps1);

    const health1 = await backend.healthcheck(DEVICE_ID);
    const health2 = await backend.healthcheck(DEVICE_ID);
    expect(health2).toEqual(health1);

    const tree1 = await backend.getUiTree({ deviceId: DEVICE_ID });
    const tree2 = await backend.getUiTree({ deviceId: DEVICE_ID });
    // capturedAt is intentionally refreshed per call by the backend contract;
    // every other field must be byte-identical between calls.
    expect(withoutCapturedAt(tree2)).toEqual(withoutCapturedAt(tree1));
    assertIsoTimestamp(tree1.capturedAt);
    assertIsoTimestamp(tree2.capturedAt);
    expect(tree2.capturedAt >= tree1.capturedAt).toBe(true);

    const ss1 = await backend.screenshot({ deviceId: DEVICE_ID });
    const ss2 = await backend.screenshot({ deviceId: DEVICE_ID });
    expect(ss2).toEqual(ss1);

    const tapInput = { deviceId: DEVICE_ID, x: 0.5, y: 0.5 };
    expect(await backend.tap(tapInput)).toEqual(await backend.tap(tapInput));

    const swipeInput = {
      deviceId: DEVICE_ID,
      fromX: 0.1,
      fromY: 0.9,
      toX: 0.1,
      toY: 0.1,
    };
    expect(await backend.swipe(swipeInput)).toEqual(await backend.swipe(swipeInput));

    const textInput = { deviceId: DEVICE_ID, text: 'deterministic' };
    expect(await backend.typeText(textInput)).toEqual(await backend.typeText(textInput));

    const buttonInput = { deviceId: DEVICE_ID, button: 'home' as const };
    expect(await backend.pressButton(buttonInput)).toEqual(await backend.pressButton(buttonInput));

    const urlInput = { deviceId: DEVICE_ID, url: 'https://example.com/determinism' };
    expect(await backend.openUrl(urlInput)).toEqual(await backend.openUrl(urlInput));

    const launchInput = { deviceId: DEVICE_ID, bundleId: 'com.apple.Preferences' };
    expect(await backend.launchApp(launchInput)).toEqual(await backend.launchApp(launchInput));
    expect(await backend.terminateApp(launchInput)).toEqual(
      await backend.terminateApp(launchInput),
    );

    const recInput = { deviceId: DEVICE_ID, type: 'video' as const };
    const handle1 = await backend.startRecording(recInput);
    const handle2 = await backend.startRecording(recInput);
    expect(handle2).toEqual(handle1);
    expect(await backend.stopRecording(handle1)).toEqual(await backend.stopRecording(handle2));

    const crashes1 = await backend.listCrashes({ deviceId: DEVICE_ID });
    const crashes2 = await backend.listCrashes({ deviceId: DEVICE_ID });
    expect(crashes2).toEqual(crashes1);

    const logsInput = { deviceId: DEVICE_ID, type: 'syslog' as const };
    expect(await backend.collectLogs(logsInput)).toEqual(await backend.collectLogs(logsInput));
  });

  it('produces identical output across separately constructed instances', async () => {
    const backendA = new MockDeviceBackend();
    const backendB = new MockDeviceBackend();

    expect(await backendB.listDevices()).toEqual(await backendA.listDevices());
    expect(await backendB.listApps(DEVICE_ID)).toEqual(await backendA.listApps(DEVICE_ID));
    expect(await backendB.screenshot({ deviceId: DEVICE_ID })).toEqual(
      await backendA.screenshot({ deviceId: DEVICE_ID }),
    );
    expect(await backendB.tap({ deviceId: DEVICE_ID, x: 0.5, y: 0.5 })).toEqual(
      await backendA.tap({ deviceId: DEVICE_ID, x: 0.5, y: 0.5 }),
    );

    const handleA = await backendA.startRecording({ deviceId: DEVICE_ID, type: 'video' });
    const handleB = await backendB.startRecording({ deviceId: DEVICE_ID, type: 'video' });
    expect(handleB).toEqual(handleA);
  });

  it('uses stable artifact identifiers not derived from wall-clock time', async () => {
    const backendA = new MockDeviceBackend();
    const backendB = new MockDeviceBackend();

    const ssA = await backendA.screenshot({ deviceId: DEVICE_ID });
    const ssB = await backendB.screenshot({ deviceId: DEVICE_ID });
    expect(ssB.id).toBe(ssA.id);
    expect(ssB.path).toBe(ssA.path);

    const logA = await backendA.collectLogs({ deviceId: DEVICE_ID, type: 'syslog' });
    const logB = await backendB.collectLogs({ deviceId: DEVICE_ID, type: 'syslog' });
    expect(logB.id).toBe(logA.id);
  });

  it('is deterministic when constructed from the same explicit config', async () => {
    const backendA = new MockDeviceBackend(EXPLICIT_CONFIG);
    const backendB = new MockDeviceBackend(EXPLICIT_CONFIG);

    expect(await backendB.listDevices()).toEqual(await backendA.listDevices());
    expect(await backendB.screenshot({ deviceId: DEVICE_ID })).toEqual(
      await backendA.screenshot({ deviceId: DEVICE_ID }),
    );
    expect((await backendB.screenshot({ deviceId: DEVICE_ID })).id).toBe(
      'artifact_screenshot_fixed',
    );
  });

  it('mutation of returned data does not leak into subsequent results', async () => {
    const backend = new MockDeviceBackend();

    const devices = await backend.listDevices();
    devices.pop();
    expect(await backend.listDevices()).toHaveLength(4);

    const tree = await backend.getUiTree({ deviceId: DEVICE_ID });
    tree.raw = 'MUTATED';
    expect((await backend.getUiTree({ deviceId: DEVICE_ID })).raw).not.toBe('MUTATED');

    const artifact = await backend.screenshot({ deviceId: DEVICE_ID });
    artifact.id = 'MUTATED';
    expect((await backend.screenshot({ deviceId: DEVICE_ID })).id).not.toBe('MUTATED');

    const crashes = await backend.listCrashes({ deviceId: DEVICE_ID });
    crashes.push({
      name: 'MUTATED',
      date: '2026-01-01T00:00:00Z',
      bundleId: 'com.example.mutated',
    });
    expect(await backend.listCrashes({ deviceId: DEVICE_ID })).toEqual([]);
  });

  it('keeps setConfig state isolated between instances', async () => {
    const backendA = new MockDeviceBackend();
    const backendB = new MockDeviceBackend();

    backendA.setConfig({
      actionResult: { success: false, error: 'only-a' },
      devices: EXPLICIT_DEVICES,
    });

    const tapA = await backendA.tap({ deviceId: DEVICE_ID, x: 0.5, y: 0.5 });
    expect(tapA.success).toBe(false);

    const tapB = await backendB.tap({ deviceId: DEVICE_ID, x: 0.5, y: 0.5 });
    expect(tapB.success).toBe(true);
    expect(await backendB.listDevices()).toHaveLength(4);
  });
});
