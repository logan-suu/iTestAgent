/**
 * MVP run coordinator — B15 module split (promotion guide §11.3 "engine
 * target execution").
 *
 * Coordinates a target-execution run across injected lanes (setup → execute
 * → cleanup), guarded by an optional safety gate (R7). Lane failures surface
 * as typed { ok: false, error } results rather than raw throws.
 */

export interface MvpRunCoordinatorDeps {
  /** Optional safety gate; when present and false, the run is blocked (R7). */
  safetyGate?: () => Promise<boolean>;
  setup?: () => Promise<void>;
  execute: () => Promise<void>;
  cleanup?: () => Promise<void>;
}

export interface MvpRunResult {
  ok: boolean;
  error?: string;
}

export function createMvpRunCoordinator(deps: MvpRunCoordinatorDeps): {
  run(): Promise<MvpRunResult>;
} {
  return {
    async run(): Promise<MvpRunResult> {
      try {
        if (deps.safetyGate && !(await deps.safetyGate())) {
          return { ok: false, error: 'safety gate denied' };
        }
        await deps.setup?.();
        await deps.execute();
        await deps.cleanup?.();
        return { ok: true };
      } catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : String(error) };
      }
    },
  };
}
