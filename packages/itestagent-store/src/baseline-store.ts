import { access, mkdir, readFile, readdir, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import {
  type BaselineListFilter,
  type BaselineRecord,
  BaselineRecordSchema,
  type BaselineStore,
  parseBaselineKey,
} from 'itestagent-contracts';

import { resolveStoreRoot } from './bootstrap.js';

// ─── Injectable FileSystem ─────────────────────────────────────

/**
 * File system operations injectable for testability.
 * Default implementation uses node:fs/promises.
 */
export interface FileSystem {
  readFile(path: string, encoding: 'utf-8'): Promise<string>;
  writeFile(path: string, data: string, encoding: 'utf-8'): Promise<void>;
  mkdir(path: string, options?: { recursive: boolean }): Promise<string | undefined>;
  exists(path: string): Promise<boolean>;
  readdir(path: string): Promise<string[]>;
  unlink(path: string): Promise<void>;
}

const nodeFs: FileSystem = {
  readFile: (path, encoding) => readFile(path, encoding),
  writeFile: (path, data, encoding) => writeFile(path, data, encoding),
  mkdir: (path, opts) => mkdir(path, opts),
  exists: (path) =>
    access(path).then(
      () => true,
      () => false,
    ),
  readdir: (path) => readdir(path),
  unlink: (path) => unlink(path),
};

// ─── Helpers ────────────────────────────────────────────────────

/**
 * ADR-011 cross-domain guard.
 * Validates that the targetKind in the key matches the targetKind in the record.
 * Throws if they differ — physical and simulator baselines are strictly domain-isolated.
 */
function assertTargetKindMatch(key: string, record: BaselineRecord): void {
  const parsed = parseBaselineKey(key);
  if (!parsed) {
    throw new Error(`Invalid baseline key format: "${key}"`);
  }
  if (parsed.targetKind !== record.targetKind) {
    throw new Error('Cross-domain baseline comparison rejected per ADR-011');
  }
}

/** Resolve the absolute path to a baseline JSON file. */
function resolvePath(storeRoot: string, targetKind: string, key: string): string {
  return join(storeRoot, 'baselines', targetKind, `${key}.json`);
}

/** Resolve the directory for a targetKind subdirectory of baselines. */
function resolveDir(storeRoot: string, targetKind: string): string {
  return join(storeRoot, 'baselines', targetKind);
}

// ─── Factory ────────────────────────────────────────────────────

/**
 * Create a file-system backed BaselineStore.
 *
 * Stores JSON files at `{storeRoot}/baselines/{targetKind}/{key}.json`.
 * Cross-domain guard (ADR-011): read/write operations validate that the
 * targetKind field matches the storage subdirectory.
 *
 * @param storeRoot - Store root path (defaults to `~/.itestagent` via resolveStoreRoot())
 * @param fileSystem - Injectable file system for testability (defaults to node:fs/promises)
 * @returns BaselineStore implementation
 */
export function createBaselineStore(storeRoot?: string, fileSystem?: FileSystem): BaselineStore {
  const root = storeRoot ?? resolveStoreRoot();
  const fs = fileSystem ?? nodeFs;

  return {
    async get(key: string): Promise<BaselineRecord | null> {
      const parsed = parseBaselineKey(key);
      if (!parsed) return null;

      const filePath = resolvePath(root, parsed.targetKind, key);

      let raw: string;
      try {
        raw = await fs.readFile(filePath, 'utf-8');
      } catch {
        return null;
      }

      let record: BaselineRecord;
      try {
        const json = JSON.parse(raw);
        record = BaselineRecordSchema.parse(json);
      } catch {
        return null;
      }

      // Cross-domain guard: record.targetKind must match key's targetKind
      assertTargetKindMatch(key, record);
      return record;
    },

    async save(record: BaselineRecord): Promise<void> {
      // Cross-domain guard: record.targetKind must match key-parsed targetKind
      assertTargetKindMatch(record.key, record);

      const dir = resolveDir(root, record.targetKind);
      const filePath = resolvePath(root, record.targetKind, record.key);

      await fs.mkdir(dir, { recursive: true });
      await fs.writeFile(filePath, JSON.stringify(record, null, 2), 'utf-8');
    },

    async list(filter?: BaselineListFilter): Promise<BaselineRecord[]> {
      const targetKinds: string[] = filter?.targetKind
        ? [filter.targetKind]
        : ['physical', 'simulator'];

      const results: BaselineRecord[] = [];

      for (const kind of targetKinds) {
        const dir = resolveDir(root, kind);

        let files: string[];
        try {
          files = await fs.readdir(dir);
        } catch {
          // Directory doesn't exist yet — skip
          continue;
        }

        for (const file of files) {
          if (!file.endsWith('.json')) continue;

          const filePath = join(dir, file);
          let record: BaselineRecord;
          try {
            const raw = await fs.readFile(filePath, 'utf-8');
            const json = JSON.parse(raw);
            record = BaselineRecordSchema.parse(json);
          } catch {
            // Corrupted or invalid baseline — skip
            continue;
          }

          // Cross-domain guard: record.targetKind must match the directory
          if (record.targetKind !== kind) {
            // Corrupted data in wrong directory — skip with skip (don't throw
            // during listing to avoid breaking the entire list for one bad file)
            continue;
          }

          // Apply optional filters
          if (filter?.projectId && !record.key.startsWith(`${filter.projectId}|`)) {
            continue;
          }
          if (filter?.scenario) {
            const keyParsed = parseBaselineKey(record.key);
            if (!keyParsed || keyParsed.scenario !== filter.scenario) {
              continue;
            }
          }

          results.push(record);
        }
      }

      // Sort by updatedAt descending (most recent first)
      results.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
      return results;
    },

    async delete(key: string): Promise<void> {
      const parsed = parseBaselineKey(key);
      if (!parsed) return; // Invalid key → no-op

      const filePath = resolvePath(root, parsed.targetKind, key);

      try {
        await fs.unlink(filePath);
      } catch {
        // File doesn't exist or can't be removed → no-op
      }
    },
  };
}
