import { randomUUID } from 'node:crypto';
import { mkdir, open, readFile, rename, unlink } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { type BaselineRecord, BaselineRecordSchema } from 'itestagent-contracts';

/** All native baseline writers share a per-key exclusive lock and atomic rename. */
export async function writeBaselineAtomic(
  path: string,
  record: BaselineRecord | null,
  expected?: BaselineRecord | null,
  signal?: AbortSignal,
): Promise<boolean> {
  signal?.throwIfAborted();
  await mkdir(dirname(path), { recursive: true });
  const lockPath = `${path}.lock`;
  const lock = await open(lockPath, 'wx', 0o600).catch((error: NodeJS.ErrnoException) => {
    if (error.code === 'EEXIST')
      throw new Error('baseline_busy: another writer holds this baseline');
    throw error;
  });
  const temporary = join(dirname(path), `.baseline-${randomUUID()}.tmp`);
  try {
    signal?.throwIfAborted();
    if (expected !== undefined) {
      let current: BaselineRecord | null;
      try {
        current = BaselineRecordSchema.parse(JSON.parse(await readFile(path, 'utf8')));
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT')
          throw new Error('baseline_invalid: existing record cannot be replaced');
        current = null;
      }
      if (
        JSON.stringify(current) !==
        JSON.stringify(expected === null ? null : BaselineRecordSchema.parse(expected))
      )
        return false;
    }
    if (record === null) {
      signal?.throwIfAborted();
      await unlink(path).catch((error: NodeJS.ErrnoException) => {
        if (error.code !== 'ENOENT') throw error;
      });
    } else {
      const file = await open(temporary, 'wx', 0o600);
      try {
        await file.writeFile(JSON.stringify(record, null, 2));
        await file.sync();
      } finally {
        await file.close();
      }
      signal?.throwIfAborted();
      // Rename is the commit point; cancellation after it cannot undo a successful write.
      await rename(temporary, path);
    }
    return true;
  } finally {
    try {
      await unlink(temporary).catch((error: NodeJS.ErrnoException) => {
        if (error.code !== 'ENOENT') throw error;
      });
    } finally {
      await lock.close();
      await unlink(lockPath);
    }
  }
}
