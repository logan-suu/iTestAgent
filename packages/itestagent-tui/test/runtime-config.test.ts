import { afterEach, expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadTuiRuntimeConfig } from '../src/runtime-config.js';

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

async function rootsForTest() {
  const home = await mkdtemp(join(tmpdir(), 'itestagent-runtime-home-'));
  const workspace = await mkdtemp(join(tmpdir(), 'itestagent-runtime-workspace-'));
  roots.push(home, workspace);
  return { home, workspace };
}

test('loads renderer and global deny rules through the three-layer config', async () => {
  const { home, workspace } = await rootsForTest();
  await mkdir(join(home, '.itestagent', 'config'), { recursive: true });
  await writeFile(
    join(home, '.itestagent', 'config', 'itestagent.jsonc'),
    JSON.stringify({
      tui: { framework: 'ink' },
      permissions: {
        deniedRules: [{ action: 'uninstall_app', resource: '*', effect: 'deny' }],
      },
    }),
  );
  expect(loadTuiRuntimeConfig({ workspace, homeDir: home }).tui.framework).toBe('ink');
  expect(loadTuiRuntimeConfig({ workspace, homeDir: home }).permissions.deniedRules).toHaveLength(
    1,
  );
});

test('rejects permission rules from either project layer', async () => {
  const { home, workspace } = await rootsForTest();
  await writeFile(
    join(workspace, 'itestagent.jsonc'),
    JSON.stringify({ permissions: { deniedRules: [] } }),
  );
  expect(() => loadTuiRuntimeConfig({ workspace, homeDir: home })).toThrow(
    'Project config cannot declare global-only permissions',
  );
});
