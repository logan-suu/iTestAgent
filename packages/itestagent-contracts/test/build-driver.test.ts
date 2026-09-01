import { expect, test } from 'bun:test';
import {
  ArchiveInputSchema,
  ArchiveResultSchema,
  BuildDoctorResultSchema,
  BuildInputSchema,
  BuildResultSchema,
  BuildSettingsInputSchema,
  BuildSettingsSchema,
  SchemeInfoSchema,
  TestInputSchema,
  TestResultSchema,
} from '../src/build-driver.js';

/**
 * B01 characterization tests for the BuildDriver contract schemas
 * (src/build-driver.ts). These pin down the CURRENT real behavior of the
 * schemas — including `.strict()` unknown-key rejection and numeric bounds —
 * so later batches (B05/B37 contracts exports-map work) cannot silently
 * change the wire format.
 */

// ─── BuildDoctorResultSchema ─────────────────────────────────

test('BuildDoctorResultSchema parses a valid doctor result', () => {
  const result = BuildDoctorResultSchema.parse({
    xcodeInstalled: true,
    xcodeVersion: 'Xcode 26.0',
    commandLineTools: true,
    signingIdentities: ['Apple Development: dev@example.com'],
    issues: [],
    suggestions: [],
  });
  expect(result.xcodeInstalled).toBe(true);
  expect(result.xcodeVersion).toBe('Xcode 26.0');
  expect(result.signingIdentities).toHaveLength(1);
});

test('BuildDoctorResultSchema rejects unknown keys (.strict())', () => {
  expect(() =>
    BuildDoctorResultSchema.parse({
      xcodeInstalled: true,
      commandLineTools: true,
      signingIdentities: [],
      issues: [],
      suggestions: [],
      extraKey: 'nope',
    }),
  ).toThrow();
});

test('BuildDoctorResultSchema requires issues and suggestions arrays', () => {
  expect(() =>
    BuildDoctorResultSchema.parse({
      xcodeInstalled: true,
      commandLineTools: true,
      signingIdentities: [],
    }),
  ).toThrow();
});

// ─── SchemeInfoSchema ────────────────────────────────────────

test('SchemeInfoSchema parses all three scheme types', () => {
  for (const type of ['app', 'test', 'other'] as const) {
    const parsed = SchemeInfoSchema.parse({
      name: `MyApp_${type}`,
      type,
      buildConfigurations: ['Debug', 'Release'],
    });
    expect(parsed.type).toBe(type);
  }
});

test('SchemeInfoSchema rejects an unknown scheme type', () => {
  expect(() =>
    SchemeInfoSchema.parse({
      name: 'MyApp',
      type: 'framework',
      buildConfigurations: ['Debug'],
    }),
  ).toThrow();
});

// ─── BuildSettingsInputSchema / BuildSettingsSchema ──────────

test('BuildSettingsInputSchema parses with optional configuration', () => {
  const minimal = BuildSettingsInputSchema.parse({ root: '/repo', scheme: 'MyApp' });
  expect(minimal.configuration).toBeUndefined();

  const full = BuildSettingsInputSchema.parse({
    root: '/repo',
    scheme: 'MyApp',
    configuration: 'Debug',
  });
  expect(full.configuration).toBe('Debug');
});

test('BuildSettingsSchema accepts arbitrary settings record values', () => {
  const parsed = BuildSettingsSchema.parse({
    settings: {
      PRODUCT_BUNDLE_IDENTIFIER: 'com.example.app',
      IPHONEOS_DEPLOYMENT_TARGET: '17.0',
      SWIFT_VERSION: 6,
      ENABLE_BITCODE: false,
    },
  });
  expect(parsed.settings.PRODUCT_BUNDLE_IDENTIFIER).toBe('com.example.app');
  expect(parsed.derivedDataPath).toBeUndefined();
});

// ─── BuildInputSchema / BuildResultSchema ────────────────────

test('BuildInputSchema parses valid build input with extraArgs', () => {
  const parsed = BuildInputSchema.parse({
    root: '/repo',
    scheme: 'MyApp',
    configuration: 'Release',
    deviceId: '00008110-001234567890001A',
    derivedDataPath: '/repo/.dd',
    extraArgs: ['-quiet', '-destination-timeout=30'],
  });
  expect(parsed.configuration).toBe('Release');
  expect(parsed.extraArgs).toEqual(['-quiet', '-destination-timeout=30']);
});

test('BuildInputSchema rejects configuration outside Debug|Release', () => {
  expect(() =>
    BuildInputSchema.parse({
      root: '/repo',
      scheme: 'MyApp',
      configuration: 'Beta',
      deviceId: 'device-1',
    }),
  ).toThrow();
});

test('BuildInputSchema rejects unknown keys (.strict())', () => {
  expect(() =>
    BuildInputSchema.parse({
      root: '/repo',
      scheme: 'MyApp',
      deviceId: 'device-1',
      clean: true,
    }),
  ).toThrow();
});

test('BuildResultSchema parses success result; durationMs must be non-negative int', () => {
  const ok = BuildResultSchema.parse({
    success: true,
    appPath: '/repo/build/App.app',
    log: 'BUILD SUCCEEDED',
    durationMs: 42000,
  });
  expect(ok.success).toBe(true);
  expect(ok.durationMs).toBe(42000);

  expect(() =>
    BuildResultSchema.parse({
      success: true,
      appPath: '/repo/build/App.app',
      installed: true,
      log: 'BUILD SUCCEEDED',
      durationMs: 42000,
    }),
  ).toThrow();

  expect(() => BuildResultSchema.parse({ success: false, log: 'x', durationMs: -1 })).toThrow();
  expect(() => BuildResultSchema.parse({ success: false, log: 'x', durationMs: 1.5 })).toThrow();
});

// ─── TestInputSchema / TestResultSchema ──────────────────────

test('TestInputSchema parses with optional testPlan/only/skip', () => {
  const parsed = TestInputSchema.parse({
    root: '/repo',
    scheme: 'MyApp',
    deviceId: 'device-1',
    testPlan: 'SmokeTestPlan',
    only: ['MyAppTests/LoginTests'],
    skip: ['MyAppTests/FlakyTests'],
  });
  expect(parsed.testPlan).toBe('SmokeTestPlan');
  expect(parsed.only).toEqual(['MyAppTests/LoginTests']);
});

test('TestResultSchema parses counts; rejects negative or fractional counters', () => {
  const ok = TestResultSchema.parse({
    success: true,
    totalTests: 12,
    passed: 11,
    failed: 1,
    xcresultPath: '/tmp/result.xcresult',
    log: 'TEST SUCCEEDED',
    durationMs: 9000,
  });
  expect(ok.totalTests).toBe(12);
  expect(ok.failed).toBe(1);

  expect(() =>
    TestResultSchema.parse({
      success: true,
      totalTests: 1,
      passed: 0,
      failed: -1,
      log: '',
      durationMs: 0,
    }),
  ).toThrow();
  expect(() =>
    TestResultSchema.parse({
      success: true,
      totalTests: 2.5,
      passed: 2,
      failed: 0,
      log: '',
      durationMs: 0,
    }),
  ).toThrow();
});

// ─── ArchiveInputSchema / ArchiveResultSchema ────────────────

test('ArchiveInputSchema requires outputDir; configuration enum enforced', () => {
  const ok = ArchiveInputSchema.parse({
    root: '/repo',
    scheme: 'MyApp',
    configuration: 'Release',
    outputDir: '/repo/archives',
  });
  expect(ok.outputDir).toBe('/repo/archives');

  expect(() => ArchiveInputSchema.parse({ root: '/repo', scheme: 'MyApp' })).toThrow();
  expect(() =>
    ArchiveInputSchema.parse({
      root: '/repo',
      scheme: 'MyApp',
      configuration: 'AdHoc',
      outputDir: '/x',
    }),
  ).toThrow();
});

test('ArchiveResultSchema parses archive/ipa paths; log is required', () => {
  const ok = ArchiveResultSchema.parse({
    success: true,
    archivePath: '/repo/archives/App.xcarchive',
    ipaPath: '/repo/archives/App.ipa',
    log: 'ARCHIVE SUCCEEDED',
    durationMs: 120000,
  });
  expect(ok.archivePath).toBe('/repo/archives/App.xcarchive');
  expect(ok.ipaPath).toBe('/repo/archives/App.ipa');

  expect(() => ArchiveResultSchema.parse({ success: true, durationMs: 1000 })).toThrow();
});
