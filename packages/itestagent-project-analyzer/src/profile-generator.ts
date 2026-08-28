import type { ProjectAnalyzerBackend } from 'itestagent-contracts';
import { inferFeatures, inferSuggestedSmoke } from './profile-inference.js';
import type { ProjectProfile, TargetProfile, TestAssetsProfile } from './profile-io.js';
import { computeProjectHash } from './project-hash.js';

/**
 * generateProjectProfile — assemble a ProjectProfile from all 5 backend methods.
 *
 * Data flow (per 数据流全链路 §5):
 *   discover  → app.{name, workspace, project, scheme}
 *   graph     → targets, hasXCUITest, hasUnitTests
 *   buildSettings → app.bundleId
 *   scanSources → features (VCs → CandidateLink)
 *   scanResources → enriches context (not directly in profile, used for feature inference)
 *
 * AC1: Profile contains app, features, testAssets, suggestedSmoke.
 * R4:  features/suggestedSmoke carry evidence + confidence, never auto-finalize core paths.
 *
 * @param backend - The ProjectAnalyzerBackend implementation.
 * @param root    - Absolute path to the iOS project root.
 */
export async function generateProjectProfile(
  backend: ProjectAnalyzerBackend,
  root: string,
): Promise<ProjectProfile> {
  // ── Run discovery and hashing in parallel ──────────────────
  const [discovery, projectHash] = await Promise.all([
    backend.discover(root),
    computeProjectHash(root),
  ]);

  // ── Run graph and buildSettings (dependent on discovery) ──
  const graph = await backend.graph(discovery);

  // Find the primary app target for build settings query
  const appTarget = graph.targets.find((t) => t.type === 'app');
  const buildSettings = appTarget
    ? await backend.buildSettings({ root, target: appTarget.name })
    : null;

  // ── Run source & resource scans in parallel ───────────────
  const [sourceFacts, resourceFacts] = await Promise.all([
    backend.scanSources({ root }),
    backend.scanResources({ root }),
  ]);

  // ── Assemble output ───────────────────────────────────────

  // AC1: app — deterministic from xcodebuild (R1: trusted)
  const app: ProjectProfile['app'] = {
    name: discovery.name,
    bundleId: buildSettings?.bundleIdentifier,
    workspace: discovery.xcworkspacePath,
    project: discovery.xcodeprojPath,
    scheme: discovery.schemes[0], // Pick first scheme as default
  };

  // AC1: targets — deterministic from pbxproj graph
  const targets: TargetProfile[] = graph.targets.map((t) => ({
    name: t.name,
    type: mapTargetType(t.type),
  }));

  // Optionally enrich app targets with bundle IDs from build settings
  // (only possible for the main app target; extension targets deferred to Phase 2.4)
  if (appTarget && buildSettings?.bundleIdentifier) {
    const mainIdx = targets.findIndex((t) => t.name === appTarget.name);
    if (mainIdx !== -1) {
      const mainTarget = targets[mainIdx];
      if (mainTarget) {
        targets[mainIdx] = { ...mainTarget, bundleId: buildSettings.bundleIdentifier };
      }
    }
  }

  // AC1: testAssets — deterministic from graph + discovery
  const testAssets: TestAssetsProfile = {
    hasXCUITest: graph.hasXCUITests,
    hasScheme: discovery.schemes.some((s) => s.toLowerCase().includes('test')),
    testTargets: graph.targets.filter((t) => t.type === 'test').map((t) => t.name),
  };

  // AC1: features — inferred from source scan (R4: candidate + evidence + confidence)
  const features = inferFeatures(sourceFacts, graph.hasXCUITests);

  // AC1: suggestedSmoke — inferred from features (R4: candidate only)
  const suggestedSmoke = inferSuggestedSmoke(features);

  return {
    schemaVersion: 'itestagent.project-profile.v1',
    projectHash,
    app,
    targets,
    testAssets,
    features,
    suggestedSmoke,
  };
}

// ─── Private helpers ──────────────────────────────────────────────

/**
 * Map ProjectGraph target types to ProjectProfile TargetProfile type enum.
 */
function mapTargetType(type: string): TargetProfile['type'] {
  switch (type) {
    case 'app':
      return 'app';
    case 'test':
      return 'test';
    case 'framework':
      return 'framework';
    case 'bundle':
      return 'extension'; // bundles often represent extensions in iOS
    default:
      return 'extension';
  }
}
