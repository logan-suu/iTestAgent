/**
 * expected-batch-tag.ts — the single B00-B42 to rollback tag mapping.
 *
 * Contract (promotion guide §11.3 table / §12.1): each batch has exactly one
 * fixed annotated rollback tag `promo/bXX-*`. This module is the only source of
 * truth for that mapping; the manifest writer and rollback protocol both use it.
 *
 * CLI:
 *   bun scripts/expected-batch-tag.ts <BATCH>
 *
 * Prints the rollback tag for a valid batch (B00-B42) and exits 0.
 * Exits non-zero for an invalid or unknown batch.
 */

/** Batch id -> rollback tag, frozen from promotion guide §11.3. */
export const BATCH_ROLLBACK_TAGS: Readonly<Record<string, string>> = {
  B00: 'promo/b00-baseline-green',
  B01: 'promo/b01-contracts-device-core',
  B02: 'promo/b02-contracts-config',
  B03: 'promo/b03-contracts-result-artifact',
  B04: 'promo/b04-contracts-test-plan',
  B05: 'promo/b05-contracts-scenarios',
  B06: 'promo/b06-process-leaf',
  B07: 'promo/b07-store-artifacts',
  B08: 'promo/b08-flow-replay',
  B09: 'promo/b09-report-validation',
  B10: 'promo/b10-project-analyzer',
  B11: 'promo/b11-allowlisted-backends',
  B12: 'promo/b12-build-xcodebuild',
  B13: 'promo/b13-device-appium',
  B14: 'promo/b14-engine-core',
  B15: 'promo/b15-engine-target-execution',
  B16: 'promo/b16-engine-analysis',
  B17: 'promo/b17-cli-safety-core',
  B18: 'promo/b18-cli-discovery',
  B19: 'promo/b19-cli-physical-route-c',
  B20: 'promo/b20-cli-simulator',
  B21: 'promo/b21-xctrace-generic',
  B22: 'promo/b22-memory-profile-core',
  B23: 'promo/b23-cli-memory-profile',
  B24: 'promo/b24-cli-feed-memory',
  B25: 'promo/b25-cli-command-tail',
  B26: 'promo/b26-tui-characterization',
  B27: 'promo/b27-tui-renderer-core',
  B28: 'promo/b28-tui-setup-security',
  B29: 'promo/b29-tui-agent-session',
  B30: 'promo/b30-tui-plan-review',
  B31: 'promo/b31-tui-run-routing',
  B32: 'promo/b32-tui-feed-memory',
  B33: 'promo/b33-integration-foundation',
  B34: 'promo/b34-phase5-harness',
  B35: 'promo/b35-phase5-pty-race',
  B36: 'promo/b36-phase5-scenarios',
  B37: 'promo/b37-persisted-migrations',
  B38: 'promo/b38-evidence-provenance',
  B39: 'promo/b39-docs-truth',
  B40: 'promo/b40-ci-lanes',
  B41: 'promo/b41-g5-sim',
  B42: 'promo/b42-g5-physical',
};

export function expectedBatchTag(batch: string): string | undefined {
  return BATCH_ROLLBACK_TAGS[batch];
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  if (args.length !== 1) {
    process.stderr.write('usage: bun scripts/expected-batch-tag.ts <BATCH>\n');
    process.exit(2);
  }
  const batch = args[0];
  const tag = expectedBatchTag(batch);
  if (!tag) {
    process.stderr.write(`expected-batch-tag: unknown batch "${batch}" (expected B00-B42)\n`);
    process.exit(1);
  }
  process.stdout.write(`${tag}\n`);
  process.exit(0);
}
