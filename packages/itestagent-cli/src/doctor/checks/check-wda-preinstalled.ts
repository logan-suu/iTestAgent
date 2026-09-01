/**
 * WDA installation inventory check — doctor physical readiness lane.
 *
 * US-1.2 AC1: pass/fail/manual three-state.
 * US-1.3 AC1: recognizes "WDA not installed" scenario for physical devices.
 *
 * Checks whether the WebDriverAgentRunner is already installed on the target
 * physical device. Inventory is a prerequisite only and never proves active
 * WDA readiness (ADR-028 / DEF-031).
 *
 * Uses `xcrun devicectl device info app` to query installed apps on the
 * connected device by bundle ID pattern (*WebDriverAgentRunner*).
 * Returns:
 *   - 'manual' if WDA Runner is installed and needs an active Route B/C probe
 *   - 'fail' if not installed
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
      result?: {
        apps?: Array<{
          bundleIdentifier?: string;
          name?: string;
          version?: string;
        }>;
      };
      apps?: Array<{ bundleIdentifier?: string; name?: string; version?: string }>;
    };
    const apps = parsed.result?.apps ?? parsed.apps ?? [];
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
  const foundBundleIds: string[] = [];
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

      details.push('    Active readiness: not probed by inventory');
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

  // Inventory is not active readiness (ADR-028).
  if (anyWdaFound) {
    return {
      name: 'WDA Preinstalled',
      status: 'manual',
      message: `WDA Runner is installed (${foundBundleIds.join(', ')}), but active readiness is not proven.`,
      fixGuide: [
        'Select Route B (external-url) or Route C (managed-xcodebuild) explicitly',
        'Run an active WDA /status or Appium session probe on the selected device',
        'If the active probe reports signing or launch failure, prepare WDA after confirmation',
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
      'Build + install WDA via WdaManager.preparePreinstalledWDA() after confirmation',
      'Build command: xcodebuild -project WebDriverAgent.xcodeproj -scheme WebDriverAgentRunner -destination "platform=iOS,id=<UDID>" build-for-testing',
      'Install via: xcrun devicectl device install app --device <UDID> <WDA-Runner.app>',
      'Then use Route B (external-url) or Route C (managed-xcodebuild) for active readiness',
      'See AGENTS.md Phase 0 Appium/WDA notes for free account workaround',
    ],
    details: details.join('\n'),
  };
}
