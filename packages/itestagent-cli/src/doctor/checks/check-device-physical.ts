/**
 * Physical device check — doctor physical readiness lane.
 *
 * US-1.2 AC1: pass/fail/manual three-state.
 * US-1.3 AC1: recognizes "Developer Mode off / device not trusted".
 *
 * Checks:
 *   1. xcrun devicectl list devices → connected physical devices?
 *   2. Developer Mode status
 *   3. Device trust status
 *
 * AGENTS.md §2 (R3): physical capabilities require G5 spike verification.
 * This check reports what can be determined from CLI tools only.
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

/**
 * Detect physical devices from devicectl output.
 * Returns list of UDIDs for connected physical devices.
 */
function extractPhysicalUdids(devicectlOutput: string): string[] {
  const udids: string[] = [];
  const lines = devicectlOutput.split('\n');
  for (const line of lines) {
    // UDID pattern: 25-char hex string
    const match = line.match(/([0-9A-Fa-f]{25,40})/);
    if (match?.[1] && !line.includes('Simulator') && !line.includes('CoreSimulator')) {
      udids.push(match[1]);
    }
  }
  return udids;
}

export async function checkPhysicalDevice(): Promise<DoctorCheckResult> {
  const devicectl = exec('xcrun', ['devicectl', 'list', 'devices']);
  const details: string[] = [];

  if (devicectl.exitCode !== 0) {
    return {
      name: 'Physical Device',
      status: 'manual',
      message: 'Cannot query device list (devicectl unavailable)',
      fixGuide: [
        'Ensure Xcode Command Line Tools are installed: xcode-select --install',
        'Try: xcrun devicectl list devices',
      ],
      details: devicectl.stderr,
    };
  }

  const udids = extractPhysicalUdids(devicectl.stdout);
  details.push(`devicectl output: ${udids.length} physical device(s) detected`);

  if (udids.length === 0) {
    // Check instruments fallback
    const instruments = exec('instruments', ['-s', 'devices']);
    if (instruments.exitCode === 0) {
      const deviceLines = instruments.stdout
        .split('\n')
        .filter(
          (l) =>
            (l.includes('iPhone') || l.includes('iPad')) &&
            l.includes('[') &&
            !l.includes('Simulator'),
        );
      if (deviceLines.length > 0) {
        details.push(`instruments fallback: ${deviceLines.length} device(s) found`);
        return {
          name: 'Physical Device',
          status: 'manual',
          message: `${deviceLines.length} device(s) found via instruments. Connect via USB and ensure Developer Mode is enabled.`,
          fixGuide: [
            'Connect iPhone via USB cable',
            'Trust this computer: tap "Trust" on iPhone when prompted',
            'Enable Developer Mode: Settings > Privacy & Security > Developer Mode (requires restart)',
            'Verify: xcrun devicectl list devices',
          ],
          details: details.join('\n'),
        };
      }
    }

    return {
      name: 'Physical Device',
      status: 'manual',
      message: 'No physical device detected. Connect an iPhone via USB.',
      fixGuide: [
        'Connect iPhone via USB cable to this Mac',
        'Unlock the iPhone and tap "Trust This Computer" when prompted',
        'Verify: xcrun devicectl list devices',
        'Enable Developer Mode: iPhone Settings > Privacy & Security > Developer Mode',
      ],
      details: details.join('\n'),
    };
  }

  // At least one device found
  details.push(`Device UDIDs: ${udids.join(', ')}`);

  return {
    name: 'Physical Device',
    status: 'manual',
    message: `${udids.length} physical device(s) detected. Verify Developer Mode and trust status on each device.`,
    fixGuide: [
      'Ensure Developer Mode is enabled on each device (Settings > Privacy & Security > Developer Mode)',
      'Trust this computer on each device: tap "Trust" when prompted after connecting',
      'Developer Mode requires a device restart after first enable',
      `Detected UDIDs: ${udids.join(', ')}`,
    ],
    details: details.join('\n'),
  };
}
