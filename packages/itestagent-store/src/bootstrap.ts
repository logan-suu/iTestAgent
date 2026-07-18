import { existsSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

/**
 * Directories created under the store root.
 * AC1: ~/.itestagent/{config,db,projects,sessions,flows,baselines,runs}
 * baselines 按 targetKind 分域（ADR-011）。
 */
export const STORE_DIRS = [
  'config',
  'db',
  'projects',
  'sessions',
  'flows',
  'baselines',
  'runs',
] as const;

const BASELINE_SUBDIRS = ['physical', 'simulator'] as const;

/**
 * Resolve the store root directory.
 *
 * Priority:
 * 1. `ITESTAGENT_HOME` env var
 * 2. `~/.itestagent` (default)
 */
export function resolveStoreRoot(): string {
  if (process.env.ITESTAGENT_HOME) {
    return process.env.ITESTAGENT_HOME;
  }
  return join(homedir(), '.itestagent');
}

/**
 * Initialize the iTestAgent store directory structure.
 *
 * Creates all required directories under the given root.
 * Idempotent — calling multiple times is safe.
 *
 * @param storeRoot - Store root path (defaults to `~/.itestagent`)
 * @returns The store root path
 */
export function initStore(storeRoot?: string): string {
  const root = storeRoot ?? resolveStoreRoot();
  mkdirSync(root, { recursive: true });

  for (const dir of STORE_DIRS) {
    mkdirSync(join(root, dir), { recursive: true });
  }

  // AC1: baselines 按 targetKind 分域
  for (const subdir of BASELINE_SUBDIRS) {
    mkdirSync(join(root, 'baselines', subdir), { recursive: true });
  }

  return root;
}
