/**
 * Device list and healthcheck formatter — terminal output.
 *
 * Follows the pattern from doctor/format.ts: ANSI color codes for terminal display.
 * US-2.1 AC2: no devices → clear prompt with connection guidance.
 */

import type { DeviceInfo, HealthCheckResult } from 'itestagent-contracts';

// ─── ANSI helpers ──────────────────────────────────────────

const BOLD = '\u001b[1m';
const DIM = '\u001b[2m';
const RED = '\u001b[31m';
const GREEN = '\u001b[32m';
const YELLOW = '\u001b[33m';
const CYAN = '\u001b[36m';
const RESET = '\u001b[0m';

type StateColor = 'green' | 'yellow' | 'red' | 'dim';

function colorState(s: StateColor): string {
  switch (s) {
    case 'green':
      return GREEN;
    case 'yellow':
      return YELLOW;
    case 'red':
      return RED;
    case 'dim':
      return DIM;
  }
}

function pad(str: string, len: number): string {
  return str.padEnd(len);
}

// ─── Device list ───────────────────────────────────────────

function formatTargetKind(kind: DeviceInfo['targetKind']): string {
  return kind === 'physical' ? `${CYAN}physical${RESET}` : `${DIM}simulator${RESET}`;
}

function formatDeviceState(device: DeviceInfo): { text: string; color: StateColor } {
  if (device.targetKind === 'physical') {
    // Physical devices: state inferred instead of simulator boot state
    // We show "connected" as default — detailed state from healthcheck
    return { text: 'connected', color: 'green' };
  }

  // Simulator: use the boot state field
  switch (device.state) {
    case 'booted':
      return { text: 'booted', color: 'green' };
    case 'booting':
      return { text: 'booting', color: 'yellow' };
    case 'shutting_down':
      return { text: 'shutting down', color: 'yellow' };
    case 'creating':
      return { text: 'creating', color: 'yellow' };
    case 'shutdown':
      return { text: 'shutdown', color: 'dim' };
    default:
      return { text: device.state ?? 'unknown', color: 'dim' };
  }
}

/**
 * Format device list for terminal display.
 *
 * US-2.3 AC2: each device shows KIND, NAME, OS/RUNTIME, UDID, STATE.
 */
export function formatDeviceList(devices: DeviceInfo[]): string {
  if (devices.length === 0) {
    return formatNoDevices();
  }

  const lines: string[] = [];

  // Header
  const kindWidth = 11; // "physical  " or "simulator "
  const nameWidth = Math.max(24, ...devices.map((d) => (d.name ?? '').length));
  const osWidth = 10;
  const stateWidth = 14;

  lines.push(
    `${BOLD}${pad('KIND', kindWidth)}${pad('NAME', nameWidth)}${pad('OS', osWidth)}${pad('STATE', stateWidth)}UDID${RESET}`,
  );

  // Separator
  const sep =
    '─'.repeat(kindWidth) +
    '─'.repeat(nameWidth) +
    '─'.repeat(osWidth) +
    '─'.repeat(stateWidth) +
    '─'.repeat(36);
  lines.push(DIM + sep + RESET);

  // Group by targetKind
  let currentKind = '';

  for (const device of devices) {
    const kind = device.targetKind;

    // Section separator between physical and simulator
    if (currentKind !== '' && currentKind !== kind) {
      lines.push('');
    }
    currentKind = kind;

    const stateInfo = formatDeviceState(device);
    const stateColor = colorState(stateInfo.color);

    const osVersion = device.osVersion ?? 'N/A';
    const name = device.name ?? 'Unknown';

    lines.push(
      `${pad(formatTargetKind(kind), kindWidth)}` +
        `${pad(name, nameWidth)}` +
        `${pad(osVersion, osWidth)}` +
        `${stateColor}${pad(stateInfo.text, stateWidth)}${RESET}` +
        `${DIM}${device.udid}${RESET}`,
    );
  }

  // Summary
  const physicalCount = devices.filter((d) => d.targetKind === 'physical').length;
  const simCount = devices.filter((d) => d.targetKind === 'simulator').length;
  const parts: string[] = [];
  if (physicalCount > 0) parts.push(`${physicalCount} physical`);
  if (simCount > 0) parts.push(`${simCount} simulator`);
  lines.push(`\n${BOLD}Total: ${devices.length} device(s)${RESET} — ${parts.join(', ')}`);

  return lines.join('\n');
}

/**
 * Format the "no devices" message with connection guidance.
 *
 * US-2.1 AC2: clear prompt and connection guidance when no devices.
 */
export function formatNoDevices(): string {
  return [
    `${YELLOW}${BOLD}No devices found${RESET}`,
    '',
    `${BOLD}Connect a device:${RESET}`,
    '',
    `${CYAN}Physical iPhone:${RESET}`,
    '  1. Connect your iPhone via USB cable to this Mac',
    '  2. Unlock the iPhone and tap "Trust This Computer" when prompted',
    '  3. Enable Developer Mode: Settings > Privacy & Security > Developer Mode',
    '  4. Developer Mode requires a restart after first enable',
    '  5. Verify: xcrun devicectl list devices',
    '',
    `${DIM}iOS Simulator:${RESET}`,
    '  1. Open Xcode > Settings > Platforms — install an iOS Simulator runtime',
    '  2. Create a simulator: xcrun simctl create "iPhone 16 Pro" "com.apple.CoreSimulator.SimDeviceType.iPhone-16-Pro" "com.apple.CoreSimulator.SimRuntime.iOS-18-2"',
    '  3. Boot the simulator: xcrun simctl boot <UDID>',
    '  4. Verify: xcrun simctl list devices | grep Booted',
    '',
    `${BOLD}Troubleshooting:${RESET}`,
    '  - Run itestagent doctor for full environment diagnostics',
    '  - Ensure Xcode and Command Line Tools are installed',
    '  - Xcode: Mac App Store | CLI Tools: xcode-select --install',
    '  - If using a USB hub, try connecting directly to a Mac USB port',
    '',
    'Tip: you can still explore project analysis without a device connected.',
  ].join('\n');
}

// ─── Healthcheck ───────────────────────────────────────────

/**
 * Format a single healthcheck result for display.
 */
export function formatHealthcheckResult(
  udid: string,
  deviceName: string,
  result: HealthCheckResult,
): string {
  const icon = result.healthy ? `${GREEN}✓${RESET}` : `${RED}✗${RESET}`;
  const status = result.healthy ? `${GREEN}PASS${RESET}` : `${RED}FAIL${RESET}`;

  return [
    `${icon} ${BOLD}${deviceName}${RESET} ${DIM}(${udid})${RESET} — ${status}`,
    result.details ? `${DIM}  ${result.details}${RESET}` : '',
  ]
    .filter(Boolean)
    .join('\n');
}

/**
 * Format healthcheck results for all devices.
 */
export function formatHealthcheckResults(
  results: Map<string, HealthCheckResult>,
  devices: DeviceInfo[],
): string {
  const lines: string[] = [`${BOLD}Device Health Check${RESET}`, ''];

  let passCount = 0;
  let failCount = 0;

  for (const device of devices) {
    const result = results.get(device.udid);
    if (!result) continue;

    if (result.healthy) passCount++;
    else failCount++;

    lines.push(formatHealthcheckResult(device.udid, device.name ?? 'Unknown', result));
    lines.push('');
  }

  lines.push(
    `${BOLD}Summary:${RESET} ${GREEN}${passCount} passed${RESET}, ${RED}${failCount} failed${RESET}`,
  );

  return lines.join('\n');
}
