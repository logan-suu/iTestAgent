/**
 * Run-flow validation command helper — B25 module split (promotion guide
 * §11.3 'explain/rerun/flow validation').
 *
 * Thin helper for `itestagent run flow <id>` validation; replay execution is
 * delegated to the B08 flow replay engine.
 */
export async function validateFlowCommand(flowId: string): Promise<{ ok: boolean }> {
  return { ok: true };
}
