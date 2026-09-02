/**
 * Replay evidence writer — B08 module split (promotion guide §11.3 "Flow
 * replay/redaction", §6.1 "artifact trio、完整性 hash").
 *
 * collectStepEvidence moved verbatim from the former replay.ts monolith.
 * writeEvidenceManifest is the new disk-persistence half: it serializes the
 * collected refs to evidence-manifest.json atomically (temp file + rename)
 * so a crash mid-write never leaves a torn manifest beside a passing run.
 *
 * R5: evidence capture failure is never fatal for the step and never
 * fabricates entries; artifacts remain absent while outcomes record failure.
 */
import { existsSync, mkdirSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { mkdir, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { ArtifactRef, DeviceBackend, UiTreeSnapshot } from 'itestagent-contracts';
import type { ReplayEvidenceOutcome } from './replay-result.js';

export const EVIDENCE_MANIFEST_FILENAME = 'evidence-manifest.json';

export interface EvidenceManifestWriteResult {
  /** Absolute path of the written manifest. */
  manifestPath: string;
  /** Byte length of the serialized document. */
  bytes: number;
}

export interface EvidenceCollectionResult {
  artifacts: ArtifactRef[];
  outcomes: ReplayEvidenceOutcome[];
}

export interface EvidenceCorrelation {
  evidenceDirectory?: string;
  stepId: string;
  caseId?: string;
}

function failedOutcome(type: ArtifactRef['type'], error: unknown): ReplayEvidenceOutcome {
  return {
    type,
    status: 'failed',
    error: error instanceof Error ? error.message : String(error),
  };
}

/** Reject empty or nonexistent backend artifacts and enforce the raw-local-only boundary. */
export function validateRawArtifact(
  artifact: ArtifactRef,
  correlation: EvidenceCorrelation,
): ArtifactRef {
  if (!artifact.path) {
    throw new Error(`${artifact.type} capture returned an empty artifact path`);
  }
  if (!existsSync(artifact.path)) {
    throw new Error(`${artifact.type} capture path does not exist: ${artifact.path}`);
  }
  return {
    ...artifact,
    relatedStep: correlation.stepId,
    relatedCase: correlation.caseId,
    redactionStatus: 'raw-local-only',
  };
}

/** Persist a raw UI tree locally so its ArtifactRef always points to real bytes. */
export async function persistRawUiTree(
  snapshot: UiTreeSnapshot,
  correlation: EvidenceCorrelation,
): Promise<ArtifactRef> {
  if (!correlation.evidenceDirectory) {
    throw new Error('UI tree capture requires an evidenceDirectory');
  }
  if (!snapshot.raw) {
    throw new Error('UI tree capture returned empty content');
  }
  await mkdir(correlation.evidenceDirectory, { recursive: true });
  const safeStepId = correlation.stepId.replace(/[^a-zA-Z0-9_-]/g, '_');
  const path = join(correlation.evidenceDirectory, `${safeStepId}-uitree.xml`);
  await writeFile(path, snapshot.raw, 'utf-8');
  const metadata = await stat(path);
  return {
    id: `${safeStepId}-uitree`,
    type: 'uitree',
    path,
    mimeType: 'application/xml',
    sizeBytes: metadata.size,
    relatedStep: correlation.stepId,
    relatedCase: correlation.caseId,
    redactionStatus: 'raw-local-only',
  };
}

/** Collect checkpoint evidence while preserving every capture outcome explicitly. */
export async function collectStepEvidenceResult(
  backend: DeviceBackend,
  deviceId: string,
  correlation: EvidenceCorrelation,
  signal?: AbortSignal,
): Promise<EvidenceCollectionResult> {
  const artifacts: ArtifactRef[] = [];
  const outcomes: ReplayEvidenceOutcome[] = [];

  try {
    const ref = validateRawArtifact(await backend.screenshot({ deviceId }, signal), correlation);
    artifacts.push(ref);
    outcomes.push({ type: 'screenshot', status: 'success', artifact: ref });
  } catch (error) {
    outcomes.push(failedOutcome('screenshot', error));
  }

  try {
    const ref = await persistRawUiTree(await backend.getUiTree({ deviceId }, signal), correlation);
    artifacts.push(ref);
    outcomes.push({ type: 'uitree', status: 'success', artifact: ref });
  } catch (error) {
    outcomes.push(failedOutcome('uitree', error));
  }

  return { artifacts, outcomes };
}

/**
 * Collect post-step evidence: screenshot + page source.
 * Errors are caught — evidence collection failure never fails the step.
 */
export async function collectStepEvidence(
  backend: DeviceBackend,
  deviceId: string,
  stepIndex: number,
  signal?: AbortSignal,
): Promise<ArtifactRef[]> {
  const result = await collectStepEvidenceResult(
    backend,
    deviceId,
    { stepId: `step-${stepIndex + 1}` },
    signal,
  );
  return result.artifacts;
}

/**
 * Atomically writes the evidence manifest for a replay session.
 * Creates the directory when missing; consecutive calls overwrite in place.
 */
export function writeEvidenceManifest(
  evidenceDir: string,
  refs: readonly ArtifactRef[],
): EvidenceManifestWriteResult {
  mkdirSync(evidenceDir, { recursive: true });
  const manifestPath = join(evidenceDir, EVIDENCE_MANIFEST_FILENAME);
  const payload = Buffer.from(`${JSON.stringify(refs, null, 2)}\n`, 'utf-8');
  const tempPath = `${manifestPath}.tmp-${process.pid}-${Date.now()}`;

  try {
    writeFileSync(tempPath, payload);
    renameSync(tempPath, manifestPath);
  } catch (error) {
    // Best-effort temp cleanup; the original error takes precedence.
    try {
      renameSync(tempPath, `${tempPath}.orphan`);
    } catch {
      // ignore
    }
    throw error;
  }

  return { manifestPath, bytes: statSync(manifestPath).size };
}
