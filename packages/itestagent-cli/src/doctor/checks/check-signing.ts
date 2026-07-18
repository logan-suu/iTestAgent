/**
 * Code signing identity check — doctor physical readiness lane.
 *
 * US-1.2 AC1: pass/fail/manual three-state.
 * US-1.2 AC2: fix guidance for signing failures.
 * US-1.3 AC1: recognizes "signature unavailable" scenario.
 *
 * Checks:
 *   1. security find-identity -v -p codesigning → available identities?
 *   2. Provisioning profile existence
 *
 * AGENTS.md §2 (R6): no credentials in logs/output.
 * AGENTS.md §3.1.4 (R12): comments in English.
 */
import type { DoctorCheckResult } from '../types.js';
import { exec } from '../utils.js';

export async function checkSigning(): Promise<DoctorCheckResult> {
  const identities = exec('security', ['find-identity', '-v', '-p', 'codesigning']);
  const home = process.env.HOME;
  if (!home) {
    return {
      name: 'Code Signing',
      status: 'manual',
      message: 'Cannot determine home directory for Provisioning Profiles lookup.',
      fixGuide: ['Verify HOME environment variable is set.'],
    };
  }
  const profiles = exec('ls', [`${home}/Library/MobileDevice/Provisioning Profiles`]);
  const details: string[] = [];

  // Count valid identities
  const validIds = identities.stdout
    .split('\n')
    .filter((line) => line.includes('Developer ID') || line.includes('iPhone Developer'))
    .map((line) => line.trim());

  details.push(`Signing identities found: ${validIds.length}`);
  if (validIds.length > 0) {
    // Redact actual identities to prevent leaking in logs (R6)
    const redacted = validIds.map((id) => {
      // Extract only the label between quotes, redact the hash
      const match = id.match(/"(.*?)"/);
      return match ? `  - ${match[1]}` : '  - (redacted)';
    });
    details.push(redacted.join('\n'));
    return {
      name: 'Code Signing',
      status: 'pass',
      message: `${validIds.length} signing identity(s) available`,
      details: details.join('\n'),
    };
  }

  // No development identities
  const hasProfiles =
    profiles.exitCode === 0 && profiles.stdout && profiles.stdout.trim().length > 0;
  if (hasProfiles) {
    const profileCount = profiles.stdout.split('\n').filter((l) => l.trim()).length;
    details.push(`Provisioning profiles: ${profileCount} files found`);
  } else {
    details.push('No provisioning profiles found');
  }

  return {
    name: 'Code Signing',
    status: 'manual',
    message:
      'No code signing identities found. Free Apple ID can be used with provisioning updates.',
    fixGuide: [
      'Add your Apple ID in Xcode: Xcode > Settings > Accounts',
      'Create a signing certificate: Xcode will auto-generate for your team',
      'For free accounts: add -allowProvisioningUpdates to xcodebuild',
      'Check identities: security find-identity -v -p codesigning',
      'See AGENTS.md Phase 0 Appium/WDA notes for free account workaround',
    ],
    details: details.join('\n'),
  };
}
