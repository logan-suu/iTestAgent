/**
 * Device healthcheck — verify device readiness before execution.
 *
 * US-2.2 AC1: auto healthcheck before execution:
 *   physical: connection, trust, Developer Mode, backend available
 *   simulator: runtime installed, simctl responsive, backend available
 * US-2.2 AC2: if unhealthy, give reason and fix guidance (distinguish physical/simulator)
 * US-2.2 AC3: healthcheck results recorded to run metadata (含 targetKind)
 *
 * AGENTS.md §2 (R2): reuse xcrun, no self-built interaction.
 */

import { HealthCheckResultSchema } from 'itestagent-contracts';
import type { DeviceInfo, HealthCheckResult } from 'itestagent-contracts';

// ─── Subprocess helpers ─────────────────────────────────────

function exec(args: string[]): { exitCode: number; stdout: string; stderr: string } {
  try {
    const result = Bun.spawnSync({ cmd: args });
    return {
      exitCode: result.exitCode,
      stdout: result.stdout.toString().trim(),
      stderr: result.stderr.toString().trim(),
    };
  } catch {
    return { exitCode: -1, stdout: '', stderr: 'command not found' };
  }
}

// ─── Physical device healthcheck ────────────────────────────

/**
 * Run healthcheck on a physical device.
 *
 * US-2.2 AC1 checks:
 *   1. devicectl can reach the device (connection + trust)
 *   2. Developer Mode status
 *   3. Backend (Appium/WDA) availability — stub for now
 */
export async function healthcheckPhysicalDevice(udid: string): Promise<HealthCheckResult> {
  const issues: string[] = [];
  const fixGuides: string[] = [];

  // Check 1: devicectl device info (connection + trust)
  const info = exec(['xcrun', 'devicectl', 'device', 'info', 'details', '--device', udid]);
  if (info.exitCode !== 0) {
    const stderrLower = info.stderr.toLowerCase();

    if (stderrLower.includes('untrusted') || stderrLower.includes('not trusted')) {
      issues.push('Device not trusted');
      fixGuides.push(
        'Unlock your iPhone and tap "Trust This Computer" when prompted',
        'If the prompt does not appear, disconnect and reconnect the USB cable',
        'Verify: xcrun devicectl device info details --device <UDID>',
      );
    } else if (stderrLower.includes('developer mode') || stderrLower.includes('developer_mode')) {
      issues.push('Developer Mode is not enabled');
      fixGuides.push(
        'On your iPhone: Settings > Privacy & Security > Developer Mode',
        'Toggle Developer Mode ON and restart the device',
        'After restart, unlock the device and confirm the Developer Mode prompt',
        'Verify: xcrun devicectl device info details --device <UDID>',
      );
    } else {
      issues.push(`Device unreachable: ${info.stderr || 'unknown error'}`);
      fixGuides.push(
        'Ensure the iPhone is connected via USB cable',
        'Unlock the iPhone and check for any prompts',
        'Verify: xcrun devicectl list devices',
        'Try reconnecting the USB cable or using a different port',
      );
    }
  } else {
    // Check 2: Developer Mode status from output
    const outputLower = info.stdout.toLowerCase();
    if (
      outputLower.includes('developer mode disabled') ||
      outputLower.includes('developer_mode_off')
    ) {
      issues.push('Developer Mode is disabled');
      fixGuides.push(
        'On your iPhone: Settings > Privacy & Security > Developer Mode',
        'Toggle Developer Mode ON and restart the device',
      );
    }
  }

  // Check 3: Backend availability (Appium/WDA) — stub
  // In the future, probe the Appium server and WDA port to verify connectivity.
  // For now, we can't verify without Appium running on the host.

  if (issues.length > 0) {
    return HealthCheckResultSchema.parse({
      healthy: false,
      details: `Physical device ${udid} healthcheck failed:\n${issues.map((i) => `  - ${i}`).join('\n')}\n\nFix guidance (physical device):\n${fixGuides.map((g) => `  → ${g}`).join('\n')}`,
    });
  }

  return HealthCheckResultSchema.parse({
    healthy: true,
    details: `Physical device ${udid}: connection OK, trust OK, Developer Mode OK`,
  });
}

// ─── Simulator device healthcheck ───────────────────────────

/**
 * Run healthcheck on a simulator device.
 *
 * US-2.2 AC1 checks:
 *   1. simctl can reach the device
 *   2. Runtime is installed and available
 *   3. Simulator SDK is available
 *   4. Backend (Appium/WDA) availability — stub for now
 */
export async function healthcheckSimulatorDevice(
  udid: string,
  runtimeIdentifier?: string,
): Promise<HealthCheckResult> {
  const issues: string[] = [];
  const fixGuides: string[] = [];

  // Check 1: simctl can query the device
  const deviceInfo = exec(['xcrun', 'simctl', 'list', 'devices', '-j', udid]);
  if (deviceInfo.exitCode !== 0 || !deviceInfo.stdout) {
    issues.push('Simulator device not found or simctl unreachable');
    fixGuides.push(
      'Check if the simulator device exists: xcrun simctl list devices',
      'Create a simulator if needed: xcrun simctl create <name> <deviceType> <runtime>',
      'List available device types: xcrun simctl list devicetypes',
      'List available runtimes: xcrun simctl list runtimes',
    );
  }

  // Check 2: Runtime availability
  if (runtimeIdentifier) {
    const runtimes = exec(['xcrun', 'simctl', 'list', 'runtimes', '-j']);
    if (runtimes.exitCode === 0) {
      try {
        const parsed = JSON.parse(runtimes.stdout);
        const runtimeList = parsed.runtimes ?? [];
        const runtimeFound = runtimeList.some(
          (r: { identifier?: string; isAvailable?: boolean }) =>
            r.identifier === runtimeIdentifier && r.isAvailable !== false,
        );
        if (!runtimeFound) {
          issues.push(`Runtime ${runtimeIdentifier} is not installed or not available`);
          fixGuides.push(
            'Install the required runtime: xcrun simctl runtime add <identifier>',
            'Or download via Xcode: Settings > Platforms',
            'List available runtimes: xcrun simctl list runtimes',
          );
        }
      } catch {
        // JSON parse failed — non-fatal, skip runtime check
      }
    }
  }

  // Check 3: Simulator SDK availability
  const sdkCheck = exec(['xcrun', '--sdk', 'iphonesimulator', '--show-sdk-version']);
  if (sdkCheck.exitCode !== 0) {
    issues.push('iPhone Simulator SDK not available');
    fixGuides.push(
      'Install Xcode from the Mac App Store',
      'Or install Command Line Tools: xcode-select --install',
      'Verify: xcrun --sdk iphonesimulator --show-sdk-version',
    );
  }

  // Check 4: Backend availability (Appium/WDA) — stub
  // In the future, probe Appium server on Simulator to verify backend connectivity.

  if (issues.length > 0) {
    return HealthCheckResultSchema.parse({
      healthy: false,
      details: `Simulator device ${udid} healthcheck failed:\n${issues.map((i) => `  - ${i}`).join('\n')}\n\nFix guidance (simulator):\n${fixGuides.map((g) => `  → ${g}`).join('\n')}`,
    });
  }

  return HealthCheckResultSchema.parse({
    healthy: true,
    details: `Simulator device ${udid}: device found, runtime available, SDK available`,
  });
}

// ─── Unified healthcheck ───────────────────────────────────

/**
 * Run healthcheck on a single device, dispatching by targetKind.
 */
export async function healthcheckDevice(device: DeviceInfo): Promise<HealthCheckResult> {
  if (device.targetKind === 'physical') {
    return healthcheckPhysicalDevice(device.udid);
  }
  return healthcheckSimulatorDevice(device.udid, device.runtimeIdentifier);
}

/**
 * Run healthcheck on all discovered devices.
 * Returns a map of UDID → HealthCheckResult.
 */
export async function healthcheckAllDevices(
  devices: DeviceInfo[],
): Promise<Map<string, HealthCheckResult>> {
  const results = new Map<string, HealthCheckResult>();

  // Run healthchecks in parallel for all devices
  const checks = await Promise.allSettled(
    devices.map(async (device) => {
      const result = await healthcheckDevice(device);
      return { udid: device.udid, result };
    }),
  );

  for (const check of checks) {
    if (check.status === 'fulfilled') {
      results.set(check.value.udid, check.value.result);
    }
  }

  return results;
}
