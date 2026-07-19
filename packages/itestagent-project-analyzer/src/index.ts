/**
 * itestagent-project-analyzer — iOS project analysis and profile generation.
 *
 * Public API:
 *   - generateProjectProfile(backend, root) → ProjectProfile
 *   - computeProjectHash(root) → deterministic sha256 hex string
 *   - saveProfile(profile) → persist to ~/.itestagent/
 *   - saveProfileToProject(profile, projectRoot) → persist to project
 *   - loadProfile(projectHash) → read from ~/.itestagent/
 */

export { generateProjectProfile } from './profile-generator.js';
export { computeProjectHash } from './project-hash.js';
export {
  saveProfile,
  saveProfileToProject,
  loadProfile,
} from './profile-io.js';

// Re-export types for consumers
export type {
  ProjectProfile,
  TargetProfile,
  TestAssetsProfile,
  FeatureCandidate,
} from './profile-io.js';
