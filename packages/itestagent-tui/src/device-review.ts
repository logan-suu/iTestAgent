import type { DeviceInfo, TargetKind } from 'itestagent-contracts';

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
