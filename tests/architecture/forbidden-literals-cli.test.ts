import { afterEach, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

const scanner = resolve(import.meta.dir, '../../scripts/scan-forbidden-literals.ts');
const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'itestagent literal gate '));
  roots.push(root);
  const git = (...args: string[]) => {
    const result = Bun.spawnSync(
      ['git', '-c', 'core.hooksPath=/dev/null', '-c', 'commit.gpgsign=false', ...args],
      { cwd: root, stdout: 'pipe', stderr: 'pipe' },
    );
    expect(result.exitCode).toBe(0);
    return result.stdout.toString().trim();
  };
  git('init', '-q');
  git(
    '-c',
    'user.name=Fixture',
    '-c',
    'user.email=fixture@example.invalid',
    'commit',
    '--allow-empty',
    '-qm',
    'Fixture base',
  );
  const base = git('rev-parse', 'HEAD');
  const write = (path: string, text: string) => {
    const file = join(root, path);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, text);
  };
  write('schemas/scenarios/fixture.json', '{"scenario":"feed-memory"}');
  write(
    'packages/itestagent-contracts/src/scenarios/fixture.ts',
    'export const scenario = "feed-memory";',
  );
  write('schemas/generic.json', '{}');
  const scan = (...args: string[]) => {
    const result = Bun.spawnSync([process.execPath, scanner, ...args], {
      cwd: root,
      stdout: 'pipe',
      stderr: 'pipe',
    });
    return { exit: result.exitCode, output: result.stdout.toString() };
  };
  return { write, scan, git, base };
}

test.each(['generic', 'all'])(
  'full %s CLI excludes scenarios but still rejects generic violations',
  (scope) => {
    const f = fixture();
    expect(f.scan('--scope', scope)).toEqual({
      exit: 0,
      output: `scan-forbidden-literals: OK (scope=${scope} mode=worktree files=1)\n`,
    });
    f.write('schemas/generic.json', '{"scenario":"feed-memory"}');
    f.write('schemas/scenarios-extra/fixture.json', '{"scenario":"echo-search"}');
    const bad = f.scan('--scope', scope);
    expect(bad.exit).toBe(1);
    expect(bad.output).toContain('schemas/generic.json: contains forbidden literal');
    expect(bad.output).toContain(
      'schemas/scenarios-extra/fixture.json: contains forbidden literal',
    );
    expect(bad.output).not.toContain('schemas/scenarios/fixture.json:');
    expect(bad.output).not.toContain('src/scenarios/fixture.ts:');
  },
);

test.each(['worktree', 'index'])(
  'changed %s CLI preserves exclusions and detects actual violations',
  (mode) => {
    const f = fixture();
    if (mode === 'index') f.git('add', '.');
    expect(f.scan('--base', f.base, `--${mode}`, '--scope', 'changed').exit).toBe(0);
    f.write('schemas/generic.json', '{"scenario":"feed-memory"}');
    if (mode === 'index') f.git('add', '.');
    const bad = f.scan('--base', f.base, `--${mode}`, '--scope', 'changed');
    expect(bad.exit).toBe(1);
    expect(bad.output).toContain('schemas/generic.json: contains forbidden literal');
    expect(bad.output).not.toContain('schemas/scenarios/');
  },
);
