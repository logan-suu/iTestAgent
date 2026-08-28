/** B20: simulator MVP factory. */
export function createSimulatorMvpFactory(_deps: object = {}): { create(): { ok: true } } {
  return { create: () => ({ ok: true }) };
}
