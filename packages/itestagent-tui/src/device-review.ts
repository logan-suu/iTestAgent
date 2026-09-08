import type { DeviceInfo, TargetKind } from 'itestagent-contracts';

export interface DeviceTargetSwitch {
  readonly token: string;
  readonly udid: string;
  readonly name: string;
  readonly from: TargetKind;
  readonly to: TargetKind;
}

export const DEVICE_KINDS = ['physical', 'simulator'] as const;

/** Stable group order shared by keyboard navigation and all renderers. */
export function devicesForReview(devices: readonly DeviceInfo[]): DeviceInfo[] {
  return DEVICE_KINDS.flatMap((kind) => devicesForTarget(devices, kind));
}

export function targetSwitchPrompt(request: DeviceTargetSwitch): string {
  return `Switch ${request.from} → ${request.to} (${request.name})? y:confirm n:keep current plan. The plan will be rebuilt for review; no execution or automatic boot.`;
}

export function deviceReviewLines(state: {
  devices: readonly DeviceInfo[];
  deviceSelectionIndex: number;
  deviceSelectionTargetKind: TargetKind | null;
  deviceTargetSwitch: DeviceTargetSwitch | null;
}): string[] {
  const ordered = devicesForReview(state.devices);
  return [
    `Device Selection — current plan: ${state.deviceSelectionTargetKind ?? 'unknown'}`,
    ...DEVICE_KINDS.flatMap((kind) => {
      const group = devicesForTarget(ordered, kind);
      return [
        `${kind}${kind === state.deviceSelectionTargetKind ? ' (current plan)' : ''}`,
        ...(group.length
          ? group.map(
              (device) =>
                `${ordered.indexOf(device) === state.deviceSelectionIndex ? '>' : ' '} ${device.name ?? 'Unnamed device'} · ${kind} · iOS ${device.osVersion ?? 'unknown'} · ${formatDeviceAvailability(device)}`,
            )
          : ['  No targets discovered. Connect or boot one, then refresh.']),
      ];
    }),
    state.deviceTargetSwitch
      ? targetSwitchPrompt(state.deviceTargetSwitch)
      : '↑/↓ or j/k:nav Enter:select r:refresh Esc/q:cancel',
  ];
}

/** Inventory entries are not executable until discovery marks them ready. */
export function isDeviceReady(device: DeviceInfo): boolean {
  if (device.availability) return device.availability === 'ready';
  return device.targetKind === 'simulator' && device.state === 'booted';
}

export function devicesForTarget(
  devices: readonly DeviceInfo[],
  targetKind: TargetKind,
): DeviceInfo[] {
  return devices.filter((device) => device.targetKind === targetKind);
}

export function navigateDeviceIndex(
  current: number,
  direction: 'up' | 'down',
  length: number,
): number {
  if (length <= 0) return 0;
  const delta = direction === 'up' ? -1 : 1;
  return (current + delta + length) % length;
}

export function formatDeviceAvailability(device: DeviceInfo): string {
  if (isDeviceReady(device)) return 'ready';
  if (device.targetKind === 'simulator' && device.state) return `discovered (${device.state})`;
  return 'discovered (not connected)';
}
