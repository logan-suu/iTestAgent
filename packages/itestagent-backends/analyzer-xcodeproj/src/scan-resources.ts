import { readFileSync, readdirSync, statSync } from 'node:fs';
import type { Stats } from 'node:fs';
import { join, relative } from 'node:path';
import type { ResourceFacts, ResourceScanInput } from 'itestagent-contracts';
import { collectFiles, isIgnored, loadGitignore } from './gitignore.js';

/**
 * scanResources — scan project resources (AC2: Resource scanning).
 *
 * Scans the project directory for:
 *   - Asset Catalogs (.xcassets directories)
 *   - Font files (.ttf, .otf)
 *   - Localized strings (.strings files)
 *   - Entitlements (.entitlements files)
 *   - Info.plist keys
 *
 * Respects AC3 (.gitignore, DerivedData, secrets etc.) via gitignore.ts.
 *
 * Architecture doc §5.4: scanResources(input): Promise<ResourceFacts>
 */
export async function scanResources(input: ResourceScanInput): Promise<ResourceFacts> {
  const { root } = input;
  const gitignoreRules = loadGitignore(root);

  // Asset Catalogs: find all .xcassets directories
  const assetCatalogs = findXcassetsDirectories(root, gitignoreRules);

  // Font files: find all .ttf and .otf files
  const fontFiles = collectFiles(root, ['.ttf', '.otf'], gitignoreRules);

  // Localized strings: find all .strings files
  const localizedStrings = collectFiles(root, ['.strings'], gitignoreRules);

  // Entitlements: find and parse .entitlements files
  const entitlements = findEntitlements(root, gitignoreRules);

  // Info.plist keys: find and parse Info.plist files
  const infoPlistKeys = findInfoPlistKeys(root, gitignoreRules);

  return {
    assetCatalogs: assetCatalogs.length,
    fontFiles,
    localizedStrings,
    entitlements: Object.keys(entitlements).length > 0 ? entitlements : undefined,
    infoPlistKeys,
  };
}

/**
 * Find all .xcassets directories in the project.
 * Returns full directory paths (not just names).
 */
function findXcassetsDirectories(
  root: string,
  gitignoreRules: ReturnType<typeof loadGitignore>,
): string[] {
  const results: string[] = [];

  function walk(dir: string) {
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      return;
    }

    for (const entry of entries) {
      const fullPath = join(dir, entry);

      // Check if ignored
      const relPath = relative(root, fullPath);
      if (isIgnored(relPath, gitignoreRules)) continue;

      // Skip hidden dirs
      if (entry.startsWith('.')) continue;

      let stat: Stats;
      try {
        stat = statSync(fullPath);
      } catch {
        continue;
      }

      if (stat.isDirectory()) {
        if (entry.endsWith('.xcassets')) {
          results.push(fullPath);
        } else if (entry !== 'node_modules') {
          walk(fullPath);
        }
      }
    }
  }

  walk(root);
  return results;
}

/**
 * Find and parse all .entitlements files.
 * Returns a merged record of all entitlement keys found.
 */
function findEntitlements(
  root: string,
  gitignoreRules: ReturnType<typeof loadGitignore>,
): Record<string, unknown> {
  const allKeys: Record<string, unknown> = {};
  const entitlementFiles = collectFiles(root, ['.entitlements'], gitignoreRules);

  for (const file of entitlementFiles) {
    try {
      const content = readFileSync(join(root, file), 'utf-8');
      const keys = parsePlistKeys(content);
      for (const key of keys) {
        allKeys[key] = true;
      }
    } catch {
      // Skip unreadable entitlements files
    }
  }

  return allKeys;
}

/**
 * Find and parse Info.plist files, returning the list of top-level keys.
 */
function findInfoPlistKeys(
  root: string,
  gitignoreRules: ReturnType<typeof loadGitignore>,
): string[] {
  const allKeys = new Set<string>();

  const plistFiles = collectFiles(root, ['.plist'], gitignoreRules);

  for (const file of plistFiles) {
    // Only parse files named *Info*.plist or *-Info.plist
    const basename = file.split('/').pop()?.toLowerCase() ?? '';
    if (!basename.includes('info')) continue;

    try {
      const content = readFileSync(join(root, file), 'utf-8');
      const keys = parsePlistKeys(content);
      for (const key of keys) {
        allKeys.add(key);
      }
    } catch {
      // Skip unreadable plist files
    }
  }

  return Array.from(allKeys).sort();
}

/**
 * Parse top-level keys from an XML plist string.
 * Simple regex-based extraction — does not handle all plist edge cases.
 *
 * R5: This is a simplified parser. Corner cases are noted.
 */
function parsePlistKeys(content: string): string[] {
  const keys = new Set<string>();
  const keyRegex = /<key>([^<]+)<\/key>/g;

  for (const match of content.matchAll(keyRegex)) {
    const key = match[1];
    if (!key) continue;
    keys.add(key);
  }

  return Array.from(keys);
}
