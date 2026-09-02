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
import { afterAll, describe, expect, it } from 'bun:test';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type {
  ArtifactRef,
  DeviceBackend,
  DeviceTarget,
  ScreenshotInput,
  UiTreeSnapshot,
} from 'itestagent-contracts';
import {
  collectStepEvidence,
  collectStepEvidenceResult,
  validateRawArtifact,
  writeEvidenceManifest,
} from '../src/replay-evidence-writer.js';

const evidenceDirectory = join(tmpdir(), `itestagent-replay-evidence-${Date.now()}`);

function makeBackend(opts: {
  screenshotFails?: boolean;
  uiTreeFails?: boolean;
  artifactDirectory?: string;
}): DeviceBackend {
  return {
    name: 'b08-evidence-fake',
    async screenshot(_i: ScreenshotInput): Promise<ArtifactRef> {
      if (opts.screenshotFails) throw new Error('no screenshot configured');
      const artifactDirectory = opts.artifactDirectory ?? evidenceDirectory;
      mkdirSync(artifactDirectory, { recursive: true });
      const path = join(artifactDirectory, `ss-${Date.now()}-${Math.random()}.png`);
      writeFileSync(path, 'png-bytes');
      return {
        id: `ss_${Date.now()}`,
        type: 'screenshot',
        path,
        redactionStatus: 'safe',
      };
    },
    async getUiTree(_i: DeviceTarget): Promise<UiTreeSnapshot> {
      if (opts.uiTreeFails) throw new Error('no uiTree configured');
      return { raw: '<xml/>' } as UiTreeSnapshot;
    },
  } as unknown as DeviceBackend;
}

describe('collectStepEvidence', () => {
  afterAll(() => rmSync(evidenceDirectory, { recursive: true, force: true }));

  it('collects real screenshot and UI tree refs when both succeed', async () => {
    const backend = makeBackend({});
    const result = await collectStepEvidenceResult(backend, 'dev-b08', {
      evidenceDirectory,
      stepId: 'step-1',
      caseId: 'case-a',
    });
    expect(result.artifacts).toHaveLength(2);
    expect(result.outcomes.map((outcome) => outcome.status)).toEqual(['success', 'success']);
    expect(result.artifacts[1]?.path).not.toBe('');
    expect(result.artifacts[1]?.redactionStatus).toBe('raw-local-only');
    expect(result.artifacts[1]?.relatedCase).toBe('case-a');
    expect((statSync(evidenceDirectory).mode & 0o777).toString(8)).toBe('700');
    for (const artifact of result.artifacts) {
      expect((statSync(artifact.path).mode & 0o777).toString(8)).toBe('600');
      expect(artifact.sizeBytes).toBeGreaterThan(0);
    }
  });

  it('keeps the public wrapper and persists both evidence types', async () => {
    const wrapperDirectory = join(evidenceDirectory, 'wrapper');
    const artifacts = await collectStepEvidence(
      makeBackend({ artifactDirectory: wrapperDirectory }),
      'dev-b08',
      0,
      undefined,
      wrapperDirectory,
    );
    expect(artifacts.map((artifact) => artifact.type)).toEqual(['screenshot', 'uitree']);
    expect(artifacts.every((artifact) => artifact.path.startsWith(wrapperDirectory))).toBe(true);
  });

  it('reports screenshot failure explicitly while retaining UI tree evidence', async () => {
    const backend = makeBackend({ screenshotFails: true });
    const result = await collectStepEvidenceResult(backend, 'dev-b08', {
      evidenceDirectory,
      stepId: 'step-2',
    });
    expect(result.artifacts).toHaveLength(1);
    expect(result.outcomes[0]?.status).toBe('failed');
    expect(result.outcomes[1]?.status).toBe('success');
  });

  it('reports UI tree failure explicitly while retaining screenshot evidence', async () => {
    const backend = makeBackend({ uiTreeFails: true });
    const result = await collectStepEvidenceResult(backend, 'dev-b08', {
      evidenceDirectory,
      stepId: 'step-3',
    });
    expect(result.artifacts).toHaveLength(1);
    expect(result.outcomes[0]?.status).toBe('success');
    expect(result.outcomes[1]?.status).toBe('failed');
  });

  it('returns no artifacts and two failed outcomes when every capture fails', async () => {
    const backend = makeBackend({ screenshotFails: true, uiTreeFails: true });
    const result = await collectStepEvidenceResult(backend, 'dev-b08', {
      evidenceDirectory,
      stepId: 'step-4',
    });
    expect(result.artifacts).toEqual([]);
    expect(result.outcomes.map((outcome) => outcome.status)).toEqual(['failed', 'failed']);
  });

  it('rejects directories and empty files as fabricated artifacts', () => {
    mkdirSync(evidenceDirectory, { recursive: true });
    expect(() =>
      validateRawArtifact(
        { id: 'dir', type: 'screenshot', path: evidenceDirectory, redactionStatus: 'safe' },
        { stepId: 'step-dir' },
      ),
    ).toThrow('not a regular file');

    const emptyPath = join(evidenceDirectory, 'empty.png');
    writeFileSync(emptyPath, '');
    expect(() =>
      validateRawArtifact(
        { id: 'empty', type: 'screenshot', path: emptyPath, redactionStatus: 'safe' },
        { stepId: 'step-empty' },
      ),
    ).toThrow('empty file');
  });

  it('rejects artifacts outside the current run directory and symbolic links', () => {
    mkdirSync(evidenceDirectory, { recursive: true });
    const outsidePath = join(tmpdir(), `itestagent-outside-${Date.now()}.png`);
    writeFileSync(outsidePath, 'outside');
    expect(() =>
      validateRawArtifact(
        { id: 'outside', type: 'screenshot', path: outsidePath, redactionStatus: 'safe' },
        { evidenceDirectory, stepId: 'step-outside' },
      ),
    ).toThrow('outside the current run evidence directory');

    const targetPath = join(evidenceDirectory, 'target.png');
    const linkPath = join(evidenceDirectory, 'link.png');
    writeFileSync(targetPath, 'target');
    symlinkSync(targetPath, linkPath);
    expect(() =>
      validateRawArtifact(
        { id: 'link', type: 'screenshot', path: linkPath, redactionStatus: 'safe' },
        { evidenceDirectory, stepId: 'step-link' },
      ),
    ).toThrow('must not be a symbolic link');

    rmSync(outsidePath, { force: true });
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
    expect((statSync(dir).mode & 0o777).toString(8)).toBe('700');
    expect((statSync(result.manifestPath).mode & 0o777).toString(8)).toBe('600');
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
