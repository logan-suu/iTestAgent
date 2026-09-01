import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { basename, join } from 'node:path';
import type {
  XcuitestExecutionAssetQuery,
  XcuitestExecutionAssets,
  XcuitestExecutionCandidate,
} from 'itestagent-contracts';
import {
  XcuitestExecutionAssetQuerySchema,
  XcuitestExecutionAssetsSchema,
} from 'itestagent-contracts';

function decodeXml(value: string): string {
  return value
    .replaceAll('&quot;', '"')
    .replaceAll('&apos;', "'")
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&amp;', '&');
}

function sharedSchemeRoots(input: XcuitestExecutionAssetQuery): string[] {
  const roots = new Set<string>();
  if (input.discovery.xcodeprojPath) {
    roots.add(join(input.discovery.xcodeprojPath, 'xcshareddata', 'xcschemes'));
  }
  if (input.discovery.xcworkspacePath) {
    roots.add(join(input.discovery.xcworkspacePath, 'xcshareddata', 'xcschemes'));
  }
  try {
    for (const entry of readdirSync(input.root, { withFileTypes: true })) {
      if (entry.isDirectory() && entry.name.endsWith('.xcodeproj')) {
        roots.add(join(input.root, entry.name, 'xcshareddata', 'xcschemes'));
      }
    }
  } catch {
    // The caller reports indeterminate when no readable shared scheme is found.
  }
  return [...roots];
}

function findSharedScheme(input: XcuitestExecutionAssetQuery, scheme: string): string | undefined {
  return sharedSchemeRoots(input)
    .map((root) => join(root, `${scheme}.xcscheme`))
    .find((candidate) => existsSync(candidate));
}

interface ParsedSchemeTestAction {
  targets: string[];
  testPlans: Array<{ name: string; isDefault: boolean }>;
}

/** Parse only the TestAction metadata needed for pre-confirmation route selection. */
export function parseSchemeTestAction(
  xml: string,
  graphTargets: readonly string[],
): ParsedSchemeTestAction {
  const testAction = xml.match(/<TestAction\b[\s\S]*?<\/TestAction>/i)?.[0];
  if (!testAction) return { targets: [], testPlans: [] };

  const graphTargetSet = new Set(graphTargets);
  const targets = new Set<string>();
  for (const match of testAction.matchAll(/\bBlueprintName\s*=\s*"([^"]+)"/gi)) {
    const target = decodeXml(match[1] ?? '');
    if (graphTargetSet.has(target)) targets.add(target);
  }

  const testPlans: Array<{ name: string; isDefault: boolean }> = [];
  for (const match of testAction.matchAll(
    /<TestPlanReference\b([^>]*)\breference\s*=\s*"container:([^"]+\.xctestplan)"([^>]*)\/?\s*>/gi,
  )) {
    const attributes = `${match[1] ?? ''} ${match[3] ?? ''}`;
    const name = basename(decodeXml(match[2] ?? ''), '.xctestplan');
    if (name.length === 0) continue;
    testPlans.push({ name, isDefault: /\bdefault\s*=\s*"YES"/i.test(attributes) });
  }
  return { targets: [...targets], testPlans };
}

function candidatesForScheme(
  input: XcuitestExecutionAssetQuery,
  scheme: string,
  schemePath: string,
): XcuitestExecutionCandidate[] {
  const parsed = parseSchemeTestAction(readFileSync(schemePath, 'utf8'), input.xcuitestTargets);
  if (parsed.targets.length === 0) return [];

  const evidence = [
    `Shared scheme metadata ${schemePath} contains a Test action referencing graph-proven XCUITest target(s): ${parsed.targets.join(', ')}.`,
    `Declared target platform kind: ${input.targetKind}.`,
  ];
  const limitations = [
    'Metadata-only discovery does not prove build, signing, installation, destination, or test runtime readiness.',
  ];

  if (parsed.testPlans.length === 0) {
    return [
      {
        scheme,
        targets: parsed.targets,
        targetKind: input.targetKind,
        isDefault: true,
        evidence,
        limitations,
      },
    ];
  }
  return parsed.testPlans.map((testPlan) => ({
    scheme,
    testPlan: testPlan.name,
    targets: parsed.targets,
    targetKind: input.targetKind,
    isDefault: testPlan.isDefault,
    evidence,
    limitations,
  }));
}

/** Discover XCUITest execution candidates without running any Xcode build or test action. */
export async function discoverXcuitestExecutionAssets(
  rawInput: XcuitestExecutionAssetQuery,
): Promise<XcuitestExecutionAssets> {
  const input = XcuitestExecutionAssetQuerySchema.parse(rawInput);
  if (input.destination && input.destination.targetKind !== input.targetKind) {
    return XcuitestExecutionAssetsSchema.parse({
      status: 'indeterminate',
      configurations: [],
      evidence: [],
      limitations: ['The selected destination targetKind does not match the requested targetKind.'],
    });
  }
  if (input.xcuitestTargets.length === 0) {
    return XcuitestExecutionAssetsSchema.parse({
      status: 'none',
      configurations: [],
      evidence: ['The project graph contains no XCUITest target.'],
      limitations: [],
    });
  }

  const configurations: XcuitestExecutionCandidate[] = [];
  const limitations: string[] = [];
  let indeterminate = false;
  for (const scheme of input.discovery.schemes) {
    const schemePath = findSharedScheme(input, scheme);
    if (!schemePath) {
      indeterminate = true;
      limitations.push(
        `Shared metadata for scheme ${scheme} was not found; candidate absence cannot be proven.`,
      );
      continue;
    }
    try {
      configurations.push(...candidatesForScheme(input, scheme, schemePath));
    } catch {
      indeterminate = true;
      limitations.push(`Shared metadata for scheme ${scheme} could not be read or parsed.`);
    }
  }

  if (indeterminate) {
    return XcuitestExecutionAssetsSchema.parse({
      status: 'indeterminate',
      configurations: [],
      evidence: [],
      limitations,
    });
  }
  return XcuitestExecutionAssetsSchema.parse({
    status: configurations.length > 0 ? 'available' : 'none',
    configurations,
    evidence: [
      `Read ${input.discovery.schemes.length} shared scheme(s) as metadata without running an Xcode build/test/archive action.`,
    ],
    limitations,
  });
}
