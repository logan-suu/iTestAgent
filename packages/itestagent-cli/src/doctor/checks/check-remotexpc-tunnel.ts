/**
 * RemoteXPC tunnel readiness check — doctor physical readiness lane.
 *
 * G5 finding (2026-08-28, real-device debugging): on Xcode 26 + iOS 17+
 * pairings, appium's device enumeration needs the RemoteXPC tunnel registry.
 * The legacy usbmux/lockdown layer (libimobiledevice / `idevice_id -l`) does
 * NOT expose CoreDevice-only pairings — when devicectl sees a wired device
 * but the legacy layer does not, appium session creation fails with
 * "Unknown device or simulator UDID" until the tunnel is created:
 *
 *   sudo appium driver run xcuitest tunnel-creation
 *
 * This check detects exactly that gap and surfaces the fix guide.
 *
 * Returns:
 *   - 'pass'  — wired device is visible to both devicectl and the legacy layer
 *   - 'fail'  — wired device visible to devicectl only → tunnel needed
 *   - 'manual' — no wired device, or the probe binaries are unavailable
 *
 * AGENTS.md §2 (R2): uses devicectl/idevice_id (Apple/brew tools), no private APIs.
 */
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { DoctorCheckResult } from '../types.js';
import { exec } from '../utils.js';

interface DevicectlDeviceEntry {
  hardwareProperties?: { udid?: string };
  connectionProperties?: { transportType?: string };
}

interface DevicectlListOutput {
  /** Xcode 26.x shape: devices wrapped under `result`. */
  result?: { devices?: DevicectlDeviceEntry[] };
  /** Older/some devicectl builds emit a root-level `devices` array. */
  devices?: DevicectlDeviceEntry[];
}

/** Extract the first wired device UDID from a devicectl JSON device list. */
export function extractWiredUdid(json: string): string | null {
  try {
    const parsed = JSON.parse(json) as DevicectlListOutput;
    for (const d of [...(parsed?.result?.devices ?? []), ...(parsed?.devices ?? [])]) {
      if (d.connectionProperties?.transportType === 'wired') {
        return d.hardwareProperties?.udid ?? null;
      }
    }
    return null;
  } catch {
    return null;
  }
}

export async function checkRemotexpcTunnel(): Promise<DoctorCheckResult> {
  // 1. Wired device present (per CoreDevice/devicectl — authoritative).
  // Xcode 26.5 only emits JSON via `--json-output <path>` (G5 finding):
  // stdout carries progress text, so the temp file is the source of truth.
  const tmpJson = join(tmpdir(), `itestagent-doctor-devlist-${process.pid}-${Date.now()}.json`);
  try {
    const list = exec('xcrun', ['devicectl', 'list', 'devices', '--json-output', tmpJson]);

    if (list.stderr.includes('not found') || (list.exitCode !== 0 && !list.stdout)) {
      return {
        name: 'RemoteXPC tunnel',
        status: 'manual',
        message: 'devicectl unavailable — cannot probe the tunnel readiness',
        fixGuide: ['Install Xcode CLI tools, then re-run doctor.'],
      };
    }

    const deviceJson =
      list.exitCode === 0 && existsSync(tmpJson) ? readFileSync(tmpJson, 'utf-8') : null;
    const wiredUdid = deviceJson !== null ? extractWiredUdid(deviceJson) : null;

    if (deviceJson === null) {
      return {
        name: 'RemoteXPC tunnel',
        status: 'manual',
        message: 'devicectl probe produced no device list — tunnel readiness unknown',
        fixGuide: ['Run `xcrun devicectl list devices` manually, then re-run doctor.'],
      };
    }

    if (!wiredUdid) {
      return {
        name: 'RemoteXPC tunnel',
        status: 'manual',
        message: 'No wired device detected — connect via USB to check tunnel readiness',
        fixGuide: ['Connect the iPhone via USB, then re-run doctor.'],
      };
    }

    // 2. Legacy-layer visibility (appium's fallback enumeration path)
    const legacyProbe = exec('idevice_id', ['-l']);
    // A failed probe did not measure visibility — 'manual' (unknown), never
    // 'fail' (CodeRabbit r3): only a successful probe that cannot see the
    // device proves the tunnel gap.
    const probeFailed = legacyProbe.exitCode !== 0 && !legacyProbe.stdout.includes(wiredUdid);
    if (probeFailed) {
      const missingBinary = legacyProbe.stderr.includes('not found');
      return {
        name: 'RemoteXPC tunnel',
        status: 'manual',
        message: missingBinary
          ? 'libimobiledevice (idevice_id) not installed — tunnel readiness unknown'
          : `Legacy probe failed (exit ${legacyProbe.exitCode}) — visibility unknown`,
        fixGuide: missingBinary
          ? ['brew install libimobiledevice  # enables the legacy-layer probe']
          : ['Re-run doctor. If persistent, inspect `idevice_id -l` output manually.'],
      };
    }

    if (legacyProbe.stdout.includes(wiredUdid)) {
      return {
        name: 'RemoteXPC tunnel',
        status: 'pass',
        message: `Wired device ${wiredUdid} visible to both CoreDevice and legacy layers`,
      };
    }

    // 3. The G5 gap: CoreDevice sees it, legacy does not → tunnel required
    return {
      name: 'RemoteXPC tunnel',
      status: 'fail',
      message: `Wired device ${wiredUdid} is NOT visible to the legacy usbmux layer — appium session creation will fail ("Unknown device or simulator UDID")`,
      fixGuide: [
        'sudo appium driver run xcuitest tunnel-creation  # keep the script running',
        'Then re-run doctor to confirm the legacy layer sees the device.',
      ],
      details:
        'G5 finding (2026-08-28): Xcode 26 CoreDevice pairings do not expose the legacy lockdown layer. ' +
        'appium xcuitest-driver 11.x enumerates devices via RemoteXPC tunnel registry (iOS 17+) and falls ' +
        'back to legacy usbmux — which lists nothing for CoreDevice-only pairings.',
    };
  } finally {
    try {
      rmSync(tmpJson, { force: true });
    } catch {
      // Ignore cleanup failures
    }
  }
}
