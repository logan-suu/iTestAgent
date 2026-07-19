import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

/**
 * ProjectProfile output type — mirrors project-profile.schema.json.
 * Defined here to avoid circular workspace dependencies on a schema package.
 */
export interface ProjectProfile {
  schemaVersion: 'itestagent.project-profile.v1';
  projectHash: string;
  app: {
    name?: string;
    bundleId?: string;
    workspace?: string;
    project?: string;
    scheme?: string;
  };
  targets: TargetProfile[];
  testAssets: TestAssetsProfile;
  features: FeatureCandidate[];
  suggestedSmoke: string[];
}

export interface TargetProfile {
  name: string;
  type: 'app' | 'test' | 'extension' | 'framework' | 'watch' | 'widget';
  bundleId?: string;
}

export interface TestAssetsProfile {
  hasXCUITest: boolean;
  hasScheme: boolean;
  testTargets?: string[];
}

export interface FeatureCandidate {
  name: string;
  entry?: string;
  keywords?: string[];
  testability?: 'xcuitest' | 'device_backend' | 'mixed' | 'unknown';
  requiresAccount?: boolean;
  evidence: string[];
  confidence: number;
}

/**
 * Profile storage paths.
 *
 * AC2: Default storage at ~/.itestagent/projects/<project-hash>/project-profile.json
 * AC3: Only write to <project>/.itestagent/project-profile.json after user confirmation.
 */
const ITESTAGENT_HOME = join(homedir(), '.itestagent');

function profileDir(projectHash: string): string {
  return join(ITESTAGENT_HOME, 'projects', projectHash);
}

function profilePath(projectHash: string): string {
  return join(profileDir(projectHash), 'project-profile.json');
}

/**
 * saveProfile — persist a ProjectProfile to the default location.
 *
 * Creates parent directories if needed. Overwrites existing files.
 * AC2: ~/.itestagent/projects/<project-hash>/project-profile.json
 */
export function saveProfile(profile: ProjectProfile): void {
  const dir = profileDir(profile.projectHash);
  mkdirSync(dir, { recursive: true });
  const json = JSON.stringify(profile, null, 2);
  writeFileSync(profilePath(profile.projectHash), json, 'utf-8');
}

/**
 * saveProfileToProject — persist a ProjectProfile to the project directory.
 *
 * AC3: Only call after user confirmation ("固化到项目").
 * Writes to <projectRoot>/.itestagent/project-profile.json
 */
export function saveProfileToProject(profile: ProjectProfile, projectRoot: string): void {
  const dir = join(projectRoot, '.itestagent');
  mkdirSync(dir, { recursive: true });
  const json = JSON.stringify(profile, null, 2);
  writeFileSync(join(dir, 'project-profile.json'), json, 'utf-8');
}

/**
 * loadProfile — read a ProjectProfile from storage by project hash.
 *
 * Returns the parsed ProjectProfile or null if not found.
 */
export function loadProfile(projectHash: string): ProjectProfile | null {
  try {
    const path = profilePath(projectHash);
    const raw = readFileSync(path, 'utf-8');
    return JSON.parse(raw) as ProjectProfile;
  } catch {
    return null;
  }
}
