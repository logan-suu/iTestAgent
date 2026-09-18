import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, open, realpath } from 'node:fs/promises';
import { isAbsolute, join, resolve } from 'node:path';
import type { MemorySessionProtocol } from './xcode-memory-session.js';

/** File validation is necessary but does not independently prove capture provenance. */
export async function verifyMemoryExport(input: {
  directory: string;
  fileName: string;
  captureStartedAt: number;
  captureEndedAt: number;
  protocol: MemorySessionProtocol;
  signal?: AbortSignal;
}) {
  const aborted = () => {
    if (input.signal?.aborted || input.protocol.cancelled) throw new Error('session.cancelled');
  };
  aborted();
  if (input.protocol.state !== 'exported') throw new Error('session.export_unconfirmed');
  if (
    !Number.isFinite(input.captureStartedAt) ||
    !Number.isFinite(input.captureEndedAt) ||
    input.captureStartedAt <= 0 ||
    input.captureEndedAt < input.captureStartedAt ||
    input.captureEndedAt > Date.now()
  )
    throw new Error('session.capture_interval_invalid');
  if (
    !isAbsolute(input.directory) ||
    resolve(input.directory) !== input.directory ||
    (await realpath(input.directory)) !== input.directory ||
    !/^[a-zA-Z0-9-]{1,100}\.memgraph$/.test(input.fileName)
  )
    throw new Error('session.export_path_invalid');
  const directory = await lstat(input.directory);
  if (
    !directory.isDirectory() ||
    directory.uid !== process.getuid?.() ||
    (directory.mode & 0o077) !== 0
  )
    throw new Error('session.export_path_invalid');
  const path = join(input.directory, input.fileName);
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const before = await handle.stat();
    if (
      !before.isFile() ||
      before.nlink !== 1 ||
      before.uid !== process.getuid?.() ||
      (before.mode & 0o077) !== 0 ||
      before.size < 1 ||
      before.size > 2 ** 31 ||
      before.birthtimeMs < input.captureStartedAt ||
      before.mtimeMs < input.captureStartedAt ||
      Math.floor(before.mtimeMs) > input.captureEndedAt
    )
      throw new Error('session.export_invalid');
    const digest = createHash('sha256');
    const buffer = Buffer.alloc(65536);
    let size = 0;
    while (size < before.size) {
      aborted();
      const { bytesRead } = await handle.read(
        buffer,
        0,
        Math.min(buffer.length, before.size - size),
        size,
      );
      if (!bytesRead) throw new Error('session.export_changed');
      digest.update(buffer.subarray(0, bytesRead));
      size += bytesRead;
    }
    aborted();
    const after = await handle.stat();
    const current = await lstat(path);
    if (
      after.size !== before.size ||
      after.mtimeMs !== before.mtimeMs ||
      after.ctimeMs !== before.ctimeMs ||
      current.isSymbolicLink() ||
      current.dev !== before.dev ||
      current.ino !== before.ino
    )
      throw new Error('session.export_changed');
    return {
      fileName: input.fileName,
      bytes: size,
      sha256: digest.digest('hex'),
      captureStartedAt: input.captureStartedAt,
      captureEndedAt: input.captureEndedAt,
      sensitivity: 'raw-local-only' as const,
    };
  } finally {
    await handle.close();
  }
}
