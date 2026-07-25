/**
 * WDA preinstalled on physical device check — doctor physical readiness lane.
 *
 * US-1.2 AC1: pass/fail/manual three-state.
 * US-1.3 AC1: recognizes "WDA not installed" scenario for physical devices.
 *
 * Checks whether the WebDriverAgentRunner is already installed on the target
 * physical device. This is critical for the Appium free-account unblock flow
 * (Route A — preinstalled mode).
 *
 * Uses `xcrun devicectl device info app` to query installed apps on the
 * connected device by bundle ID pattern (*WebDriverAgentRunner*).
 * Also checks provisioning profile expiry.
 *
 * Returns:
 *   - 'pass' if WDA Runner installed + provisioning profile valid
 *   - 'fail' if not installed or profile expired
 *   - 'manual' if no device connected or devicectl unavailable
 *
 * AGENTS.md §2 (R2): uses devicectl (Apple official tool), no private APIs.
 * AGENTS.md §3.1.4 (R12): comments in English.
 */
import type { DoctorCheckResult } from '../types.js';
import { exec } from '../utils.js';

/**
 * Parse devicectl app info JSON output to find installed WDA bundle IDs.
 *
 * Returns array of bundle IDs matching the WebDriverAgentRunner pattern.
 */
function findWdaBundleIds(stdout: string): string[] {
  try {
    const parsed = JSON.parse(stdout) as {
      apps?: Array<{
        bundleIdentifier?: string;
        name?: string;
        version?: string;
      }>;
    };
    const apps = parsed?.apps ?? [];
    return apps
      .filter((app) => app.bundleIdentifier && /WebDriverAgentRunner/i.test(app.bundleIdentifier))
      .map((app) => app.bundleIdentifier as string);
  } catch {
    // JSON parse failed — try text-based fallback
    const matches = stdout.matchAll(/\b[\w.]+WebDriverAgentRunner[\w.]*/gi);
    return Array.from(matches).map((m) => m[0]);
  }
}

/**
 * Extract connected physical device UDIDs from devicectl list output.
 */
function getPhysicalDeviceUdids(): string[] {
  const result = exec('xcrun', ['devicectl', 'list', 'devices']);
  if (result.exitCode !== 0) return [];

  const udids: string[] = [];
  const lines = result.stdout.split('\n');
  for (const line of lines) {
    // Skip simulator entries
    if (line.includes('Simulator') || line.includes('CoreSimulator')) continue;
    const match = line.match(/([0-9A-Fa-f]{25,40})/);
    if (match?.[1]) {
      udids.push(match[1]);
    }
  }
  return udids;
}

/**
 * Check if a provisioning profile has expired via devicectl app info.
 *
 * devicectl may include profileExpiry or profileIsValid fields.
 * This is a best-effort check (R5: explicit uncertainty).
 */
function checkProfileExpiry(appInfo: string): { valid: boolean; expiry?: string } {
  try {
    const parsed = JSON.parse(appInfo) as {
      apps?: Array<{
        bundleIdentifier?: string;
        profileIsValid?: boolean;
        profileExpiryDate?: string;
      }>;
    };
    const wdaApps = (parsed?.apps ?? []).filter(
      (app) => app.bundleIdentifier && /WebDriverAgentRunner/i.test(app.bundleIdentifier),
    );

    if (wdaApps.length === 0) {
      return { valid: false };
    }

    const wdaApp = wdaApps[0];
    if (!wdaApp) {
      return { valid: false };
    }
    if (wdaApp.profileIsValid === false) {
      return { valid: false, expiry: wdaApp.profileExpiryDate };
    }

    return { valid: true };
  } catch {
    // JSON parse failed — cannot determine from text output
    return { valid: true }; // Assume valid, flag as uncertain
  }
}

export async function checkWdaPreinstalled(): Promise<DoctorCheckResult> {
  const details: string[] = [];
  const issues: string[] = [];

  // ── Step 1: Check for connected physical devices ───────────────
  const deviceUdids = getPhysicalDeviceUdids();

  if (deviceUdids.length === 0) {
    return {
      name: 'WDA Preinstalled',
      status: 'manual',
      message: 'No physical device connected. Cannot check for preinstalled WDA.',
      fixGuide: [
        'Connect an iPhone via USB and ensure it is trusted',
        'Verify connection: xcrun devicectl list devices',
        'Enable Developer Mode on the device: Settings > Privacy & Security > Developer Mode',
      ],
    };
  }

  details.push(`Connected devices: ${deviceUdids.length}`);
  let anyWdaFound = false;
  let allProfilesValid = true;
  let anyProfileExpired = false;
  const foundBundleIds: string[] = [];
  const expiredBundleIds: string[] = [];
  const unavailableDevices: string[] = [];

  // ── Step 2: Check each device for WDA ──────────────────────────
  for (const udid of deviceUdids) {
    const appInfo = exec('xcrun', [
      'devicectl',
      'device',
      'info',
      'app',
      '--device',
      udid,
      '--json',
    ]);

    if (appInfo.exitCode !== 0) {
      unavailableDevices.push(udid);
      details.push(`  Device ${udid.slice(0, 8)}...: devicectl unavailable`);
      continue;
    }

    const wdaIds = findWdaBundleIds(appInfo.stdout);
    if (wdaIds.length > 0) {
      anyWdaFound = true;
      foundBundleIds.push(...wdaIds);
      details.push(`  Device ${udid.slice(0, 8)}...: WDA found (${wdaIds.join(', ')})`);

      // Check provisioning profile expiry
      const { valid, expiry } = checkProfileExpiry(appInfo.stdout);
      if (!valid) {
        allProfilesValid = false;
        anyProfileExpired = true;
        expiredBundleIds.push(...wdaIds);
        details.push(`    ⚠ Profile expired${expiry ? ` (expired: ${expiry})` : ''}`);
      } else {
        details.push('    Profile: valid');
      }
    } else {
      details.push(`  Device ${udid.slice(0, 8)}...: WDA not found`);
    }
  }

  // ── Step 3: Assessment ─────────────────────────────────────────

  // All devices unavailable
  if (unavailableDevices.length === deviceUdids.length) {
    return {
      name: 'WDA Preinstalled',
      status: 'manual',
      message: 'Cannot query installed apps on connected devices (devicectl error).',
      fixGuide: [
        'Ensure the device is trusted and Developer Mode is enabled',
        'Update Xcode Command Line Tools: xcode-select --install',
        'Try manually: xcrun devicectl device info app --device <UDID>',
      ],
      details: details.join('\n'),
    };
  }

  // WDA found but profile expired
  if (anyWdaFound && anyProfileExpired) {
    return {
      name: 'WDA Preinstalled',
      status: 'fail',
      message: `WDA Runner provisioning profile expired for: ${expiredBundleIds.join(', ')}.`,
      fixGuide: [
        'Rebuild WDA with a fresh provisioning profile: run preparePreinstalledWDA()',
        'Use WdaManager.preparePreinstalledWDA() to rebuild + reinstall + verify',
        'Or use external-url mode as fallback (Route B)',
        'Check profile expiry in Xcode: Window > Devices and Simulators',
      ],
      details: details.join('\n'),
    };
  }

  // WDA found and profiles valid
  if (anyWdaFound && allProfilesValid) {
    return {
      name: 'WDA Preinstalled',
      status: 'pass',
      message: `WDA Runner preinstalled on device (${foundBundleIds.join(', ')}). Profiles valid.`,
      fixGuide: [
        'Route A (preinstalled) is ready — use wdaStartupMode: "preinstalled"',
        'Ensure iOS 17+ for usePreinstalledWDA capability',
      ],
      details: details.join('\n'),
    };
  }

  // WDA not found on any device
  return {
    name: 'WDA Preinstalled',
    status: 'fail',
    message: 'WDA Runner not installed on any connected physical device.',
    fixGuide: [
      'Route A (preinstalled): build + install WDA via WdaManager.preparePreinstalledWDA()',
      'Build command: xcodebuild -project WebDriverAgent.xcodeproj -scheme WebDriverAgentRunner -destination "platform=iOS,id=<UDID>" build-for-testing',
      'Install via: xcrun devicectl device install app --device <UDID> <WDA-Runner.app>',
      'Alternatively, use Route B (external-url) or Route C (managed-xcodebuild)',
      'See AGENTS.md Phase 0 Appium/WDA notes for free account workaround',
    ],
    details: details.join('\n'),
  };
}
