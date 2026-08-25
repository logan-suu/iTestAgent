/**
 * profile-inference.ts — heuristic feature/smoke inference for ProjectProfile.
 *
 * R4-compliant: every candidate carries evidence (source file) + confidence
 * (heuristic). Never auto-finalize core paths — these are candidates for TUI
 * confirmation. All functions here are pure and deterministic so they can be
 * unit-tested in isolation from any ProjectAnalyzerBackend.
 */

import type { CandidateLink } from './profile-io.js';

/** Source facts consumed by feature inference (subset of contracts SourceFacts). */
export interface FeatureSourceFacts {
  viewControllers: Array<{ name: string; file: string }>;
  storyboardRefs: string[];
}

/**
 * Infer CandidateLink list from SourceFacts.
 *
 * Each ViewController becomes a candidate feature; storyboard references are
 * appended as additional device-backend-only candidates (deduplicated by
 * entry). Results are sorted by confidence descending and pinned with a
 * sequential displayOrder.
 */
export function inferFeatures(facts: FeatureSourceFacts, hasXCUITest: boolean): CandidateLink[] {
  const features: CandidateLink[] = [];

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
      confirmed: false,
      displayOrder: 0,
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
        confidence: 0.3,
        confirmed: false,
        displayOrder: 0,
      });
    }
  }

  // Sort by confidence descending, then pin display order
  features.sort((a, b) => b.confidence - a.confidence);

  features.forEach((f, i) => {
    f.displayOrder = i;
  });

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

export function confidenceForViewName(name: string): number {
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
export function extractKeywords(name: string): string[] {
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
export function isAccountRelated(name: string): boolean {
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
 * Capped at 8 suggestions to avoid overwhelming the TUI.
 */
export function inferSuggestedSmoke(features: CandidateLink[]): string[] {
  const smoke: string[] = ['launch']; // Universal smoke baseline

  for (const f of features) {
    if (f.confidence >= 0.5 && !smoke.includes(f.name)) {
      smoke.push(f.name);
    }
  }

  return smoke.slice(0, 8); // Cap at 8 suggestions to avoid overwhelming TUI
}
