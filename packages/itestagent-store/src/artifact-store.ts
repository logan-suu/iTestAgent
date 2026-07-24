import { copyFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, extname, join, relative } from 'node:path';
import type { ArtifactInput, ArtifactRef, ArtifactStore } from 'itestagent-contracts';

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
