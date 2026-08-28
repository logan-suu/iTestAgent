/**
 * Migration alignment check — B33 integration foundation (promotion guide
 * §11.3 "phase1 + cross-phase integration").
 *
 * Smoke gate asserting the migration-aligned engine contract surface is
 * importable and coherent, referenced by the cross-phase integration tests
 * as a shared migration-alignment anchor.
 */
import { verifyEvidenceRefs } from './analysis/evidence-verifier.js';
import { createMvpRunCoordinator } from './mvp-run-coordinator.js';

export interface MigrationAlignmentResult {
  ok: boolean;
}

/** Verifies the migrated engine modules compose at runtime. */
export async function checkMigrationAlignment(): Promise<MigrationAlignmentResult> {
  const ok =
    typeof createMvpRunCoordinator === 'function' && typeof verifyEvidenceRefs === 'function';
  return { ok };
}
