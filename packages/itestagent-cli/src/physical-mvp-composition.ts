/** B19: compose physical MVP lanes into a run plan. */
export interface PhysicalMvpCompositionInput {
  autReady: boolean;
  wdaReady: boolean;
}
export interface PhysicalMvpComposition {
  ok: boolean;
}
export function composePhysicalMvp(input: PhysicalMvpCompositionInput): PhysicalMvpComposition {
  return { ok: input.autReady && input.wdaReady };
}
