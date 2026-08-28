/**
 * Physical device discovery orchestration — B18 module split (promotion
 * guide §11.3 "physical discovery/doctor").
 *
 * Composes the devicectl command wrapper with the strict parser to return
 * connected physical devices. All I/O goes through the injected runner so
 * tests lock the pipeline without real device calls.
 */
import { type DevicectlCommandDeps, createDevicectlCommand } from './physical-command.js';
import {
  type PhysicalDeviceEntry,
  parsePhysicalDiscoveryOutput,
} from './physical-discovery-parser.js';

/** Discovers connected physical devices via the injected devicectl runner. */
export async function discoverConnectedPhysicalDevices(
  deps: DevicectlCommandDeps,
): Promise<PhysicalDeviceEntry[]> {
  const command = createDevicectlCommand(deps);
  const stdout = await command.listDevices();
  return parsePhysicalDiscoveryOutput(stdout);
}
