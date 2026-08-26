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
 * fabricates entries — a failed capture is simply absent from the list.
 */
import { mkdirSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ArtifactRef, DeviceBackend } from 'itestagent-contracts';

export const EVIDENCE_MANIFEST_FILENAME = 'evidence-manifest.json';

export interface EvidenceManifestWriteResult {
  /** Absolute path of the written manifest. */
  manifestPath: string;
  /** Byte length of the serialized document. */
  bytes: number;
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
  const evidence: ArtifactRef[] = [];
  try {
    const ss = await backend.screenshot({ deviceId }, signal);
    evidence.push(ss);
  } catch {
    // Screenshot failure is non-fatal for the step
  }
  try {
    await backend.getUiTree({ deviceId }, signal);
    // Wrap UiTreeSnapshot as an ArtifactRef-like entry
    evidence.push({
      id: `uiTree_step${stepIndex}_${Date.now()}`,
      type: 'uitree',
      path: '',
      redactionStatus: 'safe' as const,
    });
  } catch {
    // UiTree failure is non-fatal
  }
  return evidence;
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
