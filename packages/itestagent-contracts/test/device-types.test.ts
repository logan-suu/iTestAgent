import { expect, test } from 'bun:test';
import {
  ActionResultSchema,
  AppInfoSchema,
  ArtifactRefSchema,
  ArtifactTypeSchema,
  BackendCapabilitiesSchema,
  CrashSummarySchema,
  DeviceInfoSchema,
  DeviceSnapshotSchema,
  DeviceTargetSchema,
  HealthCheckResultSchema,
  LaunchAppInputSchema,
  LogCollectInputSchema,
  OpenUrlInputSchema,
  PressButtonInputSchema,
  RecordingHandleSchema,
  RecordingInputSchema,
  RedactionStatusSchema,
  ScreenshotInputSchema,
  SwipeInputSchema,
  TapInputSchema,
  TerminateAppInputSchema,
  TypeTextInputSchema,
  UiTreeSnapshotSchema,
  parseArtifactRef,
} from '../src/device-types.js';

// ─── Test 1: ArtifactRefSchema parses valid with all required fields ───

test('ArtifactRefSchema parses valid artifact ref with all required fields', () => {
  const result = ArtifactRefSchema.parse({
    id: 'screenshot-001',
    type: 'screenshot',
    path: 'artifacts/screenshot_001.png',
    redactionStatus: 'raw-local-only',
  });
  expect(result.id).toBe('screenshot-001');
  expect(result.type).toBe('screenshot');
  expect(result.path).toBe('artifacts/screenshot_001.png');
  expect(result.redactionStatus).toBe('raw-local-only');
  expect(result.mimeType).toBeUndefined();
  expect(result.sizeBytes).toBeUndefined();
  expect(result.sha256).toBeUndefined();
});

// ─── Test 2: ArtifactRefSchema parses with optional fields ───

test('ArtifactRefSchema parses with optional fields (sha256, relatedStep, backend)', () => {
  const result = ArtifactRefSchema.parse({
    id: 'xcresult-001',
    type: 'xcresult',
    path: 'artifacts/test.xcresult',
    sha256: 'abc123def456',
    relatedStep: 'step_3',
    backend: 'xcodebuild',
    redactionStatus: 'redacted',
  });
  expect(result.id).toBe('xcresult-001');
  expect(result.type).toBe('xcresult');
  expect(result.sha256).toBe('abc123def456');
  expect(result.relatedStep).toBe('step_3');
  expect(result.backend).toBe('xcodebuild');
  expect(result.redactionStatus).toBe('redacted');
});

// ─── Test 3: ArtifactRefSchema rejects invalid type (not in enum) ───

test('ArtifactRefSchema rejects invalid type (not in enum)', () => {
  expect(() =>
    ArtifactRefSchema.parse({
      id: 'bad-001',
      type: 'pdf',
      path: 'artifacts/report.pdf',
      redactionStatus: 'safe',
    }),
  ).toThrow();
});

// ─── Test 4: ArtifactRefSchema rejects invalid redactionStatus ───

test('ArtifactRefSchema rejects invalid redactionStatus', () => {
  expect(() =>
    ArtifactRefSchema.parse({
      id: 'bad-002',
      type: 'screenshot',
      path: 'artifacts/img.png',
      redactionStatus: 'partial',
    }),
  ).toThrow();
});

// ─── Test 5: DeviceInfoSchema parses minimal iOS device info ───

test('DeviceInfoSchema parses minimal iOS device info', () => {
  const result = DeviceInfoSchema.parse({
    udid: '00008110-001234567890001A',
    platform: 'ios',
  });
  expect(result.udid).toBe('00008110-001234567890001A');
  expect(result.platform).toBe('ios');
  expect(result.name).toBeUndefined();
  expect(result.model).toBeUndefined();
  expect(result.osVersion).toBeUndefined();
});

// ─── Test 6: DeviceSnapshotSchema parses complete snapshot with all fields ───

test('DeviceSnapshotSchema parses complete device snapshot with all fields', () => {
  const result = DeviceSnapshotSchema.parse({
    udid: '00008110-001234567890001A',
    name: 'iPhone 15 Pro',
    model: 'iPhone15,2',
    osVersion: '17.4',
    battery: 85,
    trusted: true,
    developerMode: true,
  });
  expect(result.udid).toBe('00008110-001234567890001A');
  expect(result.name).toBe('iPhone 15 Pro');
  expect(result.model).toBe('iPhone15,2');
  expect(result.osVersion).toBe('17.4');
  expect(result.battery).toBe(85);
  expect(result.trusted).toBe(true);
  expect(result.developerMode).toBe(true);
});

// ─── Test 7: TapInputSchema validates x,y in 0-1 range ───

test('TapInputSchema validates x,y in 0-1 range (reject x=1.5, y=-0.1)', () => {
  const valid = TapInputSchema.parse({
    deviceId: 'device-1',
    x: 0.5,
    y: 0.75,
  });
  expect(valid.x).toBe(0.5);
  expect(valid.y).toBe(0.75);

  expect(() => TapInputSchema.parse({ deviceId: 'device-1', x: 1.5, y: 0.5 })).toThrow();
  expect(() => TapInputSchema.parse({ deviceId: 'device-1', x: 0.5, y: -0.1 })).toThrow();
});

// ─── Test 8: ActionResultSchema parses success case ───

test('ActionResultSchema parses success case (only success: true)', () => {
  const result = ActionResultSchema.parse({
    success: true,
  });
  expect(result.success).toBe(true);
  expect(result.message).toBeUndefined();
  expect(result.error).toBeUndefined();
});

// ─── Test 9: ActionResultSchema parses failure case ───

test('ActionResultSchema parses failure case (success: false, error message)', () => {
  const result = ActionResultSchema.parse({
    success: false,
    error: 'Device not found: ABC123',
  });
  expect(result.success).toBe(false);
  expect(result.error).toBe('Device not found: ABC123');
  expect(result.message).toBeUndefined();
});

// ─── Test 10: SwipeInputSchema parses with optional durationMs ───

test('SwipeInputSchema parses with optional durationMs', () => {
  const withDuration = SwipeInputSchema.parse({
    deviceId: 'device-1',
    fromX: 0.2,
    fromY: 0.8,
    toX: 0.2,
    toY: 0.3,
    durationMs: 500,
  });
  expect(withDuration.durationMs).toBe(500);

  const withoutDuration = SwipeInputSchema.parse({
    deviceId: 'device-1',
    fromX: 0.2,
    fromY: 0.8,
    toX: 0.2,
    toY: 0.3,
  });
  expect(withoutDuration.durationMs).toBeUndefined();
});

// ─── Test 11: Round-trip: ArtifactRefSchema parse → JSON.stringify → parse ───

test('Round-trip: ArtifactRefSchema parse → JSON.stringify → parse', () => {
  const original = {
    id: 'vid-001',
    type: 'video' as const,
    path: 'artifacts/session.mp4',
    mimeType: 'video/mp4',
    sizeBytes: 2048000,
    sha256: 'deadbeef',
    redactionStatus: 'safe' as const,
  };
  const parsed = parseArtifactRef(original);
  expect(parsed.id).toBe('vid-001');
  expect(parsed.type).toBe('video');

  const serialized = JSON.stringify(parsed);
  const reparsed = parseArtifactRef(JSON.parse(serialized));
  expect(reparsed.id).toBe(original.id);
  expect(reparsed.type).toBe(original.type);
  expect(reparsed.path).toBe(original.path);
  expect(reparsed.mimeType).toBe(original.mimeType);
  expect(reparsed.sizeBytes).toBe(original.sizeBytes);
  expect(reparsed.sha256).toBe(original.sha256);
  expect(reparsed.redactionStatus).toBe(original.redactionStatus);
});

// ─── Test 12: All artifact type enum values parse correctly ───

test('ArtifactTypeSchema parses all 9 valid artifact types', () => {
  const types = [
    'screenshot',
    'video',
    'uitree',
    'log',
    'crashlog',
    'trace',
    'xcresult',
    'json',
    'text',
  ] as const;
  for (const t of types) {
    expect(ArtifactTypeSchema.parse(t)).toBe(t);
  }
});

// ─── Test 13: Input schemas parse correctly ───

test('All input schemas parse valid inputs', () => {
  const launch = LaunchAppInputSchema.parse({
    deviceId: 'd1',
    bundleId: 'com.example.app',
  });
  expect(launch.bundleId).toBe('com.example.app');

  const terminate = TerminateAppInputSchema.parse({
    deviceId: 'd1',
    bundleId: 'com.example.app',
  });
  expect(terminate.bundleId).toBe('com.example.app');

  const typeText = TypeTextInputSchema.parse({
    deviceId: 'd1',
    text: 'hello world',
  });
  expect(typeText.text).toBe('hello world');

  const pressBtn = PressButtonInputSchema.parse({
    deviceId: 'd1',
    button: 'home',
  });
  expect(pressBtn.button).toBe('home');

  const openUrl = OpenUrlInputSchema.parse({
    deviceId: 'd1',
    url: 'https://example.com',
  });
  expect(openUrl.url).toBe('https://example.com');

  const screenshot = ScreenshotInputSchema.parse({ deviceId: 'd1' });
  expect(screenshot.deviceId).toBe('d1');

  const recording = RecordingInputSchema.parse({
    deviceId: 'd1',
    type: 'video',
  });
  expect(recording.type).toBe('video');

  const logCollect = LogCollectInputSchema.parse({
    deviceId: 'd1',
    type: 'syslog',
  });
  expect(logCollect.type).toBe('syslog');
});
