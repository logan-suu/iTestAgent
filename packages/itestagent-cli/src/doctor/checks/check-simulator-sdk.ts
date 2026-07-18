/**
 * Simulator SDK check — doctor simulator readiness lane.
 *
 * US-1.2 AC1: pass/fail/manual three-state.
 * US-1.2 AC2: fix guidance for failures.
 *
 * Checks:
 *   1. xcrun --sdk iphonesimulator --show-sdk-path → SDK path resolves?
 *   2. Verify the path exists on disk (via stat)
 *
 * 避坑手册 §3: Simulator runtime not installed → SDK build fails.
 * This check verifies the SDK is present before attempting any Simulator build.
 */
import type { DoctorCheckResult } from '../types.js';
import { exec } from '../utils.js';

export async function checkSimulatorSdk(): Promise<DoctorCheckResult> {
  const sdkPath = exec('xcrun', ['--sdk', 'iphonesimulator', '--show-sdk-path']);

  if (sdkPath.exitCode !== 0 || !sdkPath.stdout) {
    return {
      name: 'Simulator SDK',
      status: 'fail',
      message: `iPhone Simulator SDK not found: ${sdkPath.stderr || 'no output'}`,
      fixGuide: [
        'Ensure Xcode is installed with simulator support',
        'Check available SDKs: xcodebuild -showsdks',
        'If missing, install Xcode from the Mac App Store',
        'Verify: xcrun --sdk iphonesimulator --show-sdk-path',
      ],
      details: sdkPath.stderr,
    };
  }

  const path = sdkPath.stdout;

  // Verify the path actually exists on disk
  const stat = exec('stat', [path]);
  if (stat.exitCode !== 0) {
    return {
      name: 'Simulator SDK',
      status: 'fail',
      message: `Simulator SDK path resolves but does not exist: ${path}`,
      fixGuide: [
        `Expected SDK at: ${path}`,
        'Reinstall Xcode or Command Line Tools: xcode-select --install',
        'Check Xcode version: xcodebuild -version',
      ],
      details: `SDK path: ${path}\nstat: ${stat.stderr}`,
    };
  }

  // Extract SDK version for details
  const sdkVersion = exec('xcrun', ['--sdk', 'iphonesimulator', '--show-sdk-version']);

  return {
    name: 'Simulator SDK',
    status: 'pass',
    message: 'iPhone Simulator SDK is available',
    details: [
      `SDK path: ${path}`,
      sdkVersion.exitCode === 0 ? `SDK version: ${sdkVersion.stdout}` : null,
    ]
      .filter(Boolean)
      .join('\n'),
  };
}
