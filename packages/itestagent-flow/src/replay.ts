/**
 * Flow replay facade — B08 module split (promotion guide §11.3 "Flow
 * replay/redaction").
 *
 * The former 919-line monolith now lives in focused modules:
 *   replay-types           shared option/result vocabulary
 *   replay-locator         coordinate parsing + UiTree element search
 *   replay-action-utils    swipe/button/text helpers
 *   ui-tree-redactor       sensitive value scrubbing for evidence
 *   replay-interaction     app lifecycle / touch / text / navigation handlers
 *   replay-observation     screenshot / ui-tree / recording / logs handlers
 *   replay-assertion       visibility & text assertions
 *   replay-step            per-step dispatcher (safetyGate, evidence wiring)
 *   replay-evidence-writer post-step capture + atomic manifest write
 *   replay-engine          compatibility gate + main loop
 *
 * Public API is unchanged: existing imports of ReplayOptions /
 * checkTargetCompatibility / replayFlow keep working.
 */
export type { ReplayOptions, TargetCompatibilityResult } from './replay-types.js';
export { checkTargetCompatibility, replayFlow } from './replay-engine.js';
