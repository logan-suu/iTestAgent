/** B19: physical MVP factory. */
export type PhysicalMvpFactoryDeps = object;
export function createPhysicalMvpFactory(_deps: PhysicalMvpFactoryDeps = {}): {
  create(): { ok: true };
} {
  return { create: () => ({ ok: true }) };
}
