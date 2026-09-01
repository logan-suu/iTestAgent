/**
 * Appium WDA capabilities unit tests — mutual exclusivity, mode-specific outputs.
 *
 * Tests buildPhysicalCapabilities() validation rules and mode-specific
 * capability generation for all three WdaStartupModes.
 *
 * Requirements:
 *   - At least 12 test cases covering mutual exclusivity, correct capability output,
 *     .xctrunner suffix rejection, and optional parameter forwarding.
 *
 * R5: All validation errors are explicit — never silently degrade.
 */
import { describe, expect, it } from 'bun:test';
import { buildPhysicalCapabilities } from '../src/index.js';

const TEST_UDID = '00008110-00123456A12B001E';

// ═══════════════════════════════════════════════════════════════════════
// Mutual exclusivity validation
// ═══════════════════════════════════════════════════════════════════════

describe('buildPhysicalCapabilities — mutual exclusivity', () => {
  it('preinstalled mode: webDriverAgentUrl causes error', () => {
    expect(() =>
      buildPhysicalCapabilities({
        udid: TEST_UDID,
        wdaStartupMode: 'preinstalled',
        webDriverAgentUrl: 'http://127.0.0.1:8100',
      }),
    ).toThrow(/webDriverAgentUrl is not allowed in preinstalled mode/);
  });

  it('preinstalled mode: xcodeOrgId causes error', () => {
    expect(() =>
      buildPhysicalCapabilities({
        udid: TEST_UDID,
        wdaStartupMode: 'preinstalled',
        xcodeOrgId: 'TEAM123',
      }),
    ).toThrow(/xcodeOrgId.*not allowed in preinstalled mode/);
  });

  it('external-url mode: webDriverAgentUrl is required (missing → throws)', () => {
    expect(() =>
      buildPhysicalCapabilities({
        udid: TEST_UDID,
        wdaStartupMode: 'external-url',
      }),
    ).toThrow(/webDriverAgentUrl is required for external-url mode/);
  });

  it('external-url mode: usePrebuiltWDA causes error', () => {
    expect(() =>
      buildPhysicalCapabilities({
        udid: TEST_UDID,
        wdaStartupMode: 'external-url',
        webDriverAgentUrl: 'http://127.0.0.1:8100',
        usePrebuiltWDA: true,
      }),
    ).toThrow(/usePrebuiltWDA is not allowed in external-url mode/);
  });

  it('external-url mode: xcodeOrgId + xcodeSigningId causes error', () => {
    expect(() =>
      buildPhysicalCapabilities({
        udid: TEST_UDID,
        wdaStartupMode: 'external-url',
        webDriverAgentUrl: 'http://127.0.0.1:8100',
        xcodeOrgId: 'TEAM123',
        xcodeSigningId: 'Apple Development',
      }),
    ).toThrow(/xcodeOrgId.*not allowed in external-url mode/);
  });

  it('managed-xcodebuild mode: webDriverAgentUrl causes error', () => {
    expect(() =>
      buildPhysicalCapabilities({
        udid: TEST_UDID,
        wdaStartupMode: 'managed-xcodebuild',
        webDriverAgentUrl: 'http://127.0.0.1:8100',
      }),
    ).toThrow(/webDriverAgentUrl is not allowed in managed-xcodebuild mode/);
  });
});

// ═══════════════════════════════════════════════════════════════════════
// .xctrunner suffix rejection
// ═══════════════════════════════════════════════════════════════════════

describe('buildPhysicalCapabilities — wdaBundleId validation', () => {
  it('rejects wdaBundleId ending with .xctrunner (double-suffix guard)', () => {
    expect(() =>
      buildPhysicalCapabilities({
        udid: TEST_UDID,
        wdaStartupMode: 'managed-xcodebuild',
        wdaBundleId: 'TEAMID.WebDriverAgentRunner.xctrunner',
      }),
    ).toThrow(/without .xctrunner suffix/);
  });

  it('accepts base wdaBundleId without .xctrunner', () => {
    const caps = buildPhysicalCapabilities({
      udid: TEST_UDID,
      wdaStartupMode: 'managed-xcodebuild',
      wdaBundleId: 'TEAMID.WebDriverAgentRunner',
    });
    expect(caps['appium:updatedWDABundleId']).toBe('TEAMID.WebDriverAgentRunner');
  });

  it('validates .xctrunner rejection across all modes', () => {
    const modes: Array<'preinstalled' | 'external-url' | 'managed-xcodebuild'> = [
      'preinstalled',
      'external-url',
      'managed-xcodebuild',
    ];
    for (const mode of modes) {
      expect(() =>
        buildPhysicalCapabilities({
          udid: TEST_UDID,
          wdaStartupMode: mode,
          wdaBundleId: 'BAD.ID.xctrunner',
          webDriverAgentUrl: mode === 'external-url' ? 'http://127.0.0.1:8100' : undefined,
        }),
      ).toThrow(/without .xctrunner suffix/);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════
// Mode-specific capability output
// ═══════════════════════════════════════════════════════════════════════

describe('buildPhysicalCapabilities — preinstalled mode', () => {
  it('generates usePreinstalledWDA: true (NOT usePrebuiltWDA)', () => {
    const caps = buildPhysicalCapabilities({
      udid: TEST_UDID,
      wdaStartupMode: 'preinstalled',
    });

    expect(caps['appium:usePreinstalledWDA']).toBe(true);
    expect(caps['appium:usePrebuiltWDA']).toBeUndefined();
  });

  it('generates updatedWDABundleId from base ID (no .xctrunner)', () => {
    const caps = buildPhysicalCapabilities({
      udid: TEST_UDID,
      wdaStartupMode: 'preinstalled',
      wdaBundleId: 'UJ876FXT32.WebDriverAgentRunner',
    });

    expect(caps['appium:updatedWDABundleId']).toBe('UJ876FXT32.WebDriverAgentRunner');
    // Should NOT contain .xctrunner
    expect(caps['appium:updatedWDABundleId']).not.toContain('.xctrunner');
  });

  it('does NOT include xcodeOrgId or xcodeSigningId (Appium skips xcodebuild)', () => {
    const caps = buildPhysicalCapabilities({
      udid: TEST_UDID,
      wdaStartupMode: 'preinstalled',
    });

    expect(caps['appium:xcodeOrgId']).toBeUndefined();
    expect(caps['appium:xcodeSigningId']).toBeUndefined();
    expect(caps['appium:allowProvisioningDeviceRegistration']).toBeUndefined();
  });
});

describe('buildPhysicalCapabilities — external-url mode', () => {
  it('generates webDriverAgentUrl', () => {
    const caps = buildPhysicalCapabilities({
      udid: TEST_UDID,
      wdaStartupMode: 'external-url',
      webDriverAgentUrl: 'http://127.0.0.1:8200',
    });

    expect(caps['appium:webDriverAgentUrl']).toBe('http://127.0.0.1:8200');
    expect(caps['appium:usePreinstalledWDA']).toBeUndefined();
    expect(caps['appium:usePrebuiltWDA']).toBeUndefined();
  });

  it('does NOT include xcodeOrgId or xcodeSigningId', () => {
    const caps = buildPhysicalCapabilities({
      udid: TEST_UDID,
      wdaStartupMode: 'external-url',
      webDriverAgentUrl: 'http://127.0.0.1:8100',
    });

    expect(caps['appium:xcodeOrgId']).toBeUndefined();
    expect(caps['appium:xcodeSigningId']).toBeUndefined();
  });
});

describe('buildPhysicalCapabilities — managed-xcodebuild mode', () => {
  it('generates xcodeOrgId, xcodeSigningId, and allowProvisioningDeviceRegistration when provided', () => {
    const caps = buildPhysicalCapabilities({
      udid: TEST_UDID,
      wdaStartupMode: 'managed-xcodebuild',
      xcodeOrgId: 'ABC123TEAM',
      xcodeSigningId: 'iPhone Developer',
      allowProvisioningDeviceRegistration: true,
    });

    expect(caps['appium:xcodeOrgId']).toBe('ABC123TEAM');
    expect(caps['appium:xcodeSigningId']).toBe('iPhone Developer');
    expect(caps['appium:allowProvisioningDeviceRegistration']).toBe(true);
  });

  it('includes updatedWDABundleId when wdaBundleId is provided', () => {
    const caps = buildPhysicalCapabilities({
      udid: TEST_UDID,
      wdaStartupMode: 'managed-xcodebuild',
      wdaBundleId: 'TEAMID.WebDriverAgentRunner',
    });

    expect(caps['appium:updatedWDABundleId']).toBe('TEAMID.WebDriverAgentRunner');
  });

  it('includes usePrebuiltWDA when requested', () => {
    const caps = buildPhysicalCapabilities({
      udid: TEST_UDID,
      wdaStartupMode: 'managed-xcodebuild',
      usePrebuiltWDA: true,
    });

    expect(caps['appium:usePrebuiltWDA']).toBe(true);
    expect(caps['appium:usePreinstalledWDA']).toBeUndefined();
  });
});

// ═══════════════════════════════════════════════════════════════════════
// Common optional parameters
// ═══════════════════════════════════════════════════════════════════════

describe('buildPhysicalCapabilities — common options', () => {
  it('forwards bundleId, deviceName, and platformVersion', () => {
    const caps = buildPhysicalCapabilities({
      udid: TEST_UDID,
      wdaStartupMode: 'managed-xcodebuild',
      bundleId: 'com.example.myapp',
      deviceName: 'iPhone 15 Pro',
      platformVersion: '18.3',
    });

    expect(caps['appium:bundleId']).toBe('com.example.myapp');
    expect(caps['appium:deviceName']).toBe('iPhone 15 Pro');
    expect(caps['appium:platformVersion']).toBe('18.3');
  });

  it('forwards wdaLocalPort, mjpegServerPort, and derivedDataPath', () => {
    const caps = buildPhysicalCapabilities({
      udid: TEST_UDID,
      wdaStartupMode: 'managed-xcodebuild',
      wdaLocalPort: 8200,
      mjpegServerPort: 9200,
      derivedDataPath: '/tmp/custom-wda-build',
    });

    expect(caps['appium:wdaLocalPort']).toBe(8200);
    expect(caps['appium:mjpegServerPort']).toBe(9200);
    expect(caps['appium:derivedDataPath']).toBe('/tmp/custom-wda-build');
  });

  it('rejects an omitted WDA route', () => {
    expect(() =>
      buildPhysicalCapabilities({ udid: TEST_UDID } as Parameters<
        typeof buildPhysicalCapabilities
      >[0]),
    ).toThrow(/wdaStartupMode is required/);
  });
});

// ─── B13 seam: WDA active-application parser ───────────────────────

describe('B13 seam: WDA active-application parser', () => {
  it('parses the active bundle id from a status payload', async () => {
    const mod = await import('../src/wda-active-application.js');
    expect(mod.parseActiveBundleId('{"value":{"activeApp":"com.example.fixture"}}')).toBe(
      'com.example.fixture',
    );
  });
});
