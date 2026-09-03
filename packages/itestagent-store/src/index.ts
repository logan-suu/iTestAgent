import { Database } from 'bun:sqlite';
import { createDb } from './db.js';
import { createStoreDriver } from './store-driver.js';

export { initStore, resolveStoreRoot, STORE_DIRS } from './bootstrap.js';
export { createDb, type DbClient } from './db.js';
export { createStoreDriver } from './store-driver.js';
export { createArtifactStore, createPersistentArtifactStore } from './artifact-store.js';
export {
  measureBufferSha256,
  measureFileSha256,
  measureFileSyncSha256,
  verifyFileSha256,
} from './artifact-integrity.js';
export {
  ARTIFACT_INDEX_FILENAME,
  writeArtifactIndex,
  type ArtifactIndexWriteResult,
} from './artifact-index-writer.js';
export { createBaselineStore } from './baseline-store.js';
export type { FileSystem } from './baseline-store.js';
export { createRunStore, createDefaultRunStore } from './run-store.js';
export type { RunStore } from './run-store.js';
export { RunWriter } from './run-writer.js';
export type {
  MeasuredPath,
  RunWriterArtifactInput,
  RunWriterCommitInput,
  RunWriterHooks,
} from './run-writer.js';
export { measureRunArtifactPath } from './run-writer.js';
export * as schema from './schema.js';

/**
 * Create a unified store core with a single shared SQLite connection.
 *
 * Both createDb() and createStoreDriver() accept an optional existing
 * Database connection. This factory creates ONE connection and passes
 * it to both, preventing SQLITE_BUSY when transaction() (which holds
 * BEGIN IMMEDIATE) is used alongside Drizzle ORM calls.
 *
 * @param dbPath - Path to the SQLite database file
 * @returns Object with shared db (Drizzle ORM), driver (StoreDriver), and underlying sqlite connection
 */
export function createStoreCore(dbPath: string) {
  const sqlite = new Database(dbPath);
  const db = createDb(dbPath, sqlite);
  const driver = createStoreDriver(dbPath, sqlite);
  return { db, driver, sqlite };
}
