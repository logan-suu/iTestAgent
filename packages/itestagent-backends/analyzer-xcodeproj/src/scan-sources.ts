import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { SourceFacts, SourceScanInput } from 'itestagent-contracts';
import { collectFiles, loadGitignore } from './gitignore.js';

/**
 * scanSources — scan Swift and Objective-C source files for structural facts.
 *
 * Scans project sources for:
 *   - Swift/ObjC file counts
 *   - ViewController declarations (UIKit and SwiftUI)
 *   - Protocol declarations
 *   - Storyboard and XIB references in code
 *
 * AC2: Swift structure detection uses regex-based pattern matching as the MVP
 * implementation. Full swift-syntax AST-based analysis is planned as a
 * pluggable enhancement (tier 2).
 *
 * R4: Inferred fields (detected via pattern matching) carry `detectionMethod: "pattern"`.
 * These are candidates, not compiler-verified facts.
 *
 * AC3: Respects .gitignore, excludes DerivedData/secrets.
 *
 * Architecture doc §5.4: scanSources(input): Promise<SourceFacts>
 */
export async function scanSources(input: SourceScanInput): Promise<SourceFacts> {
  const { root, targets, includeTestFiles } = input;
  const gitignoreRules = loadGitignore(root);

  // Collect all Swift and ObjC files
  let swiftFiles = collectFiles(root, ['.swift'], gitignoreRules);
  let objcFiles = collectFiles(root, ['.m', '.mm'], gitignoreRules);

  // Filter by target directories if specified
  if (targets && targets.length > 0) {
    swiftFiles = filterByTargets(swiftFiles, targets);
    objcFiles = filterByTargets(objcFiles, targets);
  }

  // Filter test files unless explicitly included
  if (!includeTestFiles) {
    swiftFiles = excludeTestFiles(swiftFiles);
    objcFiles = excludeTestFiles(objcFiles);
  }

  // Parse each Swift file for ViewController and protocol declarations
  const viewControllers: Array<{ name: string; file: string }> = [];
  const protocols = new Set<string>();
  const storyboardRefs = new Set<string>();
  const xibRefs = new Set<string>();

  for (const file of swiftFiles) {
    try {
      const content = readFileSync(join(root, file), 'utf-8');
      parseSwiftFile(content, file, viewControllers, protocols, storyboardRefs, xibRefs);
    } catch {
      // Skip unreadable files
    }
  }

  // Also parse ObjC files for ViewController declarations
  for (const file of objcFiles) {
    try {
      const content = readFileSync(join(root, file), 'utf-8');
      parseObjcFile(content, file, viewControllers);
    } catch {
      // Skip unreadable files
    }
  }

  return {
    swiftFiles: swiftFiles.length,
    objcFiles: objcFiles.length,
    viewControllers,
    protocols: Array.from(protocols).sort(),
    storyboardRefs: Array.from(storyboardRefs).sort(),
    xibRefs: Array.from(xibRefs).sort(),
  };
}

/**
 * Apply a regex pattern globally and invoke a callback for each match.
 * Uses String.prototype.matchAll which returns typed RegExpMatchArray
 * (capture groups are `string`, not `string | undefined`).
 */
function forEachMatch(
  content: string,
  pattern: RegExp,
  callback: (match: RegExpMatchArray) => void,
): void {
  for (const match of content.matchAll(pattern)) {
    callback(match);
  }
}

/**
 * Parse a Swift source file to extract ViewController subclasses,
 * protocol declarations, and storyboard/xib references.
 *
 * R4: Pattern-based detection — these are candidates, not verified.
 */
function parseSwiftFile(
  content: string,
  file: string,
  viewControllers: Array<{ name: string; file: string }>,
  protocols: Set<string>,
  storyboardRefs: Set<string>,
  xibRefs: Set<string>,
): void {
  // ── UIKit ViewControllers ─────────────────────────────────
  const vcPattern =
    /class\s+(\w+)\s*:\s*(?:UI\w*ViewController|UINavigationController|UITabBarController|UIPageViewController|UISplitViewController)\b/g;

  forEachMatch(content, vcPattern, (match) => {
    const name = match[1];
    if (!name) return;
    if (!viewControllers.some((vc) => vc.name === name && vc.file === file)) {
      viewControllers.push({ name, file });
    }
  });

  // ── SwiftUI Views ─────────────────────────────────────────
  const swiftuiPattern = /struct\s+(\w+)\s*:\s*(?:some\s+)?View\b/g;

  forEachMatch(content, swiftuiPattern, (match) => {
    const name = match[1];
    if (!name) return;
    if (!viewControllers.some((vc) => vc.name === name && vc.file === file)) {
      viewControllers.push({ name, file });
    }
  });

  // ── Protocol declarations ─────────────────────────────────
  const protoPattern = /protocol\s+(\w+)\s*(?:\{|:)/g;

  forEachMatch(content, protoPattern, (match) => {
    const name = match[1];
    if (!name) return;
    protocols.add(name);
  });

  // ── Storyboard references in code ─────────────────────────
  const storyboardPattern = /UIStoryboard\s*\(\s*name\s*:\s*"([^"]+)"/g;

  forEachMatch(content, storyboardPattern, (match) => {
    const name = match[1];
    if (!name) return;
    storyboardRefs.add(`${name}.storyboard`);
  });

  // ── XIB references in code ────────────────────────────────
  const nibPattern1 = /UINib\s*\(\s*nibName\s*:\s*"([^"]+)"/g;
  const nibPattern2 = /loadNibNamed\s*\(\s*"([^"]+)"/g;
  const nibPattern3 = /nibName\s*:\s*"([^"]+)"/g;

  forEachMatch(content, nibPattern1, (match) => {
    const name = match[1];
    if (!name) return;
    xibRefs.add(`${name}.xib`);
  });
  forEachMatch(content, nibPattern2, (match) => {
    const name = match[1];
    if (!name) return;
    xibRefs.add(`${name}.xib`);
  });
  forEachMatch(content, nibPattern3, (match) => {
    const name = match[1];
    if (!name) return;
    xibRefs.add(`${name}.xib`);
  });
}

/**
 * Parse an Objective-C source file for ViewController declarations.
 */
function parseObjcFile(
  content: string,
  file: string,
  viewControllers: Array<{ name: string; file: string }>,
): void {
  const pattern =
    /@interface\s+(\w+)\s*:\s*(?:UI\w*ViewController|UINavigationController|UITabBarController)\b/g;

  forEachMatch(content, pattern, (match) => {
    const name = match[1];
    if (!name) return;
    if (!viewControllers.some((vc) => vc.name === name && vc.file === file)) {
      viewControllers.push({ name, file });
    }
  });
}

/**
 * Filter file paths to only include those within specified target directories.
 */
function filterByTargets(files: string[], targets: string[]): string[] {
  return files.filter((file) =>
    targets.some((target) => file.startsWith(`${target}/`) || file.startsWith(target)),
  );
}

/**
 * Exclude test files from the list.
 *
 * Excludes files in directories named "Tests", "Test", "Specs",
 * or files ending with "Tests.swift", "Test.swift", "Spec.swift".
 */
function excludeTestFiles(files: string[]): string[] {
  return files.filter((file) => {
    const parts = file.split('/');
    // Check if any directory component is a test directory
    for (const part of parts) {
      const lower = part.toLowerCase();
      if (lower === 'tests' || lower === 'test' || lower === 'specs' || lower === '__tests__') {
        return false;
      }
    }
    // Check if the file name ends with test patterns
    const basename = parts[parts.length - 1];
    if (typeof basename !== 'string') return true;
    if (
      basename.endsWith('Tests.swift') ||
      basename.endsWith('Test.swift') ||
      basename.endsWith('Spec.swift') ||
      basename.endsWith('Tests.m') ||
      basename.endsWith('Test.m')
    ) {
      return false;
    }
    return true;
  });
}
