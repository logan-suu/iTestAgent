/**
 * generate-evidence.ts — evidence generator shell (no scenario dependencies).
 *
 * Contract (promotion guide §12.1 / §13.2 Evidence): from B00 onward this
 * script provides a dependency-free evidence registry/verification shell.
 * Batch B38 invokes only the already-committed version to regenerate the
 * tracked corpus at docs/06-verification/evidence/.
 *
 * This skeleton:
 *  - validates that the evidence root resolves inside the repository,
 *  - creates the root and a SHA256SUMS manifest shell when absent,
 *  - regenerates SHA256SUMS over the existing evidence files.
 *
 * CLI:
 *   bun scripts/generate-evidence.ts
 *
 * Exit codes:
 *   0  success
 *   1  evidence root cannot be established
 */

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

const EVIDENCE_DIR = 'docs/06-verification/evidence';
const SHA256SUMS = 'SHA256SUMS';

function repoRoot(): string {
  const result = Bun.spawnSync(['git', 'rev-parse', '--show-toplevel'], {
    stdout: 'pipe',
    stderr: 'pipe',
  });
  if (result.exitCode === 0) return result.stdout.toString().trim();
  return resolve(process.cwd());
}

/** Recursively collects regular files under a directory (no hidden entries). */
function collectFiles(dir: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir)) {
    if (entry.startsWith('.')) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) files.push(...collectFiles(full));
    else files.push(full);
  }
  return files;
}

function sha256File(filePath: string): string {
  return createHash('sha256').update(readFileSync(filePath)).digest('hex');
}

if (import.meta.main) {
  const root = repoRoot();
  const evidenceRoot = join(root, EVIDENCE_DIR);

  if (!existsSync(evidenceRoot)) {
    mkdirSync(evidenceRoot, { recursive: true });
    process.stdout.write(`generate-evidence: created evidence root ${evidenceRoot}\n`);
  }

  const sumPath = join(evidenceRoot, SHA256SUMS);
  if (!existsSync(sumPath)) {
    writeFileSync(sumPath, '', { encoding: 'utf8' });
    process.stdout.write(
      `generate-evidence: created empty manifest shell ${relative(root, sumPath)}\n`,
    );
  }

  // Regenerate SHA256SUMS over the existing evidence files (excludes the manifest itself).
  const entries = collectFiles(evidenceRoot)
    .map((abs) => relative(evidenceRoot, abs))
    .filter((rel) => rel !== SHA256SUMS)
    .sort();
  const lines = entries.map((rel) => `${sha256File(join(evidenceRoot, rel))}  ${rel}`);
  writeFileSync(sumPath, `${lines.join('\n')}${lines.length > 0 ? '\n' : ''}`, {
    encoding: 'utf8',
  });

  process.stdout.write(
    `generate-evidence: OK — ${entries.length} evidence file${entries.length === 1 ? '' : 's'} recorded in ${relative(root, sumPath)}\n`,
  );
  process.exit(0);
}
