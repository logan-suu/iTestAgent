import { createHash } from 'node:crypto';
import { createReadStream, readFileSync } from 'node:fs';

/**
 * SHA-256 measurement helpers for stored artifacts — B07 (promotion guide
 * §11.3 "store artifacts", §6.1 "artifact trio、完整性 hash", L7 evidence
 * line: artifact-integrity.ts — SHA-256 measurement).
 *
 * Every artifact written by the store carries a sha256 in its ArtifactRef so
 * the artifact-index.json trio stays auditable (AGENTS.md §5) and later
 * batches can detect tampering or truncated copies.
 *
 * Streaming note: measureFileSha256 reads in 1 MiB chunks so multi-hundred-MB
 * traces (.trace, xcresult bundles) never materialize in memory.
 */

const HASH_ALGORITHM = 'sha256';
const STREAM_CHUNK_BYTES = 1024 * 1024;

/** Measures the SHA-256 of an in-memory payload. */
export function measureBufferSha256(data: Uint8Array | string): string {
  return createHash(HASH_ALGORITHM).update(data).digest('hex');
}

/** Measures the SHA-256 of a file on disk, streaming in chunks. */
export function measureFileSha256(filePath: string): Promise<string> {
  return new Promise((resolvePromise, rejectPromise) => {
    const hash = createHash(HASH_ALGORITHM);
    const stream = createReadStream(filePath, {
      highWaterMark: STREAM_CHUNK_BYTES,
    });
    stream.on('data', (chunk: string | Buffer) => hash.update(chunk));
    stream.on('end', () => resolvePromise(hash.digest('hex')));
    stream.on('error', rejectPromise);
  });
}

/** Reads a file and measures its SHA-256 (small files only). */
export function measureFileSyncSha256(filePath: string): string {
  return measureBufferSha256(readFileSync(filePath));
}

/**
 * Verifies a file's digest against an expected value.
 * Returns false (never throws) on mismatch or read failure.
 */
export async function verifyFileSha256(filePath: string, expectedSha256: string): Promise<boolean> {
  try {
    return (await measureFileSha256(filePath)) === expectedSha256;
  } catch {
    return false;
  }
}
