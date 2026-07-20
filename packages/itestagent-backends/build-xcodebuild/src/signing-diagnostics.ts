/**
 * Signing diagnostics — parse xcodebuild output for signing failures.
 *
 * US-6.2 AC3: When signing fails, give clear reason and fix guidance. Never silently degrade.
 *
 * Matches common signing error patterns from xcodebuild stderr/stdout.
 * Returns null if no known signing pattern is detected (caller handles generic failure).
 *
 * AGENTS.md R5: Never silently degrade — errors are explicit with context.
 * AGENTS.md R12: All code/comments in English.
 */

// ─── Types ────────────────────────────────────────────────────────

/** Structured signing diagnostic with reason and actionable fix guidance. */
export interface SigningDiagnostic {
  /** Human-readable reason for the signing failure. */
  reason: string;
  /** Ordered list of fix suggestions (first = most likely). */
  fixGuide: string[];
  /** Which error pattern was matched (for debugging / telemetry). */
  matchedPattern?: string;
}

// ─── Pattern matchers ─────────────────────────────────────────────

interface SigningPattern {
  name: string;
  /** Regex tested against the raw xcodebuild output (case-insensitive). */
  pattern: RegExp;
  /** Generate diagnostic from the matched output. */
  buildDiagnostic: (matched: RegExpMatchArray) => SigningDiagnostic;
}

/**
 * All known signing error patterns.
 *
 * Ordered by specificity — more specific patterns first to avoid false matches.
 */
const SIGNING_PATTERNS: SigningPattern[] = [
  // 1. "No provisioning profile found" — most common
  {
    name: 'no_provisioning_profile',
    pattern:
      /no\s+provisioning\s+profile|no\s+profiles\s+for\s+'.*'\s+were\s+found|automatic\s+signing\s+is\s+disabled/i,
    buildDiagnostic: () => ({
      reason:
        'No provisioning profile found matching the bundle identifier and signing certificate.',
      fixGuide: [
        'Check that a provisioning profile exists in Xcode: Preferences > Accounts > Manage Certificates',
        'If the project uses manual signing, verify the provisioning profile is assigned in Signing & Capabilities',
        'If the project uses automatic signing, ensure your Apple ID team is selected and the bundle ID is registered',
        'Run: fastlane sigh (if fastlane is configured) to regenerate provisioning profiles',
      ],
      matchedPattern: 'no_provisioning_profile',
    }),
  },

  // 2. "No signing certificate" — cert not installed in keychain
  {
    name: 'no_signing_certificate',
    pattern:
      /no\s+signing\s+certificate|certificate\s+for\s+.*not\s+found|code\s+signing\s+identity.*not\s+found/i,
    buildDiagnostic: () => ({
      reason: 'No valid signing certificate found in your keychain for the required team/identity.',
      fixGuide: [
        'Check installed certificates: security find-identity -v -p codesigning',
        'If no certificates listed, open Xcode > Preferences > Accounts > Manage Certificates to create/download a certificate',
        'If the certificate exists but is expired, renew it in Xcode or Apple Developer Portal',
        'If the wrong team is selected, verify Signing > Team in the project settings',
        'Run: fastlane cert (if fastlane is configured) to generate a new certificate',
      ],
      matchedPattern: 'no_signing_certificate',
    }),
  },

  // 3. "Provisioning profile has expired"
  {
    name: 'profile_expired',
    pattern: /provisioning\s+profile\s+.*expired|profile\s+has\s+expired/i,
    buildDiagnostic: () => ({
      reason: 'The provisioning profile used for signing has expired.',
      fixGuide: [
        'Open Xcode > Preferences > Accounts > Manage Certificates to download the latest profile',
        'Or visit https://developer.apple.com/account/ to regenerate the provisioning profile',
        'Run: fastlane sigh renew (if fastlane is configured)',
        'If using automatic signing, toggle "Automatically manage signing" off and back on in Signing & Capabilities',
      ],
      matchedPattern: 'profile_expired',
    }),
  },

  // 4. "Certificate has expired"
  {
    name: 'cert_expired',
    pattern:
      /(code\s+sign|certificate|signing\s+certificate|signing\s+identity).*(?:has\s+expired|expired)/i,
    buildDiagnostic: (match) => {
      const matchedText = match[0] ?? '';
      const ctx =
        match.input?.slice(Math.max(0, (match.index ?? 0) - 100), (match.index ?? 0) + 200) ?? '';
      if (!/certificate|code\s*sign/i.test(ctx)) {
        // False positive — let a more specific pattern handle it
        return {
          reason: 'A code signing certificate or provisioning profile has expired.',
          fixGuide: [
            'Check certificate validity: security find-identity -v -p codesigning',
            'Renew expired certs in Xcode > Preferences > Accounts > Manage Certificates',
            'Delete expired certs from Keychain Access if they cause conflicts',
          ],
          matchedPattern: 'cert_expired',
        };
      }
      return {
        reason: 'Your Apple Development or Distribution certificate has expired.',
        fixGuide: [
          'Open Xcode > Preferences > Accounts > Manage Certificates to revoke and recreate the expired certificate',
          'Or visit Apple Developer Portal: Certificates, Identifiers & Profiles',
          'Run: fastlane cert (if fastlane is configured) to generate a new certificate',
          'After renewing, update provisioning profiles as they may reference the old certificate',
        ],
        matchedPattern: 'cert_expired',
      };
    },
  },

  // 5. "Team does not have permission" — team/account access issue
  {
    name: 'team_permission_denied',
    pattern:
      /does\s+not\s+have\s+permission|not\s+authorized|no\s+account\s+for\s+team|team\s+.*not\s+found/i,
    buildDiagnostic: () => ({
      reason:
        'Your Apple Developer account does not have permission to sign for this team or bundle identifier.',
      fixGuide: [
        'Verify your Apple ID is added to the correct team: Apple Developer Portal > People',
        'Check that your account has the right role (Admin or App Manager for signing)',
        'If the bundle ID uses a different team prefix, update the bundle identifier in Xcode',
        'Open Xcode > Preferences > Accounts and ensure the correct team is selected',
        'Try removing and re-adding your Apple ID account in Xcode',
      ],
      matchedPattern: 'team_permission_denied',
    }),
  },

  // 6. "Bundle identifier cannot be verified" — ID mismatch with Developer Portal
  {
    name: 'bundle_id_mismatch',
    pattern:
      /bundle\s+identifier.*cannot\s+be\s+verified|app\s+id.*not\s+available|an\s+app\s+id\s+with\s+identifier/i,
    buildDiagnostic: () => ({
      reason:
        'The bundle identifier is not registered in your Apple Developer account, or there is a mismatch.',
      fixGuide: [
        'Register the bundle ID in Apple Developer Portal: Certificates, Identifiers & Profiles > Identifiers',
        'Ensure the bundle ID in Xcode matches the one in Developer Portal (Project > General > Bundle Identifier)',
        'If the bundle ID uses a wildcard (*), ensure the provisioning profile also uses a wildcard',
        'If the project is a new app, create an App ID first in Developer Portal before building',
      ],
      matchedPattern: 'bundle_id_mismatch',
    }),
  },
];

// ─── Public API ────────────────────────────────────────────────────

/**
 * Diagnose a signing failure from xcodebuild output.
 *
 * Scans the combined stdout+stderr for known signing error patterns.
 * Returns null if no known pattern is detected — caller treats as generic build failure.
 *
 * @param output - Combined stdout + stderr from xcodebuild (case-insensitive matching).
 * @returns SigningDiagnostic or null if no signing pattern matches.
 */
export function diagnoseSigningError(output: string): SigningDiagnostic | null {
  if (!output || output.trim().length === 0) {
    return null;
  }

  for (const patternDef of SIGNING_PATTERNS) {
    const match = patternDef.pattern.exec(output);
    if (match) {
      const diagnostic = patternDef.buildDiagnostic(match);
      return {
        reason: diagnostic.reason,
        fixGuide: diagnostic.fixGuide,
        matchedPattern: diagnostic.matchedPattern,
      };
    }
  }

  return null;
}

/**
 * Check whether an xcodebuild output contains ANY signing-related error.
 *
 * Faster than diagnoseSigningError() — returns boolean without building diagnostic.
 * Useful as a pre-check before calling the full diagnostic.
 *
 * @param output - Combined stdout + stderr from xcodebuild.
 */
export function hasSigningError(output: string): boolean {
  return diagnoseSigningError(output) !== null;
}
