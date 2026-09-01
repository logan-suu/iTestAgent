import type {
  RunnableXcuitestConfiguration,
  XcuitestExecutionAssetQuery,
  XcuitestExecutionAssets,
} from 'itestagent-contracts';
import {
  XcuitestExecutionAssetQuerySchema,
  XcuitestExecutionAssetsSchema,
} from 'itestagent-contracts';
import { runCommand } from './xcodebuild-exec.js';

function projectArgs(input: XcuitestExecutionAssetQuery): string[] {
  if (input.discovery.xcworkspacePath) {
    return ['-workspace', input.discovery.xcworkspacePath];
  }
  if (input.discovery.xcodeprojPath) {
    return ['-project', input.discovery.xcodeprojPath];
  }
  return [];
}

function destinationArgument(targetKind: XcuitestExecutionAssetQuery['targetKind']): string {
  return targetKind === 'physical' ? 'generic/platform=iOS' : 'generic/platform=iOS Simulator';
}

/** Parse the indented values printed by `xcodebuild -showTestPlans`. */
export function parseShowTestPlans(stdout: string): string[] {
  const plans: string[] = [];
  let inList = false;
  for (const rawLine of stdout.split('\n')) {
    const line = rawLine.trim();
    if (/^Test plans associated with (?:the )?scheme\b/i.test(line)) {
      inList = true;
      continue;
    }
    if (!inList || line.length === 0 || line.endsWith(':')) continue;
    if (/^(Information about|If no test plan)/i.test(line)) continue;
    plans.push(line.replace(/\s+\(default\)$/i, ''));
  }
  return [...new Set(plans)];
}

function collectMatchingTargets(
  value: unknown,
  knownTargets: ReadonlySet<string>,
  found: Set<string>,
): void {
  if (typeof value === 'string') {
    for (const target of knownTargets) {
      if (value === target || value.startsWith(`${target}/`)) found.add(target);
    }
    return;
  }
  if (Array.isArray(value)) {
    for (const entry of value) collectMatchingTargets(entry, knownTargets, found);
    return;
  }
  if (typeof value === 'object' && value !== null) {
    for (const entry of Object.values(value as Record<string, unknown>)) {
      collectMatchingTargets(entry, knownTargets, found);
    }
  }
}

/** Extract only graph-proven XCUITest targets from enumeration JSON. */
export function parseEnumeratedXcuitestTargets(
  stdout: string,
  knownTargets: readonly string[],
): string[] {
  const parsed = JSON.parse(stdout) as unknown;
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error('enumeration output is not an object');
  }
  const errors = (parsed as { errors?: unknown }).errors;
  if (errors !== undefined && !Array.isArray(errors)) {
    throw new Error('enumeration errors field is malformed');
  }
  if (Array.isArray(errors)) {
    const unexpected = errors.filter(
      (error) =>
        typeof error !== 'string' || !/Tests must be run on a concrete device/i.test(error),
    );
    if (unexpected.length > 0) throw new Error('enumeration reported an unexpected error');
  }
  const found = new Set<string>();
  collectMatchingTargets(parsed, new Set(knownTargets), found);
  return knownTargets.filter((target) => found.has(target));
}

function enumerateConfiguration(
  input: XcuitestExecutionAssetQuery,
  scheme: string,
  testPlan: string | undefined,
): { configuration?: RunnableXcuitestConfiguration; limitation?: string } {
  const args = [
    'test',
    ...projectArgs(input),
    '-scheme',
    scheme,
    '-destination',
    destinationArgument(input.targetKind),
    'CODE_SIGNING_ALLOWED=NO',
    ...(testPlan ? ['-testPlan', testPlan] : []),
    '-quiet',
    '-enumerate-tests',
    '-test-enumeration-style',
    'hierarchical',
    '-test-enumeration-format',
    'json',
    '-test-enumeration-output-path',
    '-',
  ];
  const result = runCommand('xcodebuild', args, input.root);
  if (result.exitCode !== 0) {
    return {
      limitation: `XCUITest enumeration failed for scheme ${scheme}${testPlan ? ` / test plan ${testPlan}` : ''} with exit ${result.exitCode}; inspect the local xcodebuild log.`,
    };
  }

  let targets: string[];
  try {
    targets = parseEnumeratedXcuitestTargets(result.stdout, input.xcuitestTargets);
  } catch {
    return {
      limitation: `XCUITest enumeration JSON was invalid for scheme ${scheme}${testPlan ? ` / test plan ${testPlan}` : ''}; inspect the local xcodebuild log.`,
    };
  }
  if (targets.length === 0) {
    return {
      limitation: `Scheme ${scheme}${testPlan ? ` / test plan ${testPlan}` : ''} enumerated no graph-proven XCUITest target.`,
    };
  }

  return {
    configuration: {
      scheme,
      ...(testPlan ? { testPlan } : {}),
      targets,
      targetKind: input.targetKind,
      isDefault: testPlan === undefined,
      evidence: [
        `Non-installing generic-platform xcodebuild test enumeration succeeded in resolving scheme ${scheme}${testPlan ? ` and test plan ${testPlan}` : ' using its configured default test plan'}.`,
        `Enumerated XCUITest targets: ${targets.join(', ')}.`,
        `Target platform kind verified without selecting a concrete destination: ${input.targetKind}.`,
      ],
      limitations: [
        'Concrete destination build, signing, installation, and launch readiness are deferred until confirmed execution.',
      ],
    },
  };
}

/** Resolve runnable scheme/Test action/test plan configurations via xcodebuild. */
export async function discoverXcuitestExecutionAssets(
  rawInput: XcuitestExecutionAssetQuery,
): Promise<XcuitestExecutionAssets> {
  const input = XcuitestExecutionAssetQuerySchema.parse(rawInput);
  if (input.destination && input.destination.targetKind !== input.targetKind) {
    return XcuitestExecutionAssetsSchema.parse({
      configurations: [],
      evidence: [],
      limitations: ['The selected destination targetKind does not match the requested targetKind.'],
    });
  }
  if (input.xcuitestTargets.length === 0) {
    return XcuitestExecutionAssetsSchema.parse({
      configurations: [],
      evidence: ['The project graph contains no XCUITest target.'],
      limitations: [],
    });
  }

  const configurations: RunnableXcuitestConfiguration[] = [];
  const limitations: string[] = [];
  for (const scheme of input.discovery.schemes) {
    const plansResult = runCommand(
      'xcodebuild',
      [...projectArgs(input), '-scheme', scheme, '-showTestPlans'],
      input.root,
    );
    const testPlans = plansResult.exitCode === 0 ? parseShowTestPlans(plansResult.stdout) : [];
    if (plansResult.exitCode !== 0) {
      limitations.push(
        `Test-plan discovery failed for scheme ${scheme} with exit ${plansResult.exitCode}; inspect the local xcodebuild log.`,
      );
    }

    for (const testPlan of [undefined, ...testPlans]) {
      const result = enumerateConfiguration(input, scheme, testPlan);
      if (result.configuration) configurations.push(result.configuration);
      if (result.limitation) limitations.push(result.limitation);
    }
  }

  return XcuitestExecutionAssetsSchema.parse({
    configurations,
    evidence: [
      `Evaluated ${input.discovery.schemes.length} scheme(s) against ${input.xcuitestTargets.length} graph-proven XCUITest target(s).`,
    ],
    limitations,
  });
}
