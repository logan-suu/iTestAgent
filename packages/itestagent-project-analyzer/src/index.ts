/**
 * itestagent-project-analyzer — iOS project analysis and profile generation.
 *
 * Public API:
 *   - generateProjectProfile(backend, root) → ProjectProfile
 *   - analyzeProject(backend, root) → ProjectAnalysisResult
 *   - XCODEPROJ_TIER1_ANALYSIS → tier-1 capability metadata
 *   - ProjectAnalysisMetadata / ProjectAnalysisResult / ProjectAnalysisTier
 *   - computeProjectHash(root) → deterministic sha256 hex string
 *   - saveProfile(profile) → persist to ~/.itestagent/
 *   - saveProfileToProject(profile, projectRoot) → persist to project
 *   - loadProfile(projectHash) → read from ~/.itestagent/
 */

export { generateProjectProfile } from './profile-generator.js';
export { analyzeProject, XCODEPROJ_TIER1_ANALYSIS } from './project-analysis-result.js';
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
  CandidateLink,
  /** @deprecated Use CandidateLink */
  FeatureCandidate,
} from './profile-io.js';
export type {
  ProjectAnalysisMetadata,
  ProjectAnalysisResult,
  ProjectAnalysisTier,
} from './project-analysis-result.js';
