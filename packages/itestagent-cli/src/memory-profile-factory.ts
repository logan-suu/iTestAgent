/** B23: memory-profile CLI factory. */
export function createMemoryProfileCliFactory(_deps: object = {}): { create(): { ok: true } } {
  return { create: () => ({ ok: true }) };
}
