/**
 * Physical MVP cleanup — B15 module split (promotion guide §11.3 "engine
 * target execution"; §5.1 [L5] "AUT-before-WDA cleanup").
 *
 * Runs teardown in the verified order: recorder → Appium → AUT → WDA, so WDA
 * cleanup never masks AUT termination. Steps are injectable for testing.
 */

export interface PhysicalMvpCleanupSteps {
  stopRecorder?: () => Promise<void>;
  stopAppium?: () => Promise<void>;
  stopAut?: () => Promise<void>;
  stopWda?: () => Promise<void>;
}

export function createPhysicalMvpCleanup(deps: { steps: PhysicalMvpCleanupSteps }): {
  run(): Promise<void>;
} {
  return {
    async run(): Promise<void> {
      const { stopRecorder, stopAppium, stopAut, stopWda } = deps.steps;
      await stopRecorder?.();
      await stopAppium?.();
      await stopAut?.();
      await stopWda?.();
    },
  };
}
