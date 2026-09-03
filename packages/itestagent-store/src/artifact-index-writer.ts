import { existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { type ArtifactIndex, parseArtifactIndex } from 'itestagent-contracts';
import { measureBufferSha256 } from './artifact-integrity.js';

/**
 * Atomic artifact-index.json writer — B07 (promotion guide §11.3
 * "store artifacts", §6.1 "atomic writer", L7 evidence line:
 * artifact-index-writer.ts — SHA-256 write; §10 "canonical writer records
 * bytes+SHA-256").
 *
 * Contract:
 *   - the incoming index is validated against the published contract BEFORE
 *     any bytes hit the disk (fail-closed: a malformed index never replaces a
 *     good one);
 *   - serialization is canonical (2-space JSON + trailing newline), so the
 *     same index always hashes to the same digest;
 *   - the payload is written to a temp file in the SAME directory and then
 *     renamed onto the target — readers never observe a torn document;
 *   - the result reports byte count and digest of what was written.
 */

export const ARTIFACT_INDEX_FILENAME = 'artifact-index.json';

export interface ArtifactIndexWriteResult {
  /** Absolute path of the written artifact-index.json. */
  indexPath: string;
  /** Byte length of the canonical document. */
  bytes: number;
  /** SHA-256 of the exact bytes on disk. */
  sha256: string;
}

function serializeCanonical(index: ArtifactIndex): string {
  return `${JSON.stringify(index, null, 2)}\n`;
}

/**
 * Atomically writes artifact-index.json under {@link artifactsRoot}.
 * Throws when the index does not satisfy the published contract.
 */
export function writeArtifactIndex(
  artifactsRoot: string,
  index: unknown,
): ArtifactIndexWriteResult {
  // Fail closed: validate through the published parser before writing.
  parseArtifactIndex(index as unknown);

  mkdirSync(artifactsRoot, { recursive: true });
  const indexPath = join(artifactsRoot, ARTIFACT_INDEX_FILENAME);
  const parsed = parseArtifactIndex(index as unknown);
  const payload = Buffer.from(serializeCanonical(parsed), 'utf-8');
  const tempPath = `${indexPath}.tmp-${process.pid}-${Date.now()}`;

  let bytesWritten = 0;
  try {
    writeFileSync(tempPath, payload);
    bytesWritten = statSync(tempPath).size;
    renameSync(tempPath, indexPath);
  } catch (error) {
    if (existsSync(tempPath)) {
      try {
        renameSync(tempPath, `${tempPath}.orphan`);
      } catch {
        // Best-effort cleanup; original error below takes precedence.
      }
    }
    throw error;
  }

  return {
    indexPath,
    bytes: bytesWritten,
    sha256: measureBufferSha256(readFileSync(indexPath)),
  };
}
