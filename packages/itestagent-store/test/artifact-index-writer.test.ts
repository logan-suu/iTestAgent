/**
 * artifact-integrity.test.ts coverage lives here in B07 — no, this file is
 * the writer test. See artifact-integrity assertions embedded in
 * artifact-store.test.ts (put computes sha256/sizeBytes) and
 * run-store-files.test.ts (index round-trip). This file locks the atomic
 * artifact-index.json writer itself.
 *
 * B07 (promotion guide §11.3 "store artifacts", §6.1 "atomic writer +
 * integrity hash", L7 evidence line).
 */
import { describe, expect, it } from 'bun:test';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { parseArtifactIndex } from 'itestagent-contracts';
import { writeArtifactIndex } from '../src/artifact-index-writer.js';
import { measureBufferSha256 } from '../src/artifact-integrity.js';

function makeTempRoot(prefix: string): string {
  const root = join(
    '/tmp',
    `itestagent-b07-writer-${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  mkdirSync(root, { recursive: true });
  return root;
}

function validIndex() {
  return {
    schemaVersion: '1.0',
    runId: 'run_b07_writer',
    artifacts: [
      {
        id: 'art-1',
        type: 'screenshot' as const,
        path: 'artifacts/art-1.png',
        sizeBytes: 11,
        sha256: measureBufferSha256(Buffer.from('hello-world')),
        redactionStatus: 'raw-local-only' as const,
      },
    ],
  };
}

describe('writeArtifactIndex', () => {
  it('writes canonical JSON that parses back through the published contract', () => {
    const root = makeTempRoot('roundtrip');
    const result = writeArtifactIndex(root, validIndex());

    expect(existsSync(result.indexPath)).toBe(true);
    const parsed = parseArtifactIndex(JSON.parse(readFileSync(result.indexPath, 'utf-8')));
    expect(parsed.runId).toBe('run_b07_writer');
    expect(parsed.artifacts[0]?.id).toBe('art-1');
    rmSync(root, { recursive: true, force: true });
  });

  it('returns byte count and sha256 of the written document', () => {
    const root = makeTempRoot('digest');
    const raw = JSON.stringify(validIndex(), null, 2);
    const result = writeArtifactIndex(root, validIndex());

    const onDisk = readFileSync(result.indexPath);
    expect(result.bytes).toBe(onDisk.byteLength);
    expect(result.sha256).toBe(createHash('sha256').update(onDisk).digest('hex'));
    // Canonical serialization: identical input → identical bytes → stable hash.
    expect(onDisk.toString('utf-8')).toBe(`${raw}\n`);
    rmSync(root, { recursive: true, force: true });
  });

  it('leaves no temporary files behind (atomic rename)', () => {
    const root = makeTempRoot('atomic');
    writeArtifactIndex(root, validIndex());
    writeArtifactIndex(root, validIndex());

    const leftovers = readdirSync(root).filter((name) => name !== 'artifact-index.json');
    expect(leftovers).toEqual([]);
    rmSync(root, { recursive: true, force: true });
  });

  it('overwrites a previously written index in place', () => {
    const root = makeTempRoot('overwrite');
    const first = writeArtifactIndex(root, validIndex());
    const second = writeArtifactIndex(root, validIndex());
    expect(second.indexPath).toBe(first.indexPath);
    expect(second.sha256).toBe(first.sha256);

    const mutated = validIndex();
    const firstEntry = mutated.artifacts[0];
    if (firstEntry) {
      mutated.artifacts[0] = { ...firstEntry, id: 'art-2' };
    }
    const third = writeArtifactIndex(root, mutated);
    expect(third.sha256).not.toBe(first.sha256);
    expect(
      parseArtifactIndex(JSON.parse(readFileSync(third.indexPath, 'utf-8'))).artifacts[0]?.id,
    ).toBe('art-2');
    rmSync(root, { recursive: true, force: true });
  });

  it('fails closed on an index missing schemaVersion and writes nothing', () => {
    const root = makeTempRoot('failclosed');
    const broken = { runId: 'run_x', artifacts: [] } as unknown as Parameters<
      typeof writeArtifactIndex
    >[1];
    expect(() => writeArtifactIndex(root, broken)).toThrow();
    expect(existsSync(join(root, 'artifact-index.json'))).toBe(false);
    rmSync(root, { recursive: true, force: true });
  });

  it('creates the target directory when missing', () => {
    const root = makeTempRoot('mkdir');
    const nested = join(root, 'runs', 'run_nested');
    const result = writeArtifactIndex(nested, validIndex());
    expect(existsSync(result.indexPath)).toBe(true);
    rmSync(root, { recursive: true, force: true });
  });
});
