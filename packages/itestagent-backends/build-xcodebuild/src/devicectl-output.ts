/**
 * Strict devicectl output parsing primitives — B12 module split (promotion
 * guide §11.3 "build-xcodebuild", §5.1 "JSON alias、严格 text fallback、
 * fail-closed").
 *
 * The CoreDevice CLI changed output shapes across versions (the `506.6`
 * era introduced nested deviceProperties/hardwareProperties buckets). These
 * primitives are the fail-closed foundation every devicectl parser builds on:
 * unparseable JSON and unknown document shapes surface as typed errors
 * instead of guessed values (R5).
 */

export type DevicectlParseErrorCode = 'unparseable_json' | 'unknown_shape';

/** Typed parse failure — callers can branch on {@link code}. */
export class DevicectlParseError extends Error {
  readonly code: DevicectlParseErrorCode;

  constructor(code: DevicectlParseErrorCode, message: string) {
    super(message);
    this.name = 'DevicectlParseError';
    this.code = code;
  }
}

/**
 * Parses raw tool output as a strict JSON object.
 * Throws {@link DevicectlParseError} with code `unparseable_json` when the
 * bytes are not valid JSON or the root is not an object.
 */
export function parseStrictJsonObject(raw: string): Record<string, unknown> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    throw new DevicectlParseError('unparseable_json', 'devicectl output is not valid JSON');
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new DevicectlParseError('unknown_shape', 'devicectl output root is not a JSON object');
  }
  return parsed as Record<string, unknown>;
}

/**
 * Walks a dotted alias path (e.g. `result.devices`) through a parsed object.
 * Returns undefined as soon as any segment is missing or non-object.
 */
export function resolveFieldPath(record: Record<string, unknown>, path: string): unknown {
  let current: unknown = record;
  for (const segment of path.split('.')) {
    if (typeof current !== 'object' || current === null) return undefined;
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
}
