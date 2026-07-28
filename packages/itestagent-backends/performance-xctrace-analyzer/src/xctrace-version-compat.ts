/**
 * xctrace-version-compat — Xcode version detection and schema compatibility.
 *
 * Trap Handbook §6:
 *   - xctrace export XML schema changes across Xcode versions; id/ref parsing fragile
 *   - Xcode 26 introduces Deferred recording mode, parsing must be compatible
 *   - Schema name/column tolerance
 *
 * Tech Selection §15: xctrace/xcresulttool output schema cross-version tolerance,
 * backend absorbs differences.
 */

// ─── Types ────────────────────────────────────────────────────────

/** Parsed Xcode version. */
export interface XcodeVersion {
  major: number;
  minor: number;
  raw: string;
}

/** Schema name mapping for cross-version compatibility. */
export interface SchemaAlias {
  /** The canonical schema name used internally. */
  canonical: string;
  /** Alternative schema names across Xcode versions. */
  aliases: Record<string, string[]>; // versionKey → alternative names
  /** Column name mappings per version. */
  columnAliases: Record<string, Record<string, string>>; // versionKey → { canonical → alias }
}

// ─── Version Detection ──────────────────────────────────────────

/**
 * Parse xctrace --version output into structured version.
 *
 * Examples:
 *   "xctrace version 16.0 (2040.3)" → { major: 16, minor: 0 }
 *   "xctrace version 26.0"          → { major: 26, minor: 0 }
 *
 * @param versionString - Raw output from `xcrun xctrace --version`
 * @returns Parsed version, or null if unparseable
 */
export function detectXcodeVersion(versionString: string): XcodeVersion | null {
  const match = versionString.match(/version\s+(\d+)\.(\d+)/);
  if (!match || match.length < 3) return null;

  const major = Number.parseInt(match[1] ?? '', 10);
  const minor = Number.parseInt(match[2] ?? '', 10);

  if (Number.isNaN(major) || Number.isNaN(minor)) return null;

  return { major, minor, raw: versionString.trim() };
}

/**
 * Generate a version key for use in schema compatibility maps.
 *
 * Format: "X{major}" (e.g. "X16", "X26")
 * Schema-level mapping uses major version only.
 */
export function toVersionKey(version: XcodeVersion): string {
  return `X${version.major}`;
}

// ─── Schema Compatibility Matrix ──────────────────────────────────

/**
 * Known schema compatibility mappings across Xcode versions.
 *
 * Trap Handbook §6: Schema name/column tolerance.
 *
 * Each entry maps a canonical schema name to version-specific aliases
 * and column name mappings.
 */
export const KNOWN_SCHEMA_COMPAT: SchemaAlias[] = [
  {
    canonical: 'Hitch',
    aliases: {
      X16: ['Hitch'],
      X26: ['HitchData'],
    },
    columnAliases: {
      X16: {
        hitch_ratio: 'hitch_ratio',
        hitch_duration_ms: 'hitch_duration_ms',
        hitch_time_mach_absolute_time: 'hitch_time_mach_absolute_time',
      },
      X26: {
        hitch_ratio: 'hitch_ratio_pct',
        hitch_duration_ms: 'dur_us',
        hitch_time_mach_absolute_time: 'hitch_time_ns',
      },
    },
  },
  {
    canonical: 'App Launch',
    aliases: {
      X16: ['App Launch'],
      X26: ['App Launch'],
    },
    columnAliases: {
      X16: { duration_ms: 'duration_ms', launch_type: 'launch_type' },
      X26: { duration_ms: 'duration_ms', launch_type: 'launch_type' },
    },
  },
  {
    canonical: 'Hangs',
    aliases: {
      X16: ['Hangs'],
      X26: ['Hangs'],
    },
    columnAliases: {
      X16: { hang_duration_ms: 'hang_duration_ms' },
      X26: { hang_duration_ms: 'hang_duration_ms' },
    },
  },
  {
    canonical: 'VM',
    aliases: {
      X16: ['VM'],
      X26: ['VM'],
    },
    columnAliases: {
      X16: { size: 'size', address: 'address', operation_type: 'operation_type' },
      X26: { size: 'size', address: 'address', operation_type: 'operation_type' },
    },
  },
];

/**
 * Resolve a schema name for a specific Xcode version.
 *
 * Given a canonical schema name, returns the expected schema name
 * in xctrace export output for the given Xcode version.
 *
 * Example: resolveSchemaName('Hitch', { major: 26 }) → 'HitchData'
 *
 * @param canonical - The canonical schema name
 * @param version - The Xcode version
 * @returns The version-specific schema name, or the canonical name if no mapping exists
 */
export function resolveSchemaName(canonical: string, version: XcodeVersion): string {
  const compat = KNOWN_SCHEMA_COMPAT.find((c) => c.canonical === canonical);
  if (!compat) return canonical;

  const versionKey = toVersionKey(version);
  const aliases = compat.aliases[versionKey];
  if (!aliases || aliases.length === 0) {
    // Unknown version: fall back to canonical
    return canonical;
  }

  return aliases[0] ?? canonical;
}

/**
 * Resolve the version-specific column name for a canonical column.
 *
 * Example: resolveColumnName('Hitch', 'hitch_ratio', { major: 26 }) → 'hitch_ratio_pct'
 *
 * @param canonicalSchema - The canonical schema name
 * @param canonicalColumn - The canonical column name
 * @param version - The Xcode version
 * @returns The version-specific column name, or the canonical name if no mapping exists
 */
export function resolveColumnName(
  canonicalSchema: string,
  canonicalColumn: string,
  version: XcodeVersion,
): string {
  const compat = KNOWN_SCHEMA_COMPAT.find((c) => c.canonical === canonicalSchema);
  if (!compat) return canonicalColumn;

  const versionKey = toVersionKey(version);
  const colMap = compat.columnAliases[versionKey];
  if (!colMap) return canonicalColumn;

  return colMap[canonicalColumn] ?? canonicalColumn;
}

/**
 * Check whether a given Xcode version is known to introduce breaking changes
 * to xctrace export schema.
 *
 * @param version - The Xcode version
 * @returns true if the version is known to have schema changes
 */
export function hasKnownSchemaChanges(version: XcodeVersion): boolean {
  return version.major >= 26;
}

/**
 * Get the set of known schema names for a specific Xcode version.
 *
 * Useful for generating version-aware XPath expressions.
 *
 * @param version - The Xcode version
 * @returns Array of schema names expected in this version's xctrace output
 */
export function getKnownSchemasForVersion(version: XcodeVersion): string[] {
  const versionKey = toVersionKey(version);
  const schemas: string[] = [];

  for (const compat of KNOWN_SCHEMA_COMPAT) {
    const aliases = compat.aliases[versionKey];
    if (aliases && aliases.length > 0) {
      schemas.push(aliases[0] ?? compat.canonical);
    } else {
      schemas.push(compat.canonical);
    }
  }

  return schemas;
}
