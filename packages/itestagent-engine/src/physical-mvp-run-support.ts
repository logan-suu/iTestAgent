/**
 * Physical MVP run support — B15 module split (promotion guide §11.3
 * "engine target execution").
 *
 * Small support helpers for the physical MVP run lane.
 */

/** Builds a deterministic run id for a physical MVP execution. */
export function resolveMvpRunId(prefix = 'mvp-run'): string {
  return `${prefix}-${Date.now()}`;
}
