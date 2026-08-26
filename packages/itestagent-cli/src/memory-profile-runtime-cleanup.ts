/** B23: memory-profile runtime cleanup (recorder→appium→aut→wda order). */
export function createMemoryProfileRuntimeCleanup(
  steps: Record<string, () => Promise<void>> = {},
): { run(): Promise<void> } {
  return {
    async run(): Promise<void> {
      await steps.stopRecorder?.();
      await steps.stopAppium?.();
      await steps.stopAut?.();
      await steps.stopWda?.();
    },
  };
}
