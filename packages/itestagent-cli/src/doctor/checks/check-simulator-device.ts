/**
 * Simulator device check — doctor simulator readiness lane.
 *
 * US-1.2 AC1: pass/fail/manual three-state.
 * US-1.2 AC2: fix guidance for failures.
 *
 * Checks:
 *   1. xcrun simctl list devices --json → parse JSON for available Simulator devices
 *   2. Count available devices (both Booted and Shutdown)
 *   3. Does NOT boot a device (cold boot takes 30-60s per 避坑手册 §3)
 *
 * 避坑手册 §3: Simulator cold boot takes 30-60s. We report device availability
 * as 'manual' because the user must verify the device actually works.
 *
 * AGENTS.md §2 (R3): Simulator capabilities require G5-SIM verification.
 * This check reports what can be determined from CLI tools only.
 */
import type { DoctorCheckResult } from '../types.js';
import { exec } from '../utils.js';

/** Extracted device info from simctl JSON output. */
interface SimDevice {
  name: string;
  udid: string;
  state: string;
  runtime: string;
}

/** Parse simctl list devices JSON output (defensive — keys vary by Xcode version). */
function parseDevices(raw: string): SimDevice[] {
  try {
    const parsed = JSON.parse(raw);
    // Xcode 15+: { "devices": { "com.apple.CoreSimulator.SimRuntime.iOS-18-0": [...] } }
    const devicesMap = parsed.devices ?? parsed;
    const result: SimDevice[] = [];

    if (typeof devicesMap !== 'object' || devicesMap === null) return [];

    for (const [runtimeKey, deviceList] of Object.entries(devicesMap)) {
      if (!Array.isArray(deviceList)) continue;
      for (const d of deviceList) {
        if (typeof d !== 'object' || d === null) continue;
        const dObj = d as Record<string, unknown>;
        result.push({
          name: String(dObj.name ?? 'unknown'),
          udid: String(dObj.udid ?? ''),
          state: String(dObj.state ?? 'unknown'),
          runtime: runtimeKey,
        });
      }
    }
    return result;
  } catch {
    return [];
  }
}

export async function checkSimulatorDevice(): Promise<DoctorCheckResult> {
  const devices = exec('xcrun', ['simctl', 'list', 'devices', '--json']);
  const details: string[] = [];

  if (devices.exitCode !== 0 || !devices.stdout) {
    return {
      name: 'Simulator Device',
      status: 'fail',
      message: `Cannot query simulator devices: ${devices.stderr || 'no output'}`,
      fixGuide: ['Ensure Xcode and simctl are available', 'Verify: xcrun simctl list devices'],
      details: devices.stderr,
    };
  }

  const deviceList = parseDevices(devices.stdout);
  details.push(`Total simulator devices found: ${deviceList.length}`);

  // Categorize by state
  const booted = deviceList.filter((d) => d.state.toLowerCase() === 'booted');
  const shutdown = deviceList.filter((d) => d.state.toLowerCase() === 'shutdown');
  const available = deviceList.filter(
    (d) => d.state.toLowerCase() === 'booted' || d.state.toLowerCase() === 'shutdown',
  );

  details.push(
    `Booted: ${booted.length}, Shutdown: ${shutdown.length}, Other: ${deviceList.length - available.length}`,
  );

  if (available.length === 0) {
    return {
      name: 'Simulator Device',
      status: 'fail',
      message: 'No available simulator devices found',
      fixGuide: [
        'Create a simulator device in Xcode: Window > Devices and Simulators',
        'Or via CLI: xcrun simctl create <name> <deviceType> <runtime>',
        'List available device types: xcrun simctl list devicetypes',
        'List available runtimes: xcrun simctl list runtimes',
      ],
      details: details.join('\n'),
    };
  }

  // List some available devices
  const sampleNames = available
    .slice(0, 5)
    .map((d) => `${d.name} (${d.state})`)
    .join(', ');
  details.push(`Sample devices: ${sampleNames}`);

  return {
    name: 'Simulator Device',
    status: 'manual',
    message: `${available.length} simulator device(s) available. Boot a device to verify it works (boot takes 30-60s).`,
    fixGuide: [
      'Boot a simulator: xcrun simctl boot <device-udid>',
      'Wait for boot to complete (30-60s)',
      'Open Simulator.app: open -a Simulator',
      'Verify: xcrun simctl list devices | grep Booted',
    ],
    details: details.join('\n'),
  };
}
