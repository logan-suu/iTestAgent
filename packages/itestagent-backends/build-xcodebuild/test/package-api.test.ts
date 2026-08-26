/**
 * package-api.test.ts — B12 public API surface lock (promotion guide §11.3
 * "build-xcodebuild"). Guards the barrel against accidental export loss while
 * the driver was split into focused modules.
 */
import { describe, expect, it } from 'bun:test';

const EXPECTED_RUNTIME_EXPORTS = [
  // Existing surface (unchanged superset requirement)
  'createXcodebuildBuildDriver',
  'pipeThroughXcbeautify',
  'resolveAppSource',
  'APP_SOURCE_STRATEGIES',
  'createDevicectlOps',
  'diagnoseSigningError',
  'hasSigningError',
  // B12 additions
  'createSimctlOps',
  'runXcodebuildTests',
  'buildForSimulator',
  'buildForPhysical',
  'destinationArgs',
  'parseDevicectlListDevices',
  'parseDevicectlProcesses',
  'parseDevicectlDetailsText',
  'parseStrictJsonObject',
  'DevicectlParseError',
] as const;

describe('build-xcodebuild package API (B12)', () => {
  it('exports every runtime symbol from the barrel', async () => {
    const barrel = (await import('../src/index.js')) as Record<string, unknown>;
    const missing = EXPECTED_RUNTIME_EXPORTS.filter((name) => barrel[name] === undefined);
    expect(missing).toEqual([]);
  });
});
