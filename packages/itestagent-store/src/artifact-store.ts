import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { ArtifactInput, ArtifactRef, ArtifactStore } from 'itestagent-contracts';

type InternalArtifactRef = ArtifactRef & { _id: string };

/**
 * Generate a unique artifact file path.
 */
function artifactPath(artifactsRoot: string, id: string, ext: string): string {
  return join(artifactsRoot, `${id}${ext}`);
}

/**
 * Determine file extension from artifact type.
 */
function extensionForType(type: ArtifactInput['type']): string {
  switch (type) {
    case 'screenshot':
    case 'video':
    case 'uitree':
      return '.png'; // fallback, real ext from mimeType
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

/**
 * Infer mimeType from artifact type.
 */
function mimeForType(type: ArtifactInput['type']): string {
  switch (type) {
    case 'screenshot':
    case 'video':
    case 'uitree':
      return 'image/png';
    case 'json':
      return 'application/json';
    default:
      return 'application/octet-stream';
  }
}

/**
 * Create an ArtifactStore backed by the filesystem.
 *
 * @param artifactsRoot - Path to the artifacts directory
 * @returns ArtifactStore implementation
 */
export function createArtifactStore(artifactsRoot: string): ArtifactStore {
  mkdirSync(artifactsRoot, { recursive: true });
  const artifactIndex = new Map<string, InternalArtifactRef>();

  return {
    async put(input: ArtifactInput): Promise<ArtifactRef> {
      const id = randomUUID();
      const ext = input.path
        ? input.path.slice(input.path.lastIndexOf('.'))
        : extensionForType(input.type);

      const mimeType = input.mimeType ?? mimeForType(input.type);
      const destPath = input.path ?? artifactPath(artifactsRoot, id, ext);

      if (input.data) {
        mkdirSync(dirname(destPath), { recursive: true });
        writeFileSync(destPath, input.data);
      } else if (input.path && existsSync(input.path)) {
        // Copy file from source path to artifacts directory if needed
        const dest = artifactPath(artifactsRoot, id, ext);
        mkdirSync(dirname(dest), { recursive: true });
        writeFileSync(dest, readFileSync(input.path));
      }

      const ref: ArtifactRef = {
        id,
        type: input.type,
        path: destPath,
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
