/**
 * verify-evidence.ts — current-evidence verifier for the promotion protocol.
 *
 * Contract (promotion guide §12.1 / §16 G1 / verification-missing-protocol.test.ts):
 *  - When the current evidence/report is missing, the verifier exits with
 *    code 42 AND prints exactly one machine-readable JSON object to stderr:
 *        { "code": "MISSING_CURRENT_EVIDENCE", "batchId": "<BATCH>" }
 *  - Any other failure (unknown batch, bad flags, internal error) uses a
 *    different exit code and never emits MISSING_CURRENT_EVIDENCE.
 *  - When the tracked evidence corpus exists (docs/06-verification/evidence/),
 *    it is verified (SHA-256 manifest integrity); exit 0 on success.
 *
 * Evidence batches: B38 (regenerated corpus), B41 (G5-SIM), B42 (physical G5).
 * Current evidence is the tracked corpus at docs/06-verification/evidence/
 * (SHA256SUMS or manifest.json marks a generated corpus).
 *
 * CLI:
 *   bun scripts/verify-evidence.ts [--batch <id>] [--scope g5|g5-sim|simulator] [--require-current]
 *
 * Exit codes:
 *   0  current evidence present and verified
 *   3  evidence present but corrupt / verification failed (never 42)
 *   42 current evidence missing (MISSING_CURRENT_EVIDENCE protocol)
 *   2  usage error / unknown batch / unknown scope (never 42)
 */

import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

const MISSING_EVIDENCE_CODE = 'MISSING_CURRENT_EVIDENCE';
const EVIDENCE_BATCHES = new Set(['B38', 'B41', 'B42']);
const SCOPE_TO_BATCH: Record<string, string> = {
  g5: 'B42',
  'g5-sim': 'B41',
  simulator: 'B41',
};

interface Options {
  batch?: string;
  scope?: string;
  requireCurrent: boolean;
}

function usage(message: string): never {
  process.stderr.write(`verify-evidence: ${message}\n`);
  process.stderr.write(
    'usage: bun scripts/verify-evidence.ts [--batch <id>] [--scope g5|g5-sim|simulator] [--require-current]\n',
  );
  process.exit(2);
}

function parseArgs(args: string[]): Options {
  const opts: Options = { requireCurrent: false };
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    switch (arg) {
      case '--batch':
        opts.batch = args[++i];
        if (!opts.batch) usage('--batch requires a value');
        break;
      case '--scope':
        opts.scope = args[++i];
        if (!opts.scope) usage('--scope requires a value');
        break;
      case '--require-current':
        opts.requireCurrent = true;
        break;
      default:
        usage(`unexpected argument "${arg}"`);
    }
  }
  return opts;
}

function repoRoot(): string {
  const result = Bun.spawnSync(['git', 'rev-parse', '--show-toplevel'], {
    stdout: 'pipe',
    stderr: 'pipe',
  });
  if (result.exitCode === 0) return result.stdout.toString().trim();
  return resolve(process.cwd());
}

/** Resolves the batchId used in the protocol JSON, or null when invalid. */
function resolveBatchId(opts: Options): string | null {
  if (opts.batch) {
    if (!/^B[0-4][0-9]$/.test(opts.batch)) return null;
    if (!EVIDENCE_BATCHES.has(opts.batch)) return null;
    return opts.batch;
  }
  if (opts.scope) {
    const mapped = SCOPE_TO_BATCH[opts.scope];
    return mapped ?? null;
  }
  // No explicit target: default to the evidence regeneration batch.
  return process.env.ITESTAGENT_BATCH && EVIDENCE_BATCHES.has(process.env.ITESTAGENT_BATCH)
    ? process.env.ITESTAGENT_BATCH
    : 'B38';
}

function currentEvidenceExists(evidenceRoot: string, batchId: string): boolean {
  if (!existsSync(evidenceRoot) || !statSync(evidenceRoot).isDirectory()) return false;
  // Batch-scoped current evidence: B38 = whole corpus, B41 = g5-sim,
  // B42 = physical g5 (promotion guide §12.3 evidence batches).
  if (batchId === 'B41') return existsSync(join(evidenceRoot, 'g5-sim'));
  if (batchId === 'B42') return existsSync(join(evidenceRoot, 'g5'));
  return (
    existsSync(join(evidenceRoot, 'SHA256SUMS')) || existsSync(join(evidenceRoot, 'manifest.json'))
  );
}

function sha256File(filePath: string): string {
  const data = readFileSync(filePath);
  return createHash('sha256').update(data).digest('hex');
}

/** Verifies the SHA256SUMS manifest; returns list of mismatches (empty = ok). */
function verifyCorpus(evidenceRoot: string, batchId: string): string[] {
  if (batchId === 'B41' || batchId === 'B42') {
    const scopeDir = join(evidenceRoot, batchId === 'B41' ? 'g5-sim' : 'g5');
    const manifestPath = join(scopeDir, 'promotion', 'manifest.json');
    if (!existsSync(manifestPath)) return [`missing ${batchId} promotion manifest`];
    try {
      const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as unknown;
      if (typeof manifest !== 'object' || manifest === null) {
        return ['manifest.json is not a JSON object'];
      }
    } catch (err) {
      return [`manifest.json is not valid JSON: ${(err as Error).message}`];
    }
    return [];
  }
  const sumPath = join(evidenceRoot, 'SHA256SUMS');
  const manifestPath = join(evidenceRoot, 'manifest.json');
  if (existsSync(sumPath)) {
    const lines = readFileSync(sumPath, 'utf8').split(/\r?\n/);
    const mismatches: string[] = [];
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed === '') continue;
      const match = /^([0-9a-fA-F]{64})\s+(?:[* ])?(.+)$/.exec(trimmed);
      if (!match) {
        mismatches.push(`SHA256SUMS: malformed line "${trimmed}"`);
        continue;
      }
      const [expectedHash, relPath] = [match[1].toLowerCase(), match[2]];
      const abs = join(evidenceRoot, relPath);
      if (!existsSync(abs) || statSync(abs).isDirectory()) {
        mismatches.push(`SHA256SUMS: missing file "${relPath}"`);
        continue;
      }
      const actual = sha256File(abs);
      if (actual !== expectedHash) {
        mismatches.push(`SHA256SUMS: hash mismatch for "${relPath}"`);
      }
    }
    return mismatches;
  }
  if (existsSync(manifestPath)) {
    // Manifest shell without per-file hashes: presence is enough.
    try {
      const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as { files?: unknown };
      if (typeof manifest !== 'object' || manifest === null) {
        return ['manifest.json is not a JSON object'];
      }
    } catch (err) {
      return [`manifest.json is not valid JSON: ${(err as Error).message}`];
    }
    return [];
  }
  return ['no corpus manifest (SHA256SUMS or manifest.json)'];
}

if (import.meta.main) {
  const opts = parseArgs(process.argv.slice(2));

  const batchId = resolveBatchId(opts);
  if (batchId === null) {
    const target = opts.batch ? `batch "${opts.batch}"` : `scope "${opts.scope}"`;
    process.stderr.write(
      `verify-evidence: unknown evidence target (${target}); expected batch B38/B41/B42 or scope g5/g5-sim/simulator\n`,
    );
    process.exit(2);
  }

  const evidenceRoot = join(repoRoot(), 'docs', '06-verification', 'evidence');

  if (!currentEvidenceExists(evidenceRoot, batchId)) {
    // Missing current evidence: exactly one machine JSON line on stderr, exit 42.
    process.stderr.write(`${JSON.stringify({ code: MISSING_EVIDENCE_CODE, batchId })}\n`);
    process.exit(42);
  }

  const mismatches = verifyCorpus(evidenceRoot, batchId);
  if (mismatches.length > 0) {
    for (const m of mismatches) process.stderr.write(`verify-evidence: ${m}\n`);
    process.exit(3);
  }

  process.stdout.write(
    `verify-evidence: OK — current evidence verified for ${batchId} (${evidenceRoot})\n`,
  );
  process.exit(0);
}
