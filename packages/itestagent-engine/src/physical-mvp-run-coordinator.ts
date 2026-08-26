/**
 * Physical MVP run coordinator — B15 module split (promotion guide §11.3
 * "engine target execution").
 *
 * Composes the physical MVP adapter and cleanup into one run; adapter and
 * cleanup are injectable so the orchestration is testable without real
 * devices.
 */

export interface PhysicalMvpRunCoordinatorDeps {
  adapter: { isReady(): Promise<boolean> };
  cleanup: { run(): Promise<void> };
}

export interface PhysicalMvpRunResult {
  ok: boolean;
  error?: string;
}

export function createPhysicalMvpRunCoordinator(deps: PhysicalMvpRunCoordinatorDeps): {
  run(): Promise<PhysicalMvpRunResult>;
} {
  return {
    async run(): Promise<PhysicalMvpRunResult> {
      try {
        await deps.adapter.isReady();
        await deps.cleanup.run();
        return { ok: true };
      } catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : String(error) };
      }
    },
  };
}
