import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

/**
 * Parse a .gitignore file and return a list of pattern rules.
 *
 * Supports:
 *   - Comments (lines starting with #)
 *   - Negation patterns (lines starting with !)
 *   - Wildcards (* and ?)
 *   - Trailing /** for directory matching
 *   - Leading / for anchored patterns
 *
 * Used by scanSources and scanResources to honor AC3:
 * "Default exclusion: do not read .gitignore matches, secrets, DerivedData,
 * or other sensitive/irrelevant files."
 */
export interface GitignoreRule {
  /** The raw pattern text */
  pattern: string;
  /** Whether this is a negation (allow) rule */
  negation: boolean;
  /** Compiled regex for matching paths */
  regex: RegExp;
}

/** Hardcoded patterns always excluded regardless of .gitignore */
const DEFAULT_DENY_PATTERNS = [
  'DerivedData/',
  '**/xcuserdata/',
  'Pods/',
  '.build/',
  '.swiftpm/',
  'Carthage/',
  '*.xcarchive/',
  'fastlane/report.xml',
  '*.dSYM.zip',
  '*.dSYM/',
];

/** Pre-compiled regexes for default deny patterns. */
const DEFAULT_DENY_REGEXES: RegExp[] = DEFAULT_DENY_PATTERNS.map((p) => {
  const isDir = p.endsWith('/');
  const trimmed = isDir ? p.slice(0, -1) : p;
  return patternToRegex(trimmed, isDir);
});

/**
 * Compile a gitignore-style pattern into a RegExp for matching file paths.
 */
function patternToRegex(pattern: string, isDirectory: boolean): RegExp {
  let escaped = '';

  // Patterns starting with ! are handled by the caller
  const p = pattern.startsWith('!') ? pattern.slice(1) : pattern;

  let i = 0;
  const len = p.length;

  // Leading / anchors to project root
  const anchored = p.startsWith('/');
  if (anchored) {
    i = 1;
  }

  while (i < len) {
    const ch = p[i];
    switch (ch) {
      case '*': {
        // Check for **
        if (p[i + 1] === '*') {
          if (p[i + 2] === '/') {
            // **/ matches any number of directories
            escaped += anchored ? '(?:.*/)?' : '(?:.+/)?';
            i += 3;
          } else {
            // ** at end matches everything
            escaped += '.*';
            i += 2;
          }
        } else {
          escaped += '[^/]*';
          i++;
        }
        break;
      }
      case '?':
        escaped += '[^/]';
        i++;
        break;
      case '.':
      case '(':
      case ')':
      case '+':
      case '^':
      case '$':
      case '{':
      case '}':
      case '|':
      case '[':
      case ']':
      case '\\':
        escaped += `\\${ch}`;
        i++;
        break;
      default:
        escaped += ch;
        i++;
    }
  }

  if (anchored) {
    // Anchored pattern matches from root
    return new RegExp(`^${escaped}${isDirectory ? '(?:/.+)?' : '(?:/.*)?'}$`);
  }

  // Non-anchored: match anywhere in path
  if (isDirectory) {
    return new RegExp(`(?:^|/)${escaped}(?:/.+)?$`);
  }
  return new RegExp(`(?:^|/)${escaped}$`);
}

/**
 * Parse .gitignore content into a list of rules.
 * Paths should be relative to the project root (the directory containing .gitignore).
 */
export function parseGitignore(content: string): GitignoreRule[] {
  const rules: GitignoreRule[] = [];
  const lines = content.split('\n');

  for (const rawLine of lines) {
    let line = rawLine.trim();

    // Skip comments and empty lines
    if (line === '' || line.startsWith('#')) {
      continue;
    }

    // Handle negation
    const negation = line.startsWith('!');
    if (negation) {
      line = line.slice(1).trim();
    }

    // Handle trailing spaces (escaped with \)
    let pattern = line;

    // Check if it's a directory pattern (trailing /)
    const isDirectory = pattern.endsWith('/');
    if (isDirectory && !pattern.endsWith('\\/')) {
      pattern = pattern.slice(0, -1);
    }

    // Skip empty patterns after trimming /
    if (pattern === '') {
      continue;
    }

    try {
      const regex = patternToRegex(pattern, isDirectory);
      rules.push({ pattern, negation, regex });
    } catch {
      // Skip malformed patterns
    }
  }

  return rules;
}

/**
 * Load and parse .gitignore from the given directory.
 * Returns null if no .gitignore exists.
 */
export function loadGitignore(root: string): GitignoreRule[] | null {
  const gitignorePath = join(root, '.gitignore');
  if (!existsSync(gitignorePath)) {
    return null;
  }

  try {
    const content = readFileSync(gitignorePath, 'utf-8');
    return parseGitignore(content);
  } catch {
    return null;
  }
}

/**
 * Check whether a file path should be excluded.
 *
 * A path is excluded if:
 *   1. It matches any default deny pattern (DerivedData, Pods, etc.)
 *   2. It matches any .gitignore rule (unless negated)
 *
 * Path must be relative to the project root.
 *
 * AC3: Default exclusion — do not read .gitignore matches, secrets,
 * DerivedData, or other sensitive/irrelevant files.
 */
export function isIgnored(relPath: string, gitignoreRules: GitignoreRule[] | null): boolean {
  // Step 1: Check default deny patterns (always excluded)
  for (const regex of DEFAULT_DENY_REGEXES) {
    if (regex.test(relPath)) {
      return true;
    }
  }

  // Step 2: Check .gitignore rules if available
  if (!gitignoreRules) {
    return false;
  }

  let ignored = false;

  for (const rule of gitignoreRules) {
    if (rule.regex.test(relPath)) {
      ignored = !rule.negation;
    }
  }

  return ignored;
}

/**
 * Scan a directory recursively for files matching a set of extensions,
 * respecting .gitignore rules.
 *
 * Returns relative paths from root.
 */
export function collectFiles(
  root: string,
  extensions: string[],
  gitignoreRules: GitignoreRule[] | null,
): string[] {
  const results: string[] = [];

  function walk(dir: string) {
    const entries = readdirSafe(dir);
    for (const entry of entries) {
      const fullPath = join(dir, entry);
      const relPath = relative(root, fullPath);

      // Skip ignored paths
      if (isIgnored(relPath, gitignoreRules)) {
        continue;
      }

      const stat = statSafe(fullPath);
      if (stat === null) continue;

      if (stat.isDirectory()) {
        // Skip hidden directories and common non-source dirs
        if (entry.startsWith('.') && entry !== '.gitignore') {
          continue;
        }
        if (entry === 'node_modules') {
          continue;
        }
        walk(fullPath);
      } else if (stat.isFile()) {
        const ext = entry.includes('.') ? `.${entry.split('.').pop()?.toLowerCase()}` : '';
        if (extensions.includes(ext) || extensions.includes(pathExt(fullPath))) {
          results.push(relPath);
        }
      }
    }
  }

  walk(root);
  return results.sort();
}

/**
 * Safe readdir — returns [] on error.
 */
function readdirSafe(dir: string): string[] {
  try {
    return readdirSync(dir);
  } catch {
    return [];
  }
}

/**
 * Safe stat — returns null on error.
 */
function statSafe(path: string): { isDirectory(): boolean; isFile(): boolean } | null {
  try {
    return statSync(path);
  } catch {
    return null;
  }
}

/**
 * Get the last extension segment for matching (e.g., ".strings" from "Localizable.strings").
 */
function pathExt(filePath: string): string {
  const parts = filePath.split('.');
  if (parts.length < 2) return '';
  return `.${parts[parts.length - 1]}`;
}
