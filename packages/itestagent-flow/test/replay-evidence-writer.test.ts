/**
 * replay-evidence-writer.test.ts — B08 coverage for the extracted evidence
 * writer (promotion guide §11.3 "Flow replay/redaction", §6.1 "artifact
 * trio、完整性 hash").
 *
 * collectStepEvidence was moved out of the former replay.ts monolith;
 * writeEvidenceManifest is the new disk-persistence half: evidence refs are
 * serialized to evidence-manifest.json atomically (temp + rename) so a crash
 * mid-write never leaves a torn manifest beside a passing run.
 */
import { describe, expect, it } from 'bun:test';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type {
  ArtifactRef,
  DeviceBackend,
  DeviceTarget,
  ScreenshotInput,
  UiTreeSnapshot,
} from 'itestagent-contracts';
import { collectStepEvidence, writeEvidenceManifest } from '../src/replay-evidence-writer.js';

function makeBackend(opts: { screenshotFails?: boolean; uiTreeFails?: boolean }): DeviceBackend {
  return {
    name: 'b08-evidence-fake',
    async screenshot(_i: ScreenshotInput): Promise<ArtifactRef> {
      if (opts.screenshotFails) throw new Error('no screenshot configured');
      return { id: `ss_${Date.now()}`, type: 'screenshot', path: '', redactionStatus: 'safe' };
    },
    async getUiTree(_i: DeviceTarget): Promise<UiTreeSnapshot> {
      if (opts.uiTreeFails) throw new Error('no uiTree configured');
      return { raw: '<xml/>' } as UiTreeSnapshot;
    },
  } as unknown as DeviceBackend;
}

describe('collectStepEvidence', () => {
  it('collects screenshot and uitree stub when both succeed', async () => {
    const backend = makeBackend({});
    const evidence = await collectStepEvidence(backend, 'dev-b08', 1);
    expect(evidence).toHaveLength(2);
    expect(evidence[0]?.type).toBe('screenshot');
    expect(evidence[1]?.type).toBe('uitree');
    expect(evidence[1]?.path).toBe('');
  });

  it('keeps the step green when only the screenshot fails', async () => {
    const backend = makeBackend({ screenshotFails: true });
    const evidence = await collectStepEvidence(backend, 'dev-b08', 2);
    expect(evidence).toHaveLength(1);
    expect(evidence[0]?.type).toBe('uitree');
  });

  it('keeps the step green when only the ui tree fails', async () => {
    const backend = makeBackend({ uiTreeFails: true });
    const evidence = await collectStepEvidence(backend, 'dev-b08', 3);
    expect(evidence).toHaveLength(1);
    expect(evidence[0]?.type).toBe('screenshot');
  });

  it('returns empty evidence when every capture fails (never fabricates, R5)', async () => {
    const backend = makeBackend({ screenshotFails: true, uiTreeFails: true });
    const evidence = await collectStepEvidence(backend, 'dev-b08', 4);
    expect(evidence).toEqual([]);
  });
});

describe('writeEvidenceManifest', () => {
  const sampleRefs: ArtifactRef[] = [
    { id: 'ss_1', type: 'screenshot', path: '', redactionStatus: 'safe' },
    { id: 'tree_1', type: 'uitree', path: '', redactionStatus: 'safe' },
  ];

  function makeTempDir(prefix: string): string {
    const dir = join(
      tmpdir(),
      `itestagent-b08-manifest-${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    );
    mkdirSync(dir, { recursive: true });
    return dir;
  }

  it('writes parseable JSON and reports byte length', async () => {
    const dir = makeTempDir('write');
    const result = await writeEvidenceManifest(dir, sampleRefs);
    expect(existsSync(result.manifestPath)).toBe(true);
    const onDisk = readFileSync(result.manifestPath);
    expect(result.bytes).toBe(onDisk.byteLength);
    const parsed = JSON.parse(onDisk.toString('utf-8')) as ArtifactRef[];
    expect(parsed).toHaveLength(2);
    expect(parsed[0]?.id).toBe('ss_1');
    rmSync(dir, { recursive: true, force: true });
  });

  it('leaves no temporary residue after consecutive overwrites', async () => {
    const dir = makeTempDir('atomic');
    await writeEvidenceManifest(dir, sampleRefs);
    await writeEvidenceManifest(dir, []);
    const leftovers = readdirSync(dir).filter((name) => name !== 'evidence-manifest.json');
    expect(leftovers).toEqual([]);
    expect(JSON.parse(readFileSync(join(dir, 'evidence-manifest.json'), 'utf-8'))).toEqual([]);
    rmSync(dir, { recursive: true, force: true });
  });

  it('creates the target directory when missing', async () => {
    const root = makeTempDir('mkdir');
    const nested = join(root, 'runs', 'run_x');
    const result = await writeEvidenceManifest(nested, sampleRefs);
    expect(existsSync(result.manifestPath)).toBe(true);
    rmSync(root, { recursive: true, force: true });
  });
});
