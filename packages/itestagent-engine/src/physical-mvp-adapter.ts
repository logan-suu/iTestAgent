/**
 * Physical MVP adapter — B15 module split (promotion guide §11.3 "engine
 * target execution").
 *
 * Wraps an injected physical device handle (from the B13 device-appium
 * process/session handles) into the MVP lane surface used by the run
 * coordinator.
 */

export interface PhysicalDeviceHandle {
  pid: number;
  isRunning(): Promise<boolean>;
  stop(): Promise<void>;
}

export interface PhysicalMvpAdapterDeps {
  deviceHandle: PhysicalDeviceHandle;
}

export function createPhysicalMvpAdapter(deps: PhysicalMvpAdapterDeps): {
  isReady(): Promise<boolean>;
} {
  return {
    async isReady(): Promise<boolean> {
      return deps.deviceHandle.isRunning();
    },
  };
}
