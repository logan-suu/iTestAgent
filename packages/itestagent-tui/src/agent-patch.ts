/**
 * Agent patch — B29 module split (promotion guide §11.3 "agent
 * session/stream/retention").
 *
 * Applies a partial patch to a state object (shallow merge), the primitive
 * behind incremental TUI state updates.
 */
export function applyPatch<T extends object>(state: T, patch: Partial<T>): T {
  return { ...state, ...patch };
}
