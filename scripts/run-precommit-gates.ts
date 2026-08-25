/**
 * run-precommit-gates.ts — pre-commit gate runner (promotion guide §12.3
 * steps 6-8, §16 G1-G7/G4b, §11.4).
 *
 * Runs the gate sequence AFTER the pre-Bun G7 receipt has bound the staged
 * tree. The gate receipt (Git-dir-local, written by the §12.3 step-6 inline
 * writer) must already carry `{batchId, stagedTreeHash, g7:true}`.
 *
 * Flow:
 *  (1) verify the gate receipt via safe-receipt.py read-field:
 *        stagedTreeHash == --staged-tree-hash AND g7 == true
 *  (2) run gates in order, recording {name, command, exit}:
 *        G1   bun test tests/architecture/schema-parity-gate.test.ts
 *        G2   bun scripts/scan-forbidden-literals.ts --base <BASE> --index --scope changed
 *        G3   bun ci --ignore-scripts && bun run typecheck && bun run lint && bun run build
 *        G4   bun scripts/run-batch-tests.ts <B> ; bun run test:ci
 *        G4b  bun test tests/architecture/dependency-graph.test.ts tests/architecture/forbidden-literals.test.ts tests/architecture/bunfig-policy.test.ts
 *        LOCK_INVARIANT (B05/B37 only) bun scripts/verify-lock-invariant.ts ...
 *        G7   bun run gate:g7
 *  (3) any non-zero gate exit => overall non-zero and pass:false (no PASS)
 *  (4) require `git write-tree` to still equal --staged-tree-hash at the end
 *  (5) update the SAME gate receipt in place (remove + write-text exclusive)
 *      with {batchId, stagedTreeHash, g7, pass, gateCommands}
 *
 * All `bun` invocations use `process.execPath` (the verified binary running
 * this script), never a PATH-resolved bun.
 *
 * CLI:
 *   bun scripts/run-precommit-gates.ts --batch <B> --base <BASE_SHA> \
 *       --gate-receipt <path> --staged-tree-hash <GATED_TREE> [--lock-receipt <path>]
 *
 * Exit codes:
 *   0  all gates passed (receipt updated with pass:true)
 *   1  at least one gate failed or the tree changed (receipt updated with pass:false)
 *   2  usage / configuration error
 */

import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

interface GateRecord {
  name: string;
  command: string;
  exit: number;
}

interface RunResult {
  status: number;
  stdout: string;
  stderr: string;
}

function usage(message: string): never {
  process.stderr.write(`run-precommit-gates: ${message}\n`);
  process.stderr.write(
    'usage: bun scripts/run-precommit-gates.ts --batch <B> --base <BASE_SHA> --gate-receipt <path> --staged-tree-hash <GATED_TREE> [--lock-receipt <path>]\n',
  );
  process.exit(2);
}

function fail(message: string): never {
  process.stderr.write(`run-precommit-gates: ${message}\n`);
  process.exit(1);
}

function parseArgs(argv: string[]): {
  batch: string;
  base: string;
  gateReceipt: string;
  stagedTreeHash: string;
  lockReceipt?: string;
} {
  const opts: Record<string, string | undefined> = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const value = argv[++i];
    if (value === undefined || value.startsWith('--')) usage(`${arg} requires a value`);
    if (arg === '--batch') opts.batch = value;
    else if (arg === '--base') opts.base = value;
    else if (arg === '--gate-receipt') opts.gateReceipt = value;
    else if (arg === '--staged-tree-hash') opts.stagedTreeHash = value;
    else if (arg === '--lock-receipt') opts.lockReceipt = value;
    else usage(`unexpected argument "${arg}"`);
  }
  for (const key of ['batch', 'base', 'gateReceipt', 'stagedTreeHash'] as const) {
    if (opts[key] === undefined) usage(`--${key} is required`);
  }
  const batch = opts.batch;
  const base = opts.base;
  const gateReceipt = opts.gateReceipt;
  const stagedTreeHash = opts.stagedTreeHash;
  if (
    batch === undefined ||
    base === undefined ||
    gateReceipt === undefined ||
    stagedTreeHash === undefined
  ) {
    usage('--batch, --base, --gate-receipt and --staged-tree-hash are required');
  }
  if (!/^B[0-4][0-9]$/.test(batch)) fail(`invalid --batch "${batch}"`);
  if (!/^[0-9a-f]{40}$/.test(stagedTreeHash)) {
    fail(`--staged-tree-hash must be a 40-hex git SHA, got "${stagedTreeHash}"`);
  }
  return { batch, base, gateReceipt, stagedTreeHash, lockReceipt: opts.lockReceipt };
}

function repoRoot(): string {
  const res = spawnSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' });
  if (res.status !== 0) fail(`not inside a git repository: ${res.stderr?.trim()}`);
  return resolve((res.stdout ?? '').trim());
}

/** Runs a command; returns status + captured output (never throws). */
function run(cmd: string[], cwd: string): RunResult {
  try {
    const command = cmd[0];
    if (command === undefined) return { status: -1, stdout: '', stderr: 'empty command' };
    const res = spawnSync(command, cmd.slice(1), { cwd, encoding: 'utf8' });
    return {
      status: res.status ?? -1,
      stdout: (res.stdout ?? '').toString(),
      stderr: (res.stderr ?? '').toString(),
    };
  } catch (err) {
    return { status: -1, stdout: '', stderr: String(err) };
  }
}

function gitTree(cwd: string): string {
  const res = run(['git', 'write-tree'], cwd);
  if (res.status !== 0) fail(`git write-tree failed: ${res.stderr.trim()}`);
  return res.stdout.trim();
}

/** Reads one field from the gate receipt via safe-receipt.py; null on failure. */
function receiptField(cwd: string, receipt: string, field: string): string | null {
  const res = run(
    ['python3', 'scripts/safe-receipt.py', 'read-field', '--path', receipt, '--field', field],
    cwd,
  );
  if (res.status !== 0) return null;
  return res.stdout.trim();
}

/** Writes a full receipt JSON via safe-receipt.py (remove + exclusive write). */
function writeReceipt(cwd: string, receipt: string, payload: unknown): void {
  const remove = run(
    ['python3', 'scripts/safe-receipt.py', 'remove', '--path', receipt, '--allow-absent'],
    cwd,
  );
  if (remove.status !== 0) fail(`cannot remove stale receipt ${receipt}: ${remove.stderr.trim()}`);
  const value = `${JSON.stringify(payload)}\n`;
  const write = run(
    [
      'python3',
      'scripts/safe-receipt.py',
      'write-text',
      '--exclusive',
      '--path',
      receipt,
      '--value',
      value,
    ],
    cwd,
  );
  if (write.status !== 0) fail(`cannot write receipt ${receipt}: ${write.stderr.trim()}`);
}

function main(): void {
  const opts = parseArgs(process.argv.slice(2));
  const root = repoRoot();

  // (1) Verify the pre-Bun G7 receipt binds exactly the requested tree.
  const boundTree = receiptField(root, opts.gateReceipt, 'stagedTreeHash');
  if (boundTree === null)
    fail(`gate receipt unreadable or missing stagedTreeHash: ${opts.gateReceipt}`);
  if (boundTree !== opts.stagedTreeHash) {
    fail(`gate receipt tree ${boundTree} != --staged-tree-hash ${opts.stagedTreeHash}`);
  }
  const g7Field = receiptField(root, opts.gateReceipt, 'g7');
  if (g7Field === null || JSON.parse(g7Field) !== true) {
    fail(`gate receipt g7 !== true (pre-Bun secret scan did not pass): ${opts.gateReceipt}`);
  }
  const batchIdField = receiptField(root, opts.gateReceipt, 'batchId');
  const batchId = batchIdField ?? opts.batch;

  // B05/B37 lock-invariant requirement is a pre-flight check.
  if ((opts.batch === 'B05' || opts.batch === 'B37') && !opts.lockReceipt) {
    fail(`${opts.batch} requires --lock-receipt`);
  }

  const gates: GateRecord[] = [];
  let pass = true;

  const runGate = (name: string, cmd: string[], commandText: string): number => {
    const res = run(cmd, root);
    if (res.status !== 0) {
      process.stderr.write(
        `run-precommit-gates: FAIL ${name} (exit ${res.status}):\n${res.stderr.trim()}\n`,
      );
    } else {
      process.stderr.write(`run-precommit-gates: OK ${name}\n`);
    }
    gates.push({ name, command: commandText, exit: res.status });
    return res.status;
  };

  // G1 — runtime/published schema parity.
  runGate(
    'G1',
    [process.execPath, 'test', 'tests/architecture/schema-parity-gate.test.ts'],
    'bun test tests/architecture/schema-parity-gate.test.ts',
  );

  // G2 — forbidden literals, base -> index.
  runGate(
    'G2',
    [
      process.execPath,
      'scripts/scan-forbidden-literals.ts',
      '--base',
      opts.base,
      '--index',
      '--scope',
      'changed',
    ],
    `bun scripts/scan-forbidden-literals.ts --base ${opts.base} --index --scope changed`,
  );

  // G3 — reproducible install (--ignore-scripts) + static checks + build.
  {
    const steps: Array<{ cmd: string[]; text: string }> = [
      { cmd: [process.execPath, 'ci', '--ignore-scripts'], text: 'bun ci --ignore-scripts' },
      { cmd: [process.execPath, 'run', 'typecheck'], text: 'bun run typecheck' },
      { cmd: [process.execPath, 'run', 'lint'], text: 'bun run lint' },
      { cmd: [process.execPath, 'run', 'build'], text: 'bun run build' },
    ];
    const commandText =
      'bun ci --ignore-scripts && bun run typecheck && bun run lint && bun run build';
    let worst = 0;
    for (const step of steps) {
      const res = run(step.cmd, root);
      if (res.status !== 0) {
        process.stderr.write(
          `run-precommit-gates: FAIL G3 (${step.text}, exit ${res.status}):\n${res.stderr.trim()}\n`,
        );
        worst = res.status;
        break;
      }
    }
    if (worst === 0) process.stderr.write('run-precommit-gates: OK G3\n');
    gates.push({ name: 'G3', command: commandText, exit: worst });
    if (worst !== 0) pass = false;
  }

  // G4 — batch test command, then the full CI test suite.
  runGate(
    'G4',
    [process.execPath, 'scripts/run-batch-tests.ts', opts.batch],
    `bun scripts/run-batch-tests.ts ${opts.batch}`,
  );
  runGate('G4', [process.execPath, 'run', 'test:ci'], 'bun run test:ci');

  // G4b — dependency graph, manifest edges, bunfig policy.
  runGate(
    'G4b',
    [
      process.execPath,
      'test',
      'tests/architecture/dependency-graph.test.ts',
      'tests/architecture/forbidden-literals.test.ts',
      'tests/architecture/bunfig-policy.test.ts',
    ],
    'bun test tests/architecture/dependency-graph.test.ts tests/architecture/forbidden-literals.test.ts tests/architecture/bunfig-policy.test.ts',
  );

  // LOCK_INVARIANT — B05/B37 only.
  if (opts.batch === 'B05' || opts.batch === 'B37') {
    runGate(
      'LOCK_INVARIANT',
      [
        process.execPath,
        'scripts/verify-lock-invariant.ts',
        '--batch',
        opts.batch,
        '--receipt',
        opts.lockReceipt ?? '',
        '--file',
        'bun.lock',
      ],
      `bun scripts/verify-lock-invariant.ts --batch ${opts.batch} --receipt ${opts.lockReceipt} --file bun.lock`,
    );
  }

  // Final G7 — secret / raw identity / high-risk authorization.
  runGate('G7', [process.execPath, 'run', 'gate:g7'], 'bun run gate:g7');

  if (gates.some((g) => g.exit !== 0)) pass = false;

  // (4) The staged tree must be unchanged after all gates.
  const finalTree = gitTree(root);
  if (finalTree !== opts.stagedTreeHash) {
    pass = false;
    process.stderr.write(
      `run-precommit-gates: FAIL tree-bind: git write-tree ${finalTree} != --staged-tree-hash ${opts.stagedTreeHash}\n`,
    );
  }

  // (5) Update the gate receipt in place with the full gate record.
  writeReceipt(root, opts.gateReceipt, {
    batchId,
    stagedTreeHash: opts.stagedTreeHash,
    g7: true,
    pass,
    gateCommands: gates,
  });

  process.stdout.write(
    `${JSON.stringify({ batchId, pass, gates: gates.map((g) => ({ name: g.name, exit: g.exit })) })}\n`,
  );
  process.exit(pass ? 0 : 1);
}

if (import.meta.main) {
  main();
}
