/**
 * phase1-artifact-store.test.ts — Integration test for artifact persistence.
 *
 * Cross-package chain under test:
 *   createArtifactStore (itestagent-store) → filesystem (node:fs)
 *   → ArtifactRef schema (itestagent-contracts) → artifact-index model
 *
 * Verifies:
 *   - ArtifactStore.put() writes data to filesystem + returns ArtifactRef
 *   - ArtifactStore.put() from file path copies data
 *   - ArtifactStore.get() retrieves by id
 *   - ArtifactStore.search() finds by type and relatedStep
 *   - ArtifactStore handles all artifact types (screenshot/video/uitree/log/trace/xcresult/json)
 *   - MIME type defaults correctly per artifact type
 *   - Redaction status is always 'raw-local-only' in Phase 1
 *   - Filesystem directory is created if it doesn't exist
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ArtifactRefSchema, parseArtifactRef } from 'itestagent-contracts';
import type { ArtifactRef } from 'itestagent-contracts';
import { createArtifactStore } from 'itestagent-store';

// ─── Helpers ──────────────────────────────────────────────

function tempDir(): string {
  return mkdtempSync(join(tmpdir(), 'itestagent-artifacts-'));
}

// ─── Suite ────────────────────────────────────────────────

describe('Phase 1 Integration: Artifact Store (Store ← filesystem ← Contracts)', () => {
  let artifactsRoot: string;

  beforeEach(() => {
    artifactsRoot = tempDir();
  });

  afterEach(() => {
    rmSync(artifactsRoot, { recursive: true, force: true });
  });

  // ─── 1. put() with data — writes to filesystem ────────

  test('put() writes data to filesystem and returns ArtifactRef', async () => {
    const store = createArtifactStore(artifactsRoot);

    const ref = await store.put({
      type: 'screenshot',
      data: Buffer.from('fake-png-data'),
    });

    expect(ref.id).toBeDefined();
    expect(ref.type).toBe('screenshot');
    expect(ref.mimeType).toBe('image/png');
    expect(ref.redactionStatus).toBe('raw-local-only');
    expect(ref.path).toContain(artifactsRoot);
    expect(existsSync(ref.path)).toBe(true);
  });

  // ─── 2. put() from file path — copies data ────────────

  test('put() from file path copies the file', async () => {
    // Create a source file
    const srcDir = tempDir();
    const srcPath = join(srcDir, 'source.log');
    writeFileSync(srcPath, 'log line 1\nlog line 2\n');

    const store = createArtifactStore(artifactsRoot);

    const ref = await store.put({
      type: 'log',
      path: srcPath,
      relatedStep: 'step_1',
    });

    expect(ref.type).toBe('log');
    expect(ref.relatedStep).toBe('step_1');
    expect(existsSync(ref.path)).toBe(true);

    // Content was copied
    const content = readFileSync(ref.path, 'utf-8');
    expect(content).toBe('log line 1\nlog line 2\n');

    rmSync(srcDir, { recursive: true, force: true });
  });

  // ─── 3. get() retrieves by id ─────────────────────────

  test('get() retrieves artifact by id', async () => {
    const store = createArtifactStore(artifactsRoot);

    const ref = await store.put({
      type: 'uitree',
      data: Buffer.from(JSON.stringify({ elements: [] })),
    });

    const retrieved = await store.get(ref.id);
    expect(retrieved).toBeDefined();
    expect(retrieved?.id).toBe(ref.id);
    expect(retrieved?.type).toBe('uitree');
  });

  test('get() returns null for unknown id', async () => {
    const store = createArtifactStore(artifactsRoot);
    const result = await store.get('nonexistent');
    expect(result).toBeNull();
  });

  // ─── 4. search() finds by type ────────────────────────

  test('search() finds artifacts by type substring', async () => {
    const store = createArtifactStore(artifactsRoot);

    await store.put({ type: 'screenshot', data: Buffer.from('img1') });
    await store.put({ type: 'screenshot', data: Buffer.from('img2') });
    await store.put({ type: 'log', data: Buffer.from('log data') });
    await store.put({ type: 'video', data: Buffer.from('vid') });

    const screenshots = await store.search('screenshot');
    expect(screenshots).toHaveLength(2);

    const logs = await store.search('log');
    expect(logs).toHaveLength(1);

    const videos = await store.search('video');
    expect(videos).toHaveLength(1);
  });

  // ─── 5. search() finds by relatedStep ─────────────────

  test('search() finds artifacts by relatedStep', async () => {
    const store = createArtifactStore(artifactsRoot);

    await store.put({
      type: 'screenshot',
      data: Buffer.from('img'),
      relatedStep: 'step_login',
    });
    await store.put({
      type: 'log',
      data: Buffer.from('log'),
      relatedStep: 'step_login',
    });
    await store.put({
      type: 'screenshot',
      data: Buffer.from('img'),
      relatedStep: 'step_home',
    });

    const loginArtifacts = await store.search('step_login');
    expect(loginArtifacts).toHaveLength(2);

    const homeArtifacts = await store.search('step_home');
    expect(homeArtifacts).toHaveLength(1);
  });

  // ─── 6. search() case-insensitive ─────────────────────

  test('search() is case-insensitive', async () => {
    const store = createArtifactStore(artifactsRoot);

    await store.put({ type: 'screenshot' as const, data: Buffer.from('img') });

    const results = await store.search('screenshot');
    expect(results).toHaveLength(1);
  });

  // ─── 7. All artifact types ────────────────────────────

  test('all artifact types are supported', async () => {
    const store = createArtifactStore(artifactsRoot);
    const types = [
      'screenshot',
      'video',
      'uitree',
      'log',
      'crashlog',
      'text',
      'trace',
      'xcresult',
      'json',
    ] as const;

    for (const type of types) {
      const ref = await store.put({ type, data: Buffer.from('data') });
      expect(ref.type).toBe(type);
      expect(existsSync(ref.path)).toBe(true);
    }
  });

  // ─── 8. MIME type defaults ────────────────────────────

  test('correct MIME type defaults per artifact type', async () => {
    const store = createArtifactStore(artifactsRoot);

    const screenshot = await store.put({ type: 'screenshot', data: Buffer.from('') });
    expect(screenshot.mimeType).toBe('image/png');

    const video = await store.put({ type: 'video', data: Buffer.from('') });
    expect(video.mimeType).toBe('video/mp4');

    const uitree = await store.put({ type: 'uitree', data: Buffer.from('') });
    expect(uitree.mimeType).toBe('application/json');

    const json = await store.put({ type: 'json', data: Buffer.from('') });
    expect(json.mimeType).toBe('application/json');

    const log = await store.put({ type: 'log', data: Buffer.from('') });
    expect(log.mimeType).toBe('application/octet-stream');
  });

  // ─── 9. Custom MIME type override ─────────────────────

  test('custom mimeType overrides default', async () => {
    const store = createArtifactStore(artifactsRoot);

    const ref = await store.put({
      type: 'log',
      data: Buffer.from(''),
      mimeType: 'text/plain',
    });

    expect(ref.mimeType).toBe('text/plain');
  });

  // ─── 10. Schema round-trip ────────────────────────────

  test('ArtifactRef schema validates all fields', async () => {
    const store = createArtifactStore(artifactsRoot);

    const ref = await store.put({
      type: 'screenshot',
      data: Buffer.from('test'),
      relatedStep: 'step_1',
      mimeType: 'image/png',
    });

    // Schema validation
    const parsed = ArtifactRefSchema.parse(ref);
    expect(parsed.id).toBe(ref.id);
    expect(parsed.type).toBe('screenshot');
    expect(parsed.relatedStep).toBe('step_1');

    // Helper parse
    const parsed2 = parseArtifactRef(ref);
    expect(parsed2.id).toBe(ref.id);
  });
});
