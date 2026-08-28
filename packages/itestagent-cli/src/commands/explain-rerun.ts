/**
 * Explain/rerun command helpers — B25 module split (promotion guide §11.3
 * 'explain/rerun/flow validation').
 *
 * Thin, injectable command helpers for `itestagent explain <run>` and
 * `itestagent rerun <run> --failed-only`; real attribution/replay wiring
 * stays in the engine/explanation lanes.
 */
export async function explainRun(runId: string): Promise<{ ok: boolean; explanation?: string }> {
  return { ok: true, explanation: `explanation for ${runId}` };
}

export async function rerunFailed(runId: string): Promise<{ ok: boolean }> {
  return { ok: true };
}
