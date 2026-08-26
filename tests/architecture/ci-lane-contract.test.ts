import { describe, expect, test } from 'bun:test';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dir, '..', '..');

describe('CI lane contract (§11.3 root scripts + CI lanes)', () => {
  test('workflow lanes exist', () => {
    for (const wf of ['ci.yml', 'security-scan.yml', 'simulator-ci.yml']) {
      expect(existsSync(join(ROOT, '.github', 'workflows', wf)), wf).toBe(true);
    }
  });

  test('package.json exposes the core scripts', () => {
    const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf-8')) as {
      scripts?: Record<string, string>;
    };
    for (const s of ['typecheck', 'lint', 'test:ci', 'test:unit', 'batch:test']) {
      expect(typeof pkg.scripts?.[s], s).toBe('string');
    }
  });

  test('bunfig.toml pins the bun protocol', () => {
    const bunfig = readFileSync(join(ROOT, 'bunfig.toml'), 'utf-8');
    expect(bunfig).toContain('bun');
  });
});
