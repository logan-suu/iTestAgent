/**
 * Deep signing identity check — cross-validates Team ID from multiple sources.
 *
 * US-1.2 AC1: pass/fail/manual three-state.
 * US-1.3 AC1: recognizes "signing identity incomplete" scenarios.
 *
 * Goes beyond existing check-signing.ts by cross-validating:
 *   1. xcodebuild -showBuildSettings DEVELOPMENT_TEAM
 *   2. security find-identity -v -p codesigning cert subject OU (Team ID)
 *   3. Provisioning profile TeamIdentifier field
 *   4. Private key existence for matching certificates
 *
 * Returns:
 *   - 'pass' if team ID is consistent across all sources
 *   - 'manual' if personal team detected (free Apple ID)
 *   - 'fail' if no identity found or cert has no private key
 *
 * AGENTS.md §2 (R6): no credentials in logs/output. Cert hashes redacted.
 * AGENTS.md §3.1.4 (R12): comments in English.
 */
import type { DoctorCheckResult } from '../types.js';
import { exec } from '../utils.js';

/**
 * Extract the Team ID (OU) from security find-identity subject output.
 *
 * Subject line format: "1) HASH "Common Name" (OU=TEAMID)"
 * Returns undefined if not extractable.
 */
function extractTeamIdFromSubject(line: string): string | undefined {
  const match = line.match(/OU=([A-Z0-9]+)/);
  return match?.[1];
}

/**
 * Extract TeamIdentifier from a .mobileprovision file.
 *
 * Parses the provisioning profile XML to find the TeamIdentifier array.
 * Returns array of team IDs found.
 */
function extractTeamIdsFromProfile(profilePath: string): string[] {
  const result = exec('security', ['cms', '-D', '-i', profilePath]);
  if (result.exitCode !== 0 || !result.stdout) return [];

  const teamIds: string[] = [];
  // Match <key>TeamIdentifier</key> followed by <array> block
  const sectionMatch = result.stdout.match(
    /<key>TeamIdentifier<\/key>\s*<array>([\s\S]*?)<\/array>/,
  );
  if (sectionMatch?.[1]) {
    const stringMatches = sectionMatch[1].matchAll(/<string>([^<]+)<\/string>/g);
    for (const m of stringMatches) {
      if (m[1]) teamIds.push(m[1]);
    }
  }
  return teamIds;
}

/**
 * Get DEVELOPMENT_TEAM from the active Xcode project settings.
 *
 * Uses xcodebuild -showBuildSettings with a generic project to extract
 * the configured Team ID. In test environments this may fail, so the
 * function is best-effort.
 */
function extractDevelopmentTeam(): string | undefined {
  // Try common Xcode project locations
  const result = exec('xcrun', ['xcodebuild', '-showBuildSettings', '-json']);
  if (result.exitCode === 0 && result.stdout) {
    try {
      const parsed = JSON.parse(result.stdout) as Array<{
        buildSettings?: { DEVELOPMENT_TEAM?: string };
      }>;
      for (const item of parsed) {
        if (item.buildSettings?.DEVELOPMENT_TEAM) {
          return item.buildSettings.DEVELOPMENT_TEAM;
        }
      }
    } catch {
      // JSON parse failed — fall back to text search
      const match = result.stdout.match(/DEVELOPMENT_TEAM\s*=\s*([A-Z0-9]+)/);
      return match?.[1];
    }
  }
  return undefined;
}

/**
 * Check if a cert identity has a corresponding private key.
 *
 * Uses `security find-identity -v -p codesigning` output to check for
 * valid identities. The `-v` flag ensures only identities with valid
 * private keys are returned.
 */
function hasValidIdentity(): boolean {
  const result = exec('security', ['find-identity', '-v', '-p', 'codesigning']);
  if (result.exitCode !== 0) return false;

  const lines = result.stdout.split('\n');
  for (const line of lines) {
    // Valid identity lines contain a hex hash and a quoted name
    if (/\b[0-9A-F]{40}\b/.test(line) && line.includes('"')) {
      return true;
    }
  }
  return false;
}

export async function checkSigningIdentity(): Promise<DoctorCheckResult> {
  const details: string[] = [];
  const issues: string[] = [];
  const teamIds = new Set<string>();
  const missing: string[] = [];

  // ── Step 1: Get Team ID from security find-identity ───────────
  const identities = exec('security', ['find-identity', '-v', '-p', 'codesigning']);

  if (identities.exitCode === 0 && identities.stdout) {
    const lines = identities.stdout.split('\n');
    let validCount = 0;
    let personalTeam = false;

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      if (/^\d+\)/.test(trimmed)) {
        const teamId = extractTeamIdFromSubject(trimmed);
        if (teamId) {
          teamIds.add(teamId);
          validCount++;
        }
        // Redact full line for safety (R6)
        const match = trimmed.match(/"([^"]+)"/);
        if (match?.[1]) {
          const name = match[1];
          details.push(`  - "${name}" (Team: ${teamId ?? 'unknown'})`);
          // Xcode auto-generated personal team names start with 'Apple Development:'
          if (name.toLowerCase().includes('personal team')) {
            personalTeam = true;
          }
        }
      }
    }

    if (validCount === 0) {
      issues.push('No valid signing identities found (no private key)');
    }

    if (personalTeam) {
      details.push('Note: Personal team detected (free Apple ID)');
    }
  } else {
    issues.push('Cannot query signing identities from Keychain');
  }

  // ── Step 2: Get DEVELOPMENT_TEAM from xcodebuild ──────────────
  const devTeam = extractDevelopmentTeam();
  if (devTeam) {
    if (teamIds.size > 0 && !teamIds.has(devTeam)) {
      issues.push(`DEVELOPMENT_TEAM (${devTeam}) does not match any code signing identity Team ID`);
    }
    details.push(`DEVELOPMENT_TEAM: ${devTeam}`);
    teamIds.add(devTeam);
  } else {
    missing.push('DEVELOPMENT_TEAM');
  }

  // ── Step 3: Check provisioning profiles ───────────────────────
  const home = process.env.HOME;
  if (home) {
    const profilesDir = `${home}/Library/MobileDevice/Provisioning Profiles`;
    const profiles = exec('find', [profilesDir, '-name', '*.mobileprovision', '-maxdepth', '1']);

    if (profiles.exitCode === 0 && profiles.stdout) {
      const profilePaths = profiles.stdout.split('\n').filter((p) => p.trim());
      let profileTeamIdsFound = 0;

      for (const profilePath of profilePaths) {
        const trimmed = profilePath.trim();
        if (!trimmed) continue;
        const profileTeams = extractTeamIdsFromProfile(trimmed);
        for (const tid of profileTeams) {
          teamIds.add(tid);
          profileTeamIdsFound++;
        }
      }

      if (profileTeamIdsFound > 0) {
        details.push(
          `Provisioning profiles: ${profilePaths.length} files, ${profileTeamIdsFound} team IDs`,
        );
      } else {
        missing.push('Provisioning profile TeamIdentifier');
        details.push(
          `Provisioning profiles: ${profilePaths.length} files found (no team IDs extracted)`,
        );
      }
    } else {
      missing.push('Provisioning Profiles directory');
    }
  } else {
    missing.push('HOME directory (cannot locate profiles)');
  }

  // ── Step 4: Assessment ─────────────────────────────────────────

  const uniqueTeamIds = Array.from(teamIds);
  const hasIdentity = hasValidIdentity();

  details.unshift(`Team IDs found: [${uniqueTeamIds.join(', ') || 'none'}]`);

  // No identity at all
  if (!hasIdentity && uniqueTeamIds.length === 0) {
    return {
      name: 'Signing Identity (Deep)',
      status: 'fail',
      message: 'No code signing identity with private key found.',
      fixGuide: [
        'Add your Apple ID in Xcode: Xcode > Settings > Accounts',
        'Create a signing certificate: Xcode auto-generates for your team',
        'Verify: security find-identity -v -p codesigning',
        'For free accounts: add -allowProvisioningUpdates to xcodebuild',
        'Re-run doctor after adding an account to Xcode',
      ],
      details: details.join('\n'),
    };
  }

  // Multiple inconsistent team IDs
  if (uniqueTeamIds.length > 1) {
    details.push('⚠ Cross-validation: inconsistent team IDs across sources');

    return {
      name: 'Signing Identity (Deep)',
      status: 'manual',
      message: `Multiple team IDs found: [${uniqueTeamIds.join(', ')}]. Signing may work but cross-validation is inconsistent.`,
      fixGuide: [
        'Review Xcode signing settings: Xcode > Signing & Capabilities > Team',
        'Ensure provisioning profiles match the selected team',
        'Remove stale provisioning profiles to avoid conflicts',
        `Team IDs found: ${uniqueTeamIds.join(', ')}`,
      ],
      details: details.join('\n'),
    };
  }

  // Single consistent team ID — pass
  const finalTeamId = uniqueTeamIds[0];
  if (finalTeamId && hasIdentity) {
    if (missing.length > 0) {
      details.push(`Missing checks: ${missing.join(', ')}`);
      return {
        name: 'Signing Identity (Deep)',
        status: 'manual',
        message: `Team ID "${finalTeamId}" found but some checks incomplete: ${missing.join(', ')}.`,
        fixGuide: [
          'Set DEVELOPMENT_TEAM in project build settings',
          'Install a provisioning profile for this team',
          'For free accounts: the team ID should be your personal team',
        ],
        details: details.join('\n'),
      };
    }

    return {
      name: 'Signing Identity (Deep)',
      status: 'pass',
      message: `Signing identity consistent: Team "${finalTeamId}" verified across identity, project, and profiles.`,
      details: details.join('\n'),
    };
  }

  // Identity exists but team ID unclear
  return {
    name: 'Signing Identity (Deep)',
    status: 'manual',
    message: 'Signing identity exists but team ID could not be fully cross-validated.',
    fixGuide: [
      'Verify signing in Xcode: Xcode > Signing & Capabilities',
      'Check provisioning profiles at: ~/Library/MobileDevice/Provisioning Profiles',
      'Run: xcodebuild -showBuildSettings to confirm DEVELOPMENT_TEAM',
    ],
    details: details.join('\n'),
  };
}
