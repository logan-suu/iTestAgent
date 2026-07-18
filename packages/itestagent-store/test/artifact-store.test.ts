import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createArtifactStore } from '../src/artifact-store.js';

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
      expect(ref.path).toStartWith(join(testRoot, 'artifacts'));
      expect(existsSync(ref.path)).toBe(true);

      const stored = readFileSync(ref.path);
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
      expect(ref.path).toStartWith(join(testRoot, 'artifacts'));
      expect(existsSync(ref.path)).toBe(true);
      expect(readFileSync(ref.path).equals(content)).toBe(true);
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
      expect(ref.path).toStartWith(join(testRoot, 'artifacts'));
      expect(existsSync(ref.path)).toBe(true);
      expect(readFileSync(ref.path).equals(Buffer.from('hello'))).toBe(true);
    });
  });
});
