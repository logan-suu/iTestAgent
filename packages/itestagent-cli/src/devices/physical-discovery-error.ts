/**
 * Physical discovery errors — B18 module split (promotion guide §11.3
 * "physical discovery/doctor"; §5.1 "fail-closed").
 *
 * Typed failures so callers can branch on the root cause instead of sniffing
 * raw messages.
 */

export type PhysicalDiscoveryErrorCode = 'unparseable_output' | 'no_devices_found';

/** A physical-device discovery failure with a typed cause. */
export class PhysicalDiscoveryError extends Error {
  readonly code: PhysicalDiscoveryErrorCode;

  constructor(code: PhysicalDiscoveryErrorCode, message: string) {
    super(message);
    this.name = 'PhysicalDiscoveryError';
    this.code = code;
  }
}
