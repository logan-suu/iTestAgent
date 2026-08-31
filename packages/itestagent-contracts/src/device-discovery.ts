import { z } from 'zod';
import { DeviceInfoSchema } from './device-identity.js';

export const DeviceDiscoveryLaneSchema = z.enum(['physical', 'simulator']);
export const DeviceDiscoveryStatusSchema = z.enum(['ok', 'partial', 'failed']);
export const DeviceDiscoveryIssueSchema = z.object({
  lane: DeviceDiscoveryLaneSchema,
  code: z.enum(['command_failed', 'missing_output', 'invalid_output']),
  message: z.string(),
  truncated: z.boolean().optional(),
});
export const DeviceDiscoverySnapshotSchema = z.object({
  devices: z.array(DeviceInfoSchema),
  status: DeviceDiscoveryStatusSchema,
  issues: z.array(DeviceDiscoveryIssueSchema),
});

export type DeviceDiscoveryLane = z.infer<typeof DeviceDiscoveryLaneSchema>;
export type DeviceDiscoveryStatus = z.infer<typeof DeviceDiscoveryStatusSchema>;
export type DeviceDiscoveryIssue = z.infer<typeof DeviceDiscoveryIssueSchema>;
export type DeviceDiscoverySnapshot = z.infer<typeof DeviceDiscoverySnapshotSchema>;

export interface DeviceDiscoveryOptions {
  readonly signal?: AbortSignal;
  readonly lanes?: readonly DeviceDiscoveryLane[];
}

/** Pre-selection device inventory provider; it is not bound to a device UDID. */
export interface DeviceDiscoveryProvider {
  discover(options?: DeviceDiscoveryOptions): Promise<DeviceDiscoverySnapshot>;
}
