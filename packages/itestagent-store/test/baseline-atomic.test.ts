import { afterEach, expect, test } from 'bun:test';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { BaselineRecord } from 'itestagent-contracts';
import { createBaselineStore } from '../src/baseline-store.js';

const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});
const record: BaselineRecord = {
  schemaVersion: 2,
  key: 'project|physical|device|26|scenario',
  targetKind: 'physical',
  memoryPeakMB: 20,
  approximate: true,
  updatedFromRun: 'old',
  createdAt: '2026-09-08T00:00:00Z',
  updatedAt: '2026-09-08T00:00:00Z',
  reachableRuns: ['old'],
};
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'itestagent-baseline-'));
  roots.push(root);
  const store = createBaselineStore(root);
  const compareAndSwap = store.compareAndSwap;
  if (!compareAndSwap) throw new Error('Native atomic store required');
  return { root, store: { ...store, compareAndSwap } };
}

test('baseline replacement compares the reviewed record and preserves it on conflict or abort', async () => {
  const { store } = await fixture();
  await store.save(record);
  const next = { ...record, memoryPeakMB: 30, updatedFromRun: 'new' };
  expect(await store.compareAndSwap(next, record)).toBe(true);
  expect(await store.compareAndSwap({ ...next, memoryPeakMB: 50 }, record)).toBe(false);
  const abort = new AbortController();
  abort.abort();
  await expect(store.compareAndSwap(record, next, abort.signal)).rejects.toThrow();
  expect((await store.get(record.key))?.memoryPeakMB).toBe(30);
});

test('concurrent initial writers cannot overwrite one another', async () => {
  const { store } = await fixture();
  const results = await Promise.allSettled([
    store.compareAndSwap(record, null),
    store.compareAndSwap({ ...record, memoryPeakMB: 99 }, null),
  ]);
  expect(results.filter((r) => r.status === 'fulfilled' && r.value)).toHaveLength(1);
  expect([20, 99]).toContain((await store.get(record.key))?.memoryPeakMB ?? -1);
});

test('production hash keys with patch-level iOS versions fit the filesystem name limit', async () => {
  const { store } = await fixture();
  const long = {
    ...record,
    key: `${'a'.repeat(64)}|physical|${'b'.repeat(64)}|26.0.1|${'c'.repeat(64)}`,
  };
  expect(await store.compareAndSwap(long, null)).toBe(true);
  expect(await store.get(long.key)).toEqual(long);
});

test('independent processes share the create-if-absent lock', async () => {
  const { root, store } = await fixture();
  const modulePath = join(import.meta.dir, '../src/baseline-store.ts');
  const program = `import { createBaselineStore } from ${JSON.stringify(modulePath)};
    const store = createBaselineStore(process.argv[1]);
    try { console.log(await store.compareAndSwap(JSON.parse(process.argv[2]), null)); }
    catch (error) { if (!String(error).includes('baseline_busy')) throw error; console.log('busy'); }`;
  const children = [20, 99].map((memoryPeakMB) =>
    Bun.spawn(
      [process.execPath, '-e', program, root, JSON.stringify({ ...record, memoryPeakMB })],
      { stdout: 'pipe', stderr: 'pipe' },
    ),
  );
  const outputs = await Promise.all(
    children.map(async (child) => {
      const [exit, stdout, stderr] = await Promise.all([
        child.exited,
        new Response(child.stdout).text(),
        new Response(child.stderr).text(),
      ]);
      expect(exit, stderr).toBe(0);
      return stdout.trim();
    }),
  );
  expect(outputs.filter((value) => value === 'true')).toHaveLength(1);
  expect([20, 99]).toContain((await store.get(record.key))?.memoryPeakMB ?? -1);
});

test('busy lock, malformed existing data and unsafe keys fail closed', async () => {
  const { root, store } = await fixture();
  await store.save(record);
  const path = join(root, 'baselines/physical', `${record.key}.json`);
  await writeFile(`${path}.lock`, 'owned by another writer');
  await expect(store.save({ ...record, memoryPeakMB: 40 })).rejects.toThrow('baseline_busy');
  expect(JSON.parse(await readFile(path, 'utf8')).memoryPeakMB).toBe(20);
  await rm(`${path}.lock`);
  await writeFile(path, 'corrupt');
  await expect(store.compareAndSwap(record, null)).rejects.toThrow();
  expect(await readFile(path, 'utf8')).toBe('corrupt');
  await expect(
    store.save({ ...record, key: '../escape|physical|device|26|scenario' }),
  ).rejects.toThrow();
});
