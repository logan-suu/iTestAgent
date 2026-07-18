/**
 * WebDriverAgent project readiness check — doctor physical readiness lane.
 *
 * US-1.2 AC1: pass/fail/manual three-state.
 * US-1.3 AC1: recognizes "signing unavailable / backend not ready".
 *
 * Checks:
 *   1. WDA project existence (from Appium XCUITest driver install path)
 *   2. WDA project has a valid build config (Xcode project or workspace)
 *   3. Simulator WDA: auto-build works without signing (per G5-SIM T1.6)
 *   4. Physical WDA: requires explicit signing setup
 *
 * AGENTS.md §2 (R2): reuses Appium WDA, no self-built replacement.
 */
import type { DoctorCheckResult } from '../types.js';

/** Execute a command and return { exitCode, stdout, stderr }. */
function exec(cmd: string, args: string[]): { exitCode: number; stdout: string; stderr: string } {
  try {
    const result = Bun.spawnSync({ cmd: [cmd, ...args] });
    return {
      exitCode: result.exitCode,
      stdout: result.stdout.toString().trim(),
      stderr: result.stderr.toString().trim(),
    };
  } catch {
    return { exitCode: -1, stdout: '', stderr: 'command not found' };
  }
}

export async function checkWda(): Promise<DoctorCheckResult> {
  // Find WDA path via appium driver
  const driverInfo = exec('appium', ['driver', 'list', '--installed', '--json']);
  const details: string[] = [];
  const issues: string[] = [];
  let wdaFound = false;
  let wdaPath = '';

  // Try to extract WDA path from JSON output
  if (driverInfo.exitCode === 0 && driverInfo.stdout) {
    try {
      const parsed = JSON.parse(driverInfo.stdout);
      // Appium 3.x driver list JSON structure
      const drivers = parsed as Record<string, unknown>;
      if ('xcuitest' in drivers) {
        const xcuitest = drivers.xcuitest as Record<string, unknown>;
        if (xcuitest && typeof xcuitest.path === 'string') {
          wdaPath = xcuitest.path as string;
          details.push(`XCUITest driver path: ${wdaPath}`);
        }
      }
    } catch {
      // Non-JSON output, try text fallback
      details.push(`driver list: ${driverInfo.stdout.slice(0, 200)}`);
    }
  }

  // If we have a driver path, check for WDA project
  if (wdaPath) {
    // WDA is typically at <driver-path>/appium-xcuitest-driver/node_modules/appium-webdriveragent
    const wdaCandidates = [
      `${wdaPath}/node_modules/appium-webdriveragent`,
      `${wdaPath}/../appium-webdriveragent`,
    ];

    for (const candidate of wdaCandidates) {
      const pbxproj = exec('find', [candidate, '-name', 'project.pbxproj', '-maxdepth', '3']);
      if (pbxproj.exitCode === 0 && pbxproj.stdout) {
        wdaFound = true;
        details.push(`WDA project found: ${pbxproj.stdout}`);
        break;
      }
    }
  }

  // Fallback: search in common npm global paths
  if (!wdaFound) {
    const globalSearch = exec('find', [
      '/usr/local/lib',
      '-path',
      '*/appium-webdriveragent/*.xcodeproj/project.pbxproj',
      '-maxdepth',
      '8',
    ]);
    if (globalSearch.exitCode === 0 && globalSearch.stdout) {
      wdaFound = true;
      details.push(`WDA project found (global search): ${globalSearch.stdout}`);
    }
  }

  if (wdaFound) {
    details.push('WDA signing: requires manual setup for physical devices');
    details.push('Simulator WDA: auto-build available (no signing required)');
    return {
      name: 'WebDriverAgent (WDA)',
      status: 'manual',
      message: 'WDA project exists. Physical device requires signing setup.',
      fixGuide: [
        'Physical device: set WDA bundle ID (e.g., UJ876FXT32.*) and allow provisioning updates',
        'Build WDA for physical: xcodebuild -project WebDriverAgent.xcodeproj -scheme WebDriverAgentRunner -destination "platform=iOS,id=<UDID>" -allowProvisioningUpdates',
        'Simulator WDA: automatic build by Appium (no signing needed)',
        'See AGENTS.md Phase 0 notes for WDA signing workaround with free Apple ID',
      ],
      details: details.join('\n'),
    };
  }

  issues.push('WDA project not found');
  return {
    name: 'WebDriverAgent (WDA)',
    status: 'fail',
    message: issues.join('; '),
    fixGuide: [
      'Ensure Appium XCUITest driver is installed: appium driver install xcuitest',
      'WDA project is bundled with the XCUITest driver npm package (appium-webdriveragent)',
      'Reinstall XCUITest driver: appium driver uninstall xcuitest && appium driver install xcuitest',
    ],
    details: details.join('\n'),
  };
}
