/**
 * Simulator runtime check — doctor simulator readiness lane.
 *
 * US-1.2 AC1: pass/fail/manual three-state.
 * US-1.2 AC2: fix guidance for failures.
 *
 * Checks:
 *   1. xcrun simctl list runtimes --json → parse JSON for iOS runtime entries
 *   2. Verify at least one iOS simulator runtime is installed
 *
 * 避坑手册 §3: Simulator runtime not installed or version mismatch → SDK build fails.
 * simctl JSON output keys may change across Xcode versions — defensive field access.
 */
import type { DoctorCheckResult } from '../types.js';
import { exec } from '../utils.js';

/** Expected top-level key in simctl JSON output (varies by Xcode version). */
function extractRuntimes(raw: string): Array<Record<string, unknown>> {
  try {
    const parsed = JSON.parse(raw);
    // Xcode 15+: { "runtimes": [...] }
    if (Array.isArray(parsed.runtimes)) return parsed.runtimes as Array<Record<string, unknown>>;
    // Xcode 14 fallback: { "result": { "runtimes": [...] } }
    if (parsed.result?.runtimes && Array.isArray(parsed.result.runtimes)) {
      return parsed.result.runtimes as Array<Record<string, unknown>>;
    }
    // Unknown shape — try any top-level array
    for (const key of Object.keys(parsed)) {
      if (Array.isArray(parsed[key])) return parsed[key] as Array<Record<string, unknown>>;
    }
    return [];
  } catch {
    return [];
  }
}

export async function checkSimulatorRuntime(): Promise<DoctorCheckResult> {
  const runtimes = exec('xcrun', ['simctl', 'list', 'runtimes', '--json']);
  const details: string[] = [];

  if (runtimes.exitCode !== 0 || !runtimes.stdout) {
    return {
      name: 'Simulator Runtime',
      status: 'fail',
      message: `Cannot query simulator runtimes: ${runtimes.stderr || 'no output'}`,
      fixGuide: [
        'Ensure Xcode is installed and xcrun is available',
        'Verify: xcrun simctl list runtimes',
        'Download a simulator runtime in Xcode: Xcode > Settings > Platforms',
      ],
      details: runtimes.stderr,
    };
  }

  const runtimeList = extractRuntimes(runtimes.stdout);
  details.push(`Total runtimes found: ${runtimeList.length}`);

  // Filter for iOS runtimes (exclude watchOS, tvOS, visionOS)
  const iosRuntimes = runtimeList.filter((r) => {
    const name = String(r.name ?? r.displayName ?? '');
    return name.toLowerCase().includes('ios');
  });

  if (iosRuntimes.length > 0) {
    const versions = iosRuntimes
      .map((r) => String(r.name ?? r.displayName ?? r.version ?? 'unknown'))
      .join(', ');
    return {
      name: 'Simulator Runtime',
      status: 'pass',
      message: `${iosRuntimes.length} iOS simulator runtime(s) installed`,
      details: [details[0], `iOS runtimes: ${versions}`].join('\n'),
    };
  }

  return {
    name: 'Simulator Runtime',
    status: 'fail',
    message: 'No iOS simulator runtime installed',
    fixGuide: [
      'Open Xcode > Settings > Platforms (or Components in older Xcode)',
      'Download an iOS Simulator runtime (e.g., iOS 18.x)',
      'Or install via CLI: xcodebuild -downloadPlatform iOS',
      'Verify: xcrun simctl list runtimes',
    ],
    details: details.join('\n'),
  };
}
