import type { ProjectAnalyzerBackend } from 'itestagent-contracts';
import type {
  FeatureCandidate,
  ProjectProfile,
  TargetProfile,
  TestAssetsProfile,
} from './profile-io.js';
import { computeProjectHash } from './project-hash.js';

/**
 * generateProjectProfile — assemble a ProjectProfile from all 5 backend methods.
 *
 * Data flow (per 数据流全链路 §5):
 *   discover  → app.{name, workspace, project, scheme}
 *   graph     → targets, hasXCUITest, hasUnitTests
 *   buildSettings → app.bundleId
 *   scanSources → features (VCs → FeatureCandidate)
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

/**
 * Infer FeatureCandidate list from SourceFacts.
 *
 * R4-compliant: every feature carries evidence (source file) + confidence (heuristic).
 * Never auto-finalize core paths — these are candidates for TUI confirmation (task 2.4).
 */
function inferFeatures(
  facts: { viewControllers: Array<{ name: string; file: string }>; storyboardRefs: string[] },
  hasXCUITest: boolean,
): FeatureCandidate[] {
  const features: FeatureCandidate[] = [];

  // Each ViewController becomes a candidate feature
  for (const vc of facts.viewControllers) {
    const entry = vc.name;
    const confidence = confidenceForViewName(vc.name);
    const keywords = extractKeywords(vc.name);
    const requiresAccount = isAccountRelated(vc.name);

    // Feature name: strip common suffixes for readability
    const name =
      vc.name
        .replace(/ViewController$/, '')
        .replace(/Controller$/, '')
        .replace(/View$/, '') || vc.name;

    features.push({
      name,
      entry,
      keywords: keywords.length > 0 ? keywords : undefined,
      testability: hasXCUITest ? 'xcuitest' : 'device_backend',
      requiresAccount: requiresAccount || undefined,
      evidence: [`Source: ${vc.file}`],
      confidence,
    });
  }

  // Storyboard references as additional features
  for (const sb of facts.storyboardRefs) {
    // Extract a human-readable name from the storyboard path
    const sbName =
      sb
        .split('/')
        .pop()
        ?.replace(/\.storyboard$/i, '') || sb;
    // Avoid duplicates with VC-based features
    if (!features.some((f) => f.entry === sb)) {
      features.push({
        name: sbName,
        entry: sb,
        testability: 'device_backend',
        evidence: [`Storyboard: ${sb}`],
        confidence: 0.3, // Lower confidence for storyboard-only features
      });
    }
  }

  // Sort by confidence descending
  features.sort((a, b) => b.confidence - a.confidence);

  return features;
}

/**
 * Assign confidence score based on ViewController name heuristics.
 *
 * Heuristics (R4: these are inferential, not compiler-verified):
 *   - Well-known domain patterns (Login, Auth, Payment, Checkout, Profile, Settings) → 0.75
 *   - Common app patterns (Home, Main, Tab, Root, Navigation) → 0.6
 *   - Generic/unknown names → 0.5
 *   - Delegate/Protocol/Helper patterns → 0.35
 */
const HIGH_CONFIDENCE_PATTERNS = [
  'login',
  'signin',
  'signup',
  'register',
  'auth',
  'payment',
  'checkout',
  'cart',
  'order',
  'profile',
  'account',
  'settings',
  'preferences',
  'search',
  'discover',
  'explore',
  'chat',
  'message',
  'inbox',
  'notification',
];
const MEDIUM_CONFIDENCE_PATTERNS = [
  'home',
  'main',
  'root',
  'tab',
  'navigation',
  'dashboard',
  'list',
  'detail',
  'feed',
  'timeline',
  'photo',
  'video',
  'camera',
  'gallery',
  'map',
  'location',
];
const LOW_CONFIDENCE_PATTERNS = [
  'delegate',
  'protocol',
  'helper',
  'manager',
  'handler',
  'provider',
  'datasource',
  'adapter',
  'coordinator',
  'factory',
];

function confidenceForViewName(name: string): number {
  const lower = name.toLowerCase();

  for (const p of HIGH_CONFIDENCE_PATTERNS) {
    if (lower.includes(p)) return 0.75;
  }
  for (const p of MEDIUM_CONFIDENCE_PATTERNS) {
    if (lower.includes(p)) return 0.6;
  }
  for (const p of LOW_CONFIDENCE_PATTERNS) {
    if (lower.includes(p)) return 0.35;
  }

  return 0.5;
}

/** Extract keywords from ViewController name for TestPlan matching */
function extractKeywords(name: string): string[] {
  const keywords: string[] = [];
  const lower = name.toLowerCase();

  if (lower.includes('login') || lower.includes('signin')) keywords.push('login');
  if (lower.includes('register') || lower.includes('signup')) keywords.push('register', 'signup');
  if (lower.includes('payment') || lower.includes('checkout') || lower.includes('cart'))
    keywords.push('payment');
  if (lower.includes('profile') || lower.includes('account')) keywords.push('profile', 'account');
  if (lower.includes('settings') || lower.includes('preferences')) keywords.push('settings');
  if (lower.includes('search') || lower.includes('discover') || lower.includes('explore'))
    keywords.push('search');
  if (lower.includes('chat') || lower.includes('message')) keywords.push('message');
  if (lower.includes('notification')) keywords.push('notification');
  if (lower.includes('camera') || lower.includes('photo') || lower.includes('gallery'))
    keywords.push('media');
  if (lower.includes('map') || lower.includes('location')) keywords.push('map');

  return [...new Set(keywords)]; // deduplicate
}

/** Heuristic: does this VC likely require a user account? */
function isAccountRelated(name: string): boolean {
  const lower = name.toLowerCase();
  return (
    lower.includes('login') ||
    lower.includes('signin') ||
    lower.includes('signup') ||
    lower.includes('register') ||
    lower.includes('auth') ||
    lower.includes('account') ||
    lower.includes('profile') ||
    lower.includes('payment') ||
    lower.includes('checkout') ||
    lower.includes('order')
  );
}

/**
 * Infer suggestedSmoke test entry points from features.
 *
 * R4: These are suggestions, not automated decisions.
 * Picks features with confidence >= 0.5, plus "launch" as a universal baseline.
 */
function inferSuggestedSmoke(features: FeatureCandidate[]): string[] {
  const smoke: string[] = ['launch']; // Universal smoke baseline

  for (const f of features) {
    if (f.confidence >= 0.5 && !smoke.includes(f.name)) {
      smoke.push(f.name);
    }
  }

  return smoke.slice(0, 8); // Cap at 8 suggestions to avoid overwhelming TUI
}
