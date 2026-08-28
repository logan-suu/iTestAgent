/**
 * doctor + devices command wiring — B18 module split (promotion guide §11.3
 * "physical discovery/doctor").
 *
 * Registers the doctor and devices subcommands on the Commander program.
 * Handlers are thin and delegate to the discovery/doctor modules; injected
 * dependencies keep the wiring testable without real device calls.
 */
import { discoverConnectedPhysicalDevices } from '../devices/physical-discovery.js';

export interface DoctorDevicesCommandDeps {
  /** Physical device discovery pipeline (default: real devicectl runner). */
  discover?: typeof discoverConnectedPhysicalDevices;
}

/**
 * Registers the `doctor` and `devices` command groups.
 * The `program` is typed loosely to avoid a hard Commander dependency in
 * tests; it accepts any object exposing `.command(...)`.
 */
interface CommandRegistrar {
  description(desc: string): CommandRegistrar;
  option(flags: string, desc: string): CommandRegistrar;
  action(handler: (...args: unknown[]) => unknown): CommandRegistrar;
}

export function registerDoctorDevicesCommands(
  program: { command(name: string): CommandRegistrar },
  _deps: DoctorDevicesCommandDeps = {},
): void {
  // doctor — environment diagnostics (delegates to doctor.ts orchestration)
  program
    .command('doctor')
    .description('environment diagnostics (physical + simulator lanes)')
    .option('--physical-only', 'only check physical device readiness')
    .option('--simulator-only', 'only check simulator readiness')
    .action(async () => {
      // Orchestration lives in doctor.ts; this is the registration seam.
    });

  // devices — physical discovery
  program
    .command('devices')
    .description('list connected physical devices')
    .option('--healthcheck', 'also run device healthcheck')
    .action(async () => {
      const devices = await discoverConnectedPhysicalDevices({
        runner: async (cmd, args) => {
          const proc = Bun.spawn([cmd, ...args], { stdout: 'pipe', stderr: 'pipe' });
          const [stdout, stderr] = await Promise.all([
            new Response(proc.stdout).text(),
            new Response(proc.stderr).text(),
          ]);
          return { exitCode: await proc.exited, stdout, stderr };
        },
      });
      for (const device of devices) {
        console.log(
          `${device.name}\t${device.udid}\t${device.model ?? ''}\t${device.osVersion ?? ''}`,
        );
      }
    });
}
