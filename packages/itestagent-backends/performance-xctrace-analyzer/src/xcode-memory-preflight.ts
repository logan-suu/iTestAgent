import { isAbsolute } from 'node:path';
import { startCaptureProcess } from './capture-process.js';

export interface XcodeMemoryPreflightInput {
  helperPath: string;
  xcodePath: string;
  target: { kind: 'physical'; deviceId: string; bundleId: string };
  signal?: AbortSignal;
}
export type XcodeMemoryPreflightReason =
  | 'xcode_not_running'
  | 'invalid_input'
  | 'xcode_invalid'
  | 'accessibility_unavailable'
  | 'xcode_instance_conflict'
  | 'accessibility_query_failed'
  | 'unsupported_host'
  | 'protocol_invalid'
  | 'process_failed'
  | 'timeout'
  | 'cancelled';
export interface XcodeMemoryPreflightResult {
  status: 'eligible' | 'blocked';
  reason: XcodeMemoryPreflightReason;
  /** Eligibility is host-only and never establishes capture readiness or device identity. */
  targetVerified: false;
  xcodeVersion?: string;
}
const blocked = (reason: XcodeMemoryPreflightReason): XcodeMemoryPreflightResult => ({
  status: 'blocked',
  reason,
  targetVerified: false,
});
const helperReasons = new Set([
  'invalid_input',
  'xcode_invalid',
  'accessibility_unavailable',
  'xcode_instance_conflict',
  'accessibility_query_failed',
]);

export function parseXcodeMemoryPreflight(stdout: string): XcodeMemoryPreflightResult {
  if (stdout.length > 1024) return blocked('protocol_invalid');
  let v: Record<string, unknown>;
  try {
    v = JSON.parse(stdout);
  } catch {
    return blocked('protocol_invalid');
  }
  if (
    !v ||
    typeof v !== 'object' ||
    Array.isArray(v) ||
    Object.keys(v).some(
      (key) =>
        !['protocolVersion', 'status', 'reason', 'targetVerified', 'xcodeVersion'].includes(key),
    ) ||
    v.protocolVersion !== 1 ||
    v.targetVerified !== false ||
    (v.xcodeVersion !== undefined &&
      (typeof v.xcodeVersion !== 'string' || !/^\d{1,3}(\.\d{1,3}){1,2}$/.test(v.xcodeVersion))) ||
    !(
      (v.status === 'eligible' &&
        v.reason === 'xcode_not_running' &&
        v.xcodeVersion !== undefined) ||
      (v.status === 'blocked' && typeof v.reason === 'string' && helperReasons.has(v.reason))
    )
  )
    return blocked('protocol_invalid');
  return {
    status: v.status as 'eligible' | 'blocked',
    reason: v.reason as XcodeMemoryPreflightReason,
    targetVerified: false,
    ...(typeof v.xcodeVersion === 'string' ? { xcodeVersion: v.xcodeVersion } : {}),
  };
}

/** No shell, UI mutations, permission prompts, or raw diagnostics leave this boundary. */
export async function preflightXcodeMemory(
  input: XcodeMemoryPreflightInput,
  dependencies: { spawn?: typeof startCaptureProcess; platform?: string } = {},
): Promise<XcodeMemoryPreflightResult> {
  if (input.signal?.aborted) return blocked('cancelled');
  if (
    !isAbsolute(input.helperPath) ||
    !isAbsolute(input.xcodePath) ||
    /[\0\r\n]/.test(input.helperPath + input.xcodePath) ||
    input.target?.kind !== 'physical' ||
    !/^[A-Za-z0-9-]{1,128}$/.test(input.target.deviceId) ||
    !/^[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+$/.test(input.target.bundleId) ||
    input.target.bundleId.length > 255
  )
    return blocked('invalid_input');
  if ((dependencies.platform ?? process.platform) !== 'darwin') return blocked('unsupported_host');
  try {
    const child = (dependencies.spawn ?? startCaptureProcess)([input.helperPath, input.xcodePath], {
      signal: input.signal,
      timeoutMs: 5000,
    });
    const result = await child.completed;
    if (input.signal?.aborted || result.failure === 'performance.cancelled')
      return blocked('cancelled');
    if (result.failure === 'performance.process_timeout') return blocked('timeout');
    if (result.failure || result.exitCode !== 0 || result.stderr !== '')
      return blocked('process_failed');
    return parseXcodeMemoryPreflight(result.stdout);
  } catch {
    return blocked(input.signal?.aborted ? 'cancelled' : 'process_failed');
  }
}
