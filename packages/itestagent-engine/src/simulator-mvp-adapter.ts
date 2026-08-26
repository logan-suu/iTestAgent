/**
 * Simulator MVP adapter — B15 module split (promotion guide §11.3 "engine
 * target execution"; ADR-011 simulator first-class support).
 *
 * Adapts an injected simulator-readiness probe into the MVP lane surface.
 */

export interface SimulatorMvpAdapterDeps {
  isSimulatorBooted(): Promise<boolean>;
}

export function createSimulatorMvpAdapter(deps: SimulatorMvpAdapterDeps): {
  isReady(): Promise<boolean>;
} {
  return {
    async isReady(): Promise<boolean> {
      return deps.isSimulatorBooted();
    },
  };
}
