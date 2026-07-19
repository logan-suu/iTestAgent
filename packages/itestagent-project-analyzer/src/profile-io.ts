import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { z } from 'zod';

// ─── Zod schemas — mirrors project-profile.schema.json ────────────
//
// G2 compliance: All I/O goes through Zod validation so corrupted or
// version-mismatched disk files never silently enter the runtime.

const TargetProfileSchema = z.object({
  name: z.string(),
  type: z.enum(['app', 'test', 'extension', 'framework', 'watch', 'widget']),
  bundleId: z.string().optional(),
});

const TestAssetsProfileSchema = z.object({
  hasXCUITest: z.boolean(),
  hasScheme: z.boolean(),
  testTargets: z.array(z.string()).optional(),
});

const CandidateLinkSchema = z.object({
  name: z.string(),
  entry: z.string().optional(),
  keywords: z.array(z.string()).optional(),
  testability: z.enum(['xcuitest', 'device_backend', 'mixed', 'unknown']).optional(),
  requiresAccount: z.boolean().optional(),
  evidence: z.array(z.string()).min(1),
  confidence: z.number().min(0).max(1),
  /** Whether the user has confirmed this candidate in the TUI (AC3: only confirmed links enter TestPlan/Flow). Default false. */
  confirmed: z.boolean().default(false),
  /** User-controlled display ordering; lower = higher priority. Default 0 (insertion order). */
  displayOrder: z.number().int().nonnegative().default(0),
});

const ProjectProfileSchema = z.object({
  schemaVersion: z.literal('itestagent.project-profile.v1'),
  projectHash: z.string().regex(/^[a-f0-9]{64}$/),
  app: z.object({
    name: z.string().optional(),
    bundleId: z.string().optional(),
    workspace: z.string().optional(),
    project: z.string().optional(),
    scheme: z.string().optional(),
  }),
  targets: z.array(TargetProfileSchema),
  testAssets: TestAssetsProfileSchema,
  features: z.array(CandidateLinkSchema),
  suggestedSmoke: z.array(z.string()),
});

// ─── TypeScript types (derived from Zod for single source of truth) ──

export type ProjectProfile = z.infer<typeof ProjectProfileSchema>;
export type TargetProfile = z.infer<typeof TargetProfileSchema>;
export type TestAssetsProfile = z.infer<typeof TestAssetsProfileSchema>;
export type CandidateLink = z.infer<typeof CandidateLinkSchema>;

/** @deprecated Use CandidateLink instead. Kept for backward compat with existing callers. */
export type FeatureCandidate = CandidateLink;

// ─── Storage paths ──────────────────────────────────────────────────

/**
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

// ─── I/O functions ──────────────────────────────────────────────────

/**
 * saveProfile — persist a ProjectProfile to the default location.
 *
 * G2: Validates against Zod schema before writing. Throws ZodError on invalid input.
 * AC2: ~/.itestagent/projects/<project-hash>/project-profile.json
 */
export function saveProfile(profile: ProjectProfile): void {
  // G2: Validate before writing — defensive layer against future refactors
  const validated = ProjectProfileSchema.parse(profile);
  const dir = profileDir(validated.projectHash);
  mkdirSync(dir, { recursive: true });
  const json = JSON.stringify(validated, null, 2);
  writeFileSync(profilePath(validated.projectHash), json, 'utf-8');
}

/**
 * saveProfileToProject — persist a ProjectProfile to the project directory.
 *
 * G2: Validates against Zod schema before writing. Throws ZodError on invalid input.
 * AC3: Only call after user confirmation ("固化到项目").
 * Writes to <projectRoot>/.itestagent/project-profile.json
 */
export function saveProfileToProject(profile: ProjectProfile, projectRoot: string): void {
  // G2: Validate before writing
  const validated = ProjectProfileSchema.parse(profile);
  const dir = join(projectRoot, '.itestagent');
  mkdirSync(dir, { recursive: true });
  const json = JSON.stringify(validated, null, 2);
  writeFileSync(join(dir, 'project-profile.json'), json, 'utf-8');
}

/**
 * loadProfile — read and validate a ProjectProfile from storage.
 *
 * G2: Parsed JSON is validated against Zod schema. Returns null if the
 * file is missing, unreadable, or contains structurally invalid data
 * (corrupted / version mismatch / schema drift).
 */
export function loadProfile(projectHash: string): ProjectProfile | null {
  try {
    const path = profilePath(projectHash);
    const raw = readFileSync(path, 'utf-8');
    const parsed = JSON.parse(raw);
    // G2: Validate on read — corrupted or version-mismatched data never enters runtime
    return ProjectProfileSchema.parse(parsed);
  } catch {
    return null;
  }
}
