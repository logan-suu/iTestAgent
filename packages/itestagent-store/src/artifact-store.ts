import { copyFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, extname, join, relative } from 'node:path';
import type {
  ArtifactIndex,
  ArtifactInput,
  ArtifactRef,
  ArtifactStore,
} from 'itestagent-contracts';

type InternalArtifactRef = ArtifactRef & { _id: string };

function extensionForType(type: ArtifactInput['type']): string {
  switch (type) {
    case 'screenshot':
      return '.png';
    case 'video':
      return '.mp4';
    case 'uitree':
      return '.json';
    case 'log':
    case 'crashlog':
    case 'text':
      return '.log';
    case 'trace':
      return '.trace';
    case 'xcresult':
      return '.xcresult';
    case 'json':
      return '.json';
    default:
      return '.bin';
  }
}

function mimeForType(type: ArtifactInput['type']): string {
  switch (type) {
    case 'screenshot':
      return 'image/png';
    case 'video':
      return 'video/mp4';
    case 'uitree':
    case 'json':
      return 'application/json';
    default:
      return 'application/octet-stream';
  }
}

/**
 * Create an ArtifactStore backed by the filesystem.
 *
 * Phase 1: in-memory index only — not persisted across restarts.
 *
 * @param artifactsRoot - Path to the artifacts directory.
 * @returns ArtifactStore implementation
 */
export function createArtifactStore(artifactsRoot: string): ArtifactStore {
  mkdirSync(artifactsRoot, { recursive: true });
  const artifactIndex = new Map<string, InternalArtifactRef>();

  return {
    async put(input: ArtifactInput): Promise<ArtifactRef> {
      const id = Bun.randomUUIDv7();
      const ext = input.path
        ? extname(input.path) || extensionForType(input.type)
        : extensionForType(input.type);
      const mimeType = input.mimeType ?? mimeForType(input.type);

      let destPath: string;

      if (input.data) {
        destPath = join(artifactsRoot, `${id}${ext}`);
        mkdirSync(dirname(destPath), { recursive: true });
        writeFileSync(destPath, input.data);
      } else if (input.path && existsSync(input.path)) {
        destPath = join(artifactsRoot, `${id}${ext}`);
        mkdirSync(dirname(destPath), { recursive: true });
        copyFileSync(input.path, destPath);
      } else {
        destPath = input.path ?? join(artifactsRoot, `${id}${ext}`);
      }

      const ref: ArtifactRef = {
        id,
        type: input.type,
        path: relative(artifactsRoot, destPath),
        mimeType,
        relatedStep: input.relatedStep,
        redactionStatus: 'raw-local-only',
      };

      artifactIndex.set(id, { ...ref, _id: id });
      return ref;
    },

    async get(id: string): Promise<ArtifactRef | null> {
      const entry = artifactIndex.get(id);
      if (!entry) return null;
      const { _id, ...ref } = entry;
      return ref;
    },

    async search(query: string): Promise<ArtifactRef[]> {
      const lower = query.toLowerCase();
      const results: ArtifactRef[] = [];

      for (const entry of artifactIndex.values()) {
        if (
          entry.type.toLowerCase().includes(lower) ||
          entry.relatedStep?.toLowerCase().includes(lower)
        ) {
          const { _id, ...ref } = entry;
          results.push(ref);
        }
      }

      return results;
    },
  };
}

// ─── Persistent ArtifactStore ───────────────────────────────────

/**
 * Create a persistent ArtifactStore that writes artifact-index.json after each put.
 *
 * Task 4.1: Evidence artifacts must be persisted to disk and indexed
 * via artifact-index.json per the data flow specification (§12).
 *
 * In addition to the in-memory index, this writes artifact-index.json
 * to the artifacts root directory after every put() call.
 *
 * @param artifactsRoot - Path to the artifacts directory (e.g. ~/.itestagent/runs/<runId>/artifacts/).
 * @param runId - The run ID for the artifact-index.json metadata.
 * @returns ArtifactStore implementation with persistence.
 */
export function createPersistentArtifactStore(artifactsRoot: string, runId: string): ArtifactStore {
  mkdirSync(artifactsRoot, { recursive: true });

  const base = createArtifactStore(artifactsRoot);
  const artifactIndex = new Map<string, InternalArtifactRef>();

  /**
   * Write the current artifact-index.json to disk.
   */
  function flushIndex(): void {
    const index: ArtifactIndex = {
      schemaVersion: '1.0',
      runId,
      artifacts: [],
    };

    for (const entry of artifactIndex.values()) {
      const { _id, ...ref } = entry;
      index.artifacts.push({
        id: ref.id,
        type: ref.type,
        path: ref.path,
        mimeType: ref.mimeType,
        sizeBytes: ref.sizeBytes,
        sha256: ref.sha256,
        relatedStep: ref.relatedStep,
        backend: ref.backend,
        redactionStatus: ref.redactionStatus,
      });
    }

    const indexPath = join(artifactsRoot, '..', 'artifact-index.json');
    writeFileSync(indexPath, JSON.stringify(index, null, 2), 'utf-8');
  }

  return {
    async put(input: ArtifactInput): Promise<ArtifactRef> {
      const ref = await base.put(input);
      artifactIndex.set(ref.id, { ...ref, _id: ref.id });
      flushIndex();
      return ref;
    },

    async get(id: string): Promise<ArtifactRef | null> {
      const entry = artifactIndex.get(id);
      if (entry) {
        const { _id, ...ref } = entry;
        return ref;
      }
      return base.get(id);
    },

    async search(query: string): Promise<ArtifactRef[]> {
      const lower = query.toLowerCase();
      const results: ArtifactRef[] = [];

      for (const entry of artifactIndex.values()) {
        if (
          entry.type.toLowerCase().includes(lower) ||
          entry.relatedStep?.toLowerCase().includes(lower)
        ) {
          const { _id, ...ref } = entry;
          results.push(ref);
        }
      }

      return results;
    },
  };
}
