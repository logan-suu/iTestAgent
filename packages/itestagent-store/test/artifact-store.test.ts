import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseArtifactIndex } from 'itestagent-contracts';
import { createArtifactStore, createPersistentArtifactStore } from '../src/artifact-store.js';

describe('ArtifactStore', () => {
  let testRoot: string;
  let artifactStore: ReturnType<typeof createArtifactStore>;

  beforeEach(() => {
    testRoot = join(
      tmpdir(),
      `itestagent-artifact-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    );
    mkdirSync(join(testRoot, 'artifacts'), { recursive: true });
    artifactStore = createArtifactStore(join(testRoot, 'artifacts'));
  });

  afterEach(() => {
    if (existsSync(testRoot)) {
      rmSync(testRoot, { recursive: true, force: true });
    }
  });

  describe('put', () => {
    // AC2: 大文件 artifact 存文件系统
    it('stores a Buffer artifact and returns an ArtifactRef (AC2)', async () => {
      const data = Buffer.from('screenshot-data');
      const ref = await artifactStore.put({
        type: 'screenshot',
        data,
        mimeType: 'image/png',
        relatedStep: 'step-1',
        backend: 'appium',
      });

      expect(ref.id).toBeDefined();
      expect(ref.type).toBe('screenshot');
      expect(ref.mimeType).toBe('image/png');
      // ref.path is relative to artifactsRoot per data contract
      expect(ref.path).not.toStartWith('/');
      expect(existsSync(join(testRoot, 'artifacts', ref.path))).toBe(true);

      const stored = readFileSync(join(testRoot, 'artifacts', ref.path));
      expect(stored.equals(data)).toBe(true);
    });

    it('stores an artifact from a file path into artifacts root', async () => {
      const tmpFile = join(testRoot, 'source.txt');
      const content = Buffer.from('log-content');
      Bun.write(tmpFile, content);

      const ref = await artifactStore.put({
        type: 'log',
        path: tmpFile,
        relatedStep: 'step-2',
      });

      expect(ref.id).toBeDefined();
      expect(ref.type).toBe('log');
      // ref.path is relative to artifactsRoot per data contract
      expect(ref.path).not.toStartWith('/');
      expect(existsSync(join(testRoot, 'artifacts', ref.path))).toBe(true);
      expect(readFileSync(join(testRoot, 'artifacts', ref.path)).equals(content)).toBe(true);
    });

    it('generates unique IDs for each artifact', async () => {
      const ref1 = await artifactStore.put({ type: 'text', data: Buffer.from('a') });
      const ref2 = await artifactStore.put({ type: 'text', data: Buffer.from('b') });

      expect(ref1.id).not.toBe(ref2.id);
    });
  });

  describe('get', () => {
    it('returns an ArtifactRef for an existing artifact', async () => {
      const ref = await artifactStore.put({ type: 'json', data: Buffer.from('{}') });

      const found = await artifactStore.get(ref.id);
      expect(found).not.toBeNull();
      expect(found?.id).toBe(ref.id);
      expect(found?.type).toBe('json');
    });

    it('returns null for a non-existent artifact', async () => {
      const found = await artifactStore.get('nonexistent-id');
      expect(found).toBeNull();
    });
  });

  describe('search', () => {
    it('finds artifacts by type', async () => {
      await artifactStore.put({ type: 'screenshot', data: Buffer.from('a') });
      await artifactStore.put({ type: 'screenshot', data: Buffer.from('b') });
      await artifactStore.put({ type: 'log', data: Buffer.from('c') });

      const results = await artifactStore.search('screenshot');
      expect(results.length).toBe(2);
      expect(results.every((r) => r.type === 'screenshot')).toBe(true);
    });

    it('finds artifacts by related step ID', async () => {
      await artifactStore.put({ type: 'json', data: Buffer.from('{}'), relatedStep: 'step-login' });
      await artifactStore.put({ type: 'text', data: Buffer.from('x'), relatedStep: 'step-home' });

      const results = await artifactStore.search('login');
      expect(results.length).toBe(1);
      expect(results[0]?.relatedStep).toBe('step-login');
    });

    it('returns empty array when no matches found', async () => {
      const results = await artifactStore.search('nothing');
      expect(results).toEqual([]);
    });
  });

  describe('run directory structure', () => {
    it('stores artifacts inside the artifacts root (AC3)', async () => {
      const ref = await artifactStore.put({
        type: 'text',
        data: Buffer.from('hello'),
        path: join(testRoot, 'artifacts', 'step-1-output.txt'),
      });

      // ref.path always inside artifactsRoot after put()
      // ref.path is relative to artifactsRoot per data contract
      expect(ref.path).not.toStartWith('/');
      expect(existsSync(join(testRoot, 'artifacts', ref.path))).toBe(true);
      expect(readFileSync(join(testRoot, 'artifacts', ref.path)).equals(Buffer.from('hello'))).toBe(
        true,
      );
    });
  });

  describe('integrity metadata (B07)', () => {
    it('put computes sizeBytes and sha256 for materialized artifacts', async () => {
      const data = Buffer.from('integrity-payload');
      const ref = await artifactStore.put({ type: 'json', data });
      expect(ref.sizeBytes).toBe(data.byteLength);
      expect(ref.sha256).toBe(createHash('sha256').update(data).digest('hex'));
    });

    it('persistent store writes artifact-index.json atomically beside the run dir', async () => {
      const runDir = join(testRoot, 'runs', 'run_b07_persist');
      mkdirSync(join(runDir, 'artifacts'), { recursive: true });
      const store = createPersistentArtifactStore(join(runDir, 'artifacts'), 'run_b07_persist');

      await store.put({ type: 'text', data: Buffer.from('persist-me'), relatedStep: 'step-1' });

      const indexPath = join(runDir, 'artifact-index.json');
      expect(existsSync(indexPath)).toBe(true);
      // Atomic write leaves no temp residue next to the index.
      const leftovers = readdirSync(runDir).filter(
        (name) => name !== 'artifact-index.json' && name !== 'artifacts',
      );
      expect(leftovers).toEqual([]);

      const parsed = parseArtifactIndex(JSON.parse(readFileSync(indexPath, 'utf-8')));
      const entry = parsed.artifacts[0];
      expect(entry?.sha256).toBeDefined();
      expect(entry?.sizeBytes).toBeGreaterThan(0);
      expect(entry?.relatedStep).toBe('step-1');
    });
  });
});
