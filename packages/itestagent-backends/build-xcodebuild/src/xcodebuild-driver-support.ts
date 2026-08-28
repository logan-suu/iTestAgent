/**
 * Xcodebuild driver support helpers — B12 module split (promotion guide
 * §11.3 "build-xcodebuild").
 *
 * Maps the contracts-layer BuildDestination vocabulary (B04,
 * `BuildDestinationSchema` — target-explicit principle) onto concrete
 * `-destination` argument pairs consumed by every xcodebuild invocation.
 */
import type { BuildDestination } from 'itestagent-contracts';

/**
 * Builds the `-destination <value>` argument pair for an optional
 * BuildDestination. Missing detail falls through to generic destinations so
 * xcodebuild never guesses a specific device from ambient state.
 */
export function destinationArgs(destination?: BuildDestination): string[] {
  if (!destination) return [];
  if (destination.targetKind === 'physical') {
    return [
      '-destination',
      destination.udid ? `platform=iOS,id=${destination.udid}` : 'generic/platform=iOS',
    ];
  }
  if (destination.simulatorId) {
    return ['-destination', `platform=iOS Simulator,id=${destination.simulatorId}`];
  }
  if (destination.simulatorName) {
    return ['-destination', `platform=iOS Simulator,name=${destination.simulatorName}`];
  }
  return ['-destination', 'generic/platform=iOS Simulator'];
}
