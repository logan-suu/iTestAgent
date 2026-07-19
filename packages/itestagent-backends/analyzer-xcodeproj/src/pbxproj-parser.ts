import { existsSync, readFileSync } from 'node:fs';

/**
 * Lightweight .pbxproj parser — extracts target graph information
 * without any external dependencies.
 *
 * The .pbxproj file is an "old-style" ASCII plist with a specific
 * structure of sections delimited by C-style block comment markers.
 *
 * This parser extracts ONLY what we need:
 * - PBXNativeTarget: name, productType, dependencies
 * - PBXTargetDependency: target proxy references
 *
 * Used by graph() to build the ProjectGraph.
 * Reference: 技术选型文档 §10 — XcodeProj / Tuist XcodeProj 第一候选
 */

// ─── Types ─────────────────────────────────────────────────────

/** A single native target extracted from pbxproj. */
export interface ParsedNativeTarget {
  /** Target name (e.g. "MyApp", "MyAppTests"). */
  name: string;
  /** Apple product type (e.g. "com.apple.product-type.application"). */
  productType: string;
  /** Resolved dependency target names. */
  dependencyTargetUuids: string[];
}

/** Full parse result. */
export interface PbxprojParseResult {
  /** All native targets found. */
  targets: ParsedNativeTarget[];
  /** Root object UUID (the PBXProject). */
  rootObject: string;
}

// ─── Product type → our enum mapping ───────────────────────────

const UI_TEST_TYPES = new Set(['com.apple.product-type.bundle.ui-testing']);

const UNIT_TEST_TYPES = new Set(['com.apple.product-type.bundle.unit-test']);

const APP_TYPES = new Set([
  'com.apple.product-type.application',
  'com.apple.product-type.application.watchapp2',
  'com.apple.product-type.application.watchapp',
]);

const FRAMEWORK_TYPES = new Set([
  'com.apple.product-type.framework',
  'com.apple.product-type.framework.static',
  'com.apple.product-type.library.static',
  'com.apple.product-type.library.dynamic',
]);

const BUNDLE_TYPES = new Set([
  'com.apple.product-type.bundle',
  'com.apple.product-type.app-extension',
  'com.apple.product-type.watchkit2-extension',
  'com.apple.product-type.tv-app-extension',
  'com.apple.product-type.xcode-extension',
]);

/** Categorize a productType into our ProjectGraph target type. */
export function classifyProductType(
  productType: string,
): 'app' | 'framework' | 'test' | 'bundle' | 'other' {
  if (APP_TYPES.has(productType)) return 'app';
  if (FRAMEWORK_TYPES.has(productType)) return 'framework';
  if (UNIT_TEST_TYPES.has(productType)) return 'test';
  if (UI_TEST_TYPES.has(productType)) return 'test';
  if (BUNDLE_TYPES.has(productType)) return 'bundle';
  return 'other';
}

/** Check if a productType is a UI testing target. */
export function isXCUITest(productType: string): boolean {
  return UI_TEST_TYPES.has(productType);
}

/** Check if a productType is a unit testing target. */
export function isUnitTest(productType: string): boolean {
  return UNIT_TEST_TYPES.has(productType);
}

// ─── Regex helpers — avoid assignment-in-expression lint ───────

/**
 * Collect all regex matches without assignment-in-expression or non-null assertions.
 * Returns capturable group 1 from each match.
 */
function collectGroup1(regex: RegExp, input: string): string[] {
  // Reset lastIndex
  const re = new RegExp(regex.source, regex.flags);
  const results: string[] = [];
  let m = re.exec(input);
  while (m !== null) {
    const group = m[1];
    if (group) results.push(group);
    m = re.exec(input);
  }
  return results;
}

/**
 * Collect all regex matches returning pairs of [group1, group2].
 */
function collectGroups(regex: RegExp, input: string): Array<[string, string]> {
  const re = new RegExp(regex.source, regex.flags);
  const results: Array<[string, string]> = [];
  let m = re.exec(input);
  while (m !== null) {
    const g1 = m[1];
    const g2 = m[2];
    if (g1 && g2) results.push([g1, g2]);
    m = re.exec(input);
  }
  return results;
}

/**
 * Find the first match of a regex and return a specific group, or null.
 */
function findGroup(regex: RegExp, input: string, groupIndex: number): string | null {
  const m = regex.exec(input);
  if (!m) return null;
  const group = m[groupIndex];
  return group ?? null;
}

// ─── Parser ────────────────────────────────────────────────────

/**
 * Extract a section body from pbxproj content.
 *
 * Sections are delimited by C-style block comment markers:
 *   (open) Begin SectionName (close)
 *   ... content ...
 *   (open) End SectionName (close)
 */
function extractSection(content: string, sectionName: string): string | null {
  // pbxproj format: /* Begin <SectionName> section */
  const beginMarker = `/* Begin ${sectionName} section */`;
  const endMarker = `/* End ${sectionName} section */`;

  const beginIdx = content.indexOf(beginMarker);
  if (beginIdx === -1) return null;

  const endIdx = content.indexOf(endMarker, beginIdx);
  if (endIdx === -1) return null;

  return content.substring(beginIdx + beginMarker.length, endIdx);
}

/**
 * Parse UUID = { ... } blocks from a section body.
 * Returns a map of UUID → parsed fields (only entries matching expectedIsa).
 */
function parseEntries(
  sectionBody: string,
  expectedIsa: string,
): Map<string, Record<string, string>> {
  const entries = new Map<string, Record<string, string>>();

  // Match each UUID = { ... }; block
  // UUID is a 24-char hex string
  const blockRegex =
    /([0-9A-Fa-f]{24})\s*(?:\/\*[^*]*\*\/)?\s*=\s*\{([^}]*(?:\{[^}]*\}[^}]*)*)\}/gs;
  const matches = collectGroups(blockRegex, sectionBody);

  for (const [uuid, body] of matches) {
    const fields = parseFields(body);
    if (fields.isa === expectedIsa) {
      entries.set(uuid, fields);
    }
  }

  return entries;
}

/**
 * Parse simple key = value pairs and key = ( ... ) lists from a block body.
 */
function parseFields(body: string): Record<string, string> {
  const fields: Record<string, string> = {};

  // Key = "value"; (quoted assignments)
  const kvRegex = /(\w+)\s*=\s*"([^"]*)"/g;
  const kvPairs = collectGroups(kvRegex, body);
  for (const [key, value] of kvPairs) {
    fields[key] = value;
  }

  // Key = value; (unquoted assignments — e.g. name = MyApp)
  const unquotedRegex = /(\w+)\s*=\s*([^;\s"]+)\s*;/g;
  const unquotedPairs = collectGroups(unquotedRegex, body);
  for (const [key, value] of unquotedPairs) {
    if (!fields[key]) {
      fields[key] = value;
    }
  }

  // Key = ( ... ); (list assignments — capture everything between parens)
  const listRegex = /(\w+)\s*=\s*\(\s*([^)]*)\)/gs;
  const listPairs = collectGroups(listRegex, body);
  for (const [key, value] of listPairs) {
    fields[key] = value.trim();
  }

  // isa = ClassName; (no quotes)
  const isaVal = findGroup(/isa\s*=\s*(\w+)/, body, 1);
  if (isaVal) {
    fields.isa = isaVal;
  }

  return fields;
}

/**
 * Extract UUIDs from a dependency-list string.
 *
 * The dependencies field contains a list like:
 *   E5F6A1B2C3D4 /* MyAppTests *​/,
 *
 * We extract just the UUIDs.
 */
function extractUuids(listStr: string): string[] {
  return collectGroup1(/([0-9A-Fa-f]{24})/g, listStr);
}

// ─── Public API ────────────────────────────────────────────────

/**
 * Parse a .pbxproj file and extract target information.
 *
 * @param pbxprojPath - Absolute path to project.pbxproj
 * @returns Parsed target info or null if file not found / parse error
 */
export function parsePbxproj(pbxprojPath: string): PbxprojParseResult | null {
  if (!existsSync(pbxprojPath)) return null;

  let content: string;
  try {
    content = readFileSync(pbxprojPath, 'utf-8');
  } catch {
    return null;
  }

  // Extract root object UUID
  let rootObject = '';
  const rootObjVal = findGroup(/rootObject\s*=\s*([0-9A-Fa-f]{24})/, content, 1);
  if (rootObjVal) {
    rootObject = rootObjVal;
  }

  // Extract PBXNativeTarget entries
  const nativeTargetsSection = extractSection(content, 'PBXNativeTarget');
  if (!nativeTargetsSection) {
    return { targets: [], rootObject };
  }

  const nativeTargetEntries = parseEntries(nativeTargetsSection, 'PBXNativeTarget');

  // Extract PBXTargetDependency entries (maps dependency UUID → target UUID)
  const targetDepsSection = extractSection(content, 'PBXTargetDependency');
  const depToNativeTargetUuid = new Map<string, string>();

  if (targetDepsSection) {
    // Parse each PBXTargetDependency entry individually
    const depBlockRegex = /([0-9A-Fa-f]{24})\s*(?:\/\*[^*]*\*\/)?\s*=\s*\{([^}]+)\}/gs;
    const depMatches = collectGroups(depBlockRegex, targetDepsSection);

    // Container proxies for indirect references
    const containerProxiesSection = extractSection(content, 'PBXContainerItemProxy');

    for (const [depUuid, depBody] of depMatches) {
      // Look for `target = <UUID>` (direct reference)
      const targetVal = findGroup(/target\s*=\s*([0-9A-Fa-f]{24})/, depBody, 1);
      if (targetVal) {
        depToNativeTargetUuid.set(depUuid, targetVal);
        continue;
      }

      // Look for `targetProxy = <UUID>` (indirect reference)
      const proxyVal = findGroup(/targetProxy\s*=\s*([0-9A-Fa-f]{24})/, depBody, 1);
      if (proxyVal && containerProxiesSection) {
        // Resolve the proxy → remoteGlobalIDString
        const proxyUuid = proxyVal;
        const proxyBlockRegex = new RegExp(
          `${proxyUuid}\\s*(?:\\/\\*[^*]*\\*\\/)?\\s*=\\s*\\{([^}]+)\\}`,
          'g',
        );
        const remoteVal = findGroup(proxyBlockRegex, containerProxiesSection, 1);
        if (remoteVal) {
          const remoteIdVal = findGroup(
            /remoteGlobalIDString\s*=\s*([0-9A-Fa-f]{24})/,
            remoteVal,
            1,
          );
          if (remoteIdVal) {
            depToNativeTargetUuid.set(depUuid, remoteIdVal);
          }
        }
      }
    }
  }

  // Build UUID → name map from native target entries
  const uuidToName = new Map<string, string>();
  for (const [uuid, fields] of nativeTargetEntries) {
    if (fields.name) {
      uuidToName.set(uuid, fields.name);
    }
  }

  // Build resolved targets with dependency names resolved
  const resolvedTargets: ParsedNativeTarget[] = [];

  for (const [, fields] of nativeTargetEntries) {
    const depsStr = fields.dependencies ?? '';
    const depUuids = extractUuids(depsStr);

    // Resolve PBXTargetDependency UUID → native target UUID → name
    const resolvedDepNames: string[] = [];
    for (const depUuid of depUuids) {
      const nativeUuid = depToNativeTargetUuid.get(depUuid);
      if (nativeUuid) {
        const name = uuidToName.get(nativeUuid);
        if (name) resolvedDepNames.push(name);
      }
    }

    resolvedTargets.push({
      name: fields.name ?? '',
      productType: fields.productType ?? '',
      dependencyTargetUuids: resolvedDepNames,
    });
  }

  return { targets: resolvedTargets, rootObject };
}
