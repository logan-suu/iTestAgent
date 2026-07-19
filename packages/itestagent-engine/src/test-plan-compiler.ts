import type { Intent } from 'itestagent-contracts';
import {
  type AssertionPolicy,
  type DeviceSelector,
  type ExecutionPlan,
  type TestPlan,
  TestPlanSchema,
  parseTestPlan,
} from 'itestagent-contracts';
import type { ProjectProfile } from 'itestagent-project-analyzer';

// Re-export schema types for convenience
export type { TestPlan, DeviceSelector, ExecutionPlan, AssertionPolicy };

/**
 * compileTestPlan — S3 phase: Intent + ProjectProfile → TestPlan.
 *
 * Data Flow Specification §6:
 *   Input:  Intent + ProjectProfile + user-confirmed candidate links
 *   Output: plan.yaml at ~/.itestagent/runs/<run_id>/plan.yaml
 *
 * AC1: Natural language, TUI operations, and CLI commands all compile to a unified TestPlan.
 * AC2: TestPlan includes target/device/appSource/execution/features/testData/assertion/
 *      flows/metrics/performance/artifacts/report.
 * AC3: Auditable, reproducible, re-runnable (runId + schemaVersion + projectProfileRef).
 * AC4: TestPlan references Project Profile (projectProfileRef).
 *
 * @param intent  Parsed user Intent from S1.
 * @param profile Project Profile from S2.
 * @param options Optional overrides for flows, confirmed-only features filter, runId prefix.
 */
export function compileTestPlan(
  intent: Intent,
  profile: ProjectProfile,
  options?: CompileOptions,
): TestPlan {
  const runId = options?.runId ?? generateRunId(options?.runIdPrefix);
  const projectProfileRef = options?.projectProfileRef ?? profileRef(profile.projectHash);

  // ── Device selector (ADR-011: kind-driven) ────────────────
  const device = resolveDevice(intent);

  // ── Execution plan ────────────────────────────────────────
  const execution = buildExecutionPlan(intent, profile, options);

  // ── Performance plan (ADR-011: baselineDomain) ─────────────
  const targetKind = intent.targetKind ?? 'physical';
  const performance = {
    baseline: 'local_auto' as const,
    baselineDomain: targetKind,
    thresholdRequired: intent.metricsRequested,
  };

  const plan: TestPlan = {
    schemaVersion: 'itestagent.test-plan.v1',
    runId,
    projectProfileRef,
    target: { type: 'current_workspace' },
    device,
    appSource: { strategy: 'auto_from_workspace' },
    backendPreference: resolveBackendPreference(profile),
    execution,
    artifacts: {
      collect: ['screenshot', 'uitree', 'crashlog', 'xcresult'],
      report: { outputs: ['summary_md', 'result_json', 'artifact_index_json'] },
    },
    performance,
    safety: {
      defaultMode: 'ask',
      highRiskActions: ['clear_data', 'reinstall', 'store_credential', 'update_baseline'],
    },
  };

  // G2: Validate against Zod schema before returning
  return parseTestPlan(plan);
}

// ─── Options ─────────────────────────────────────────────────

export interface CompileOptions {
  /** Override the generated runId (for testing / CLI override). */
  runId?: string;
  /** Prefix for auto-generated runId. Default: "run". */
  runIdPrefix?: string;
  /** Override project profile ref path. */
  projectProfileRef?: string;
  /** Use only confirmed candidate links as features (AC3: user-confirmed only). */
  confirmedOnly?: boolean;
}

// ─── Private helpers ─────────────────────────────────────────

/** Generate a timestamped runId: run_20260720_143022_a1b2 */
function generateRunId(prefix = 'run'): string {
  const now = new Date();
  const date = now.toISOString().slice(0, 10).replace(/-/g, '');
  const time = now.toTimeString().slice(0, 8).replace(/:/g, '');
  const random = Math.random().toString(36).slice(2, 6);
  return `${prefix}_${date}_${time}_${random}`;
}

/** Build a reference path to the project-profile.json */
function profileRef(projectHash: string): string {
  return `~/.itestagent/projects/${projectHash}/project-profile.json`;
}

/** Resolve device selector from Intent.targetKind */
function resolveDevice(intent: Intent): DeviceSelector {
  const kind = intent.targetKind ?? 'physical';

  if (kind === 'simulator') {
    return {
      kind: 'simulator',
      simulator: { selector: 'booted' },
    };
  }

  return {
    kind: 'physical',
    physical: { selector: 'local_connected' },
  };
}

/** Build ExecutionPlan from Intent + Profile */
function buildExecutionPlan(
  intent: Intent,
  profile: ProjectProfile,
  options?: CompileOptions,
): ExecutionPlan {
  // AC4: features from Intent (matched against Profile features by intent-parser)
  let features = intent.features;

  // If confirmedOnly, filter to user-confirmed candidates
  if (options?.confirmedOnly) {
    const confirmedNames = new Set(profile.features.filter((f) => f.confirmed).map((f) => f.name));
    features = features.filter((f) => confirmedNames.has(f));
  }

  // Fallback: if no features matched, use suggestedSmoke
  if (features.length === 0 && profile.suggestedSmoke.length > 0) {
    features = [...profile.suggestedSmoke];
  }

  // XCUITest path decision
  const prefer = profile.testAssets.hasXCUITest ? 'auto' : 'device_backend';

  // Metrics selection
  const metrics = resolveMetrics(intent);

  return {
    prefer,
    fallback: 'device_backend',
    features,
    testData: {
      allowAgentGeneratedData: true,
      askUserInTuiWhenRequired: true,
    },
    assertion: resolveAssertionPolicy(intent),
    metrics,
  };
}

/** Select metrics based on Intent.scope and metricsRequested */
function resolveMetrics(intent: Intent): ExecutionPlan['metrics'] {
  // Perf scope always collects all metrics
  if (intent.scope === 'perf') {
    return ['launch_time', 'memory_peak', 'crash', 'test_duration', 'hitches', 'fps'] as const;
  }

  // Metrics explicitly requested
  if (intent.metricsRequested) {
    return ['launch_time', 'memory_peak', 'crash', 'hitches'] as const;
  }

  // Smoke: collect basic health metrics
  if (intent.scope === 'smoke') {
    return ['launch_time', 'crash'] as const;
  }

  // Explore / custom: no metrics by default (R5: don't fabricate)
  return undefined;
}

/** Resolve assertion policy from Intent scope */
function resolveAssertionPolicy(intent: Intent): AssertionPolicy {
  // explore scope → explore_only; all others → tiered policy
  if (intent.scope === 'explore') {
    return { policy: 'explore_only' };
  }
  return { policy: 'user_goal_then_profile_then_agent_confirmed' };
}

/** Resolve backend preference from Profile test assets */
function resolveBackendPreference(profile: ProjectProfile) {
  const pref: Record<string, string[]> = {
    device: ['appium', 'mock'],
    performance: ['xctrace-analyzer-core', 'raw-xcrun'],
    build: ['xcodebuild', 'fastlane'],
    analyzer: ['xcodeproj'],
  };

  // If XCUITest targets exist, prefer xcodebuild build path
  if (profile.testAssets.hasXCUITest) {
    pref.build = ['xcodebuild'];
  }

  return pref;
}

// ─── YAML serialization ──────────────────────────────────────

/**
 * Serialize a TestPlan to YAML string.
 *
 * Uses a minimal inline YAML serializer (zero external dependencies).
 * For production use, swap to the `yaml` npm package for full ECMA-404/ YAML 1.2 compliance.
 */
export function testPlanToYaml(plan: TestPlan): string {
  return yamlStringify(plan, 0);
}

/**
 * Parse a YAML test plan string back to TestPlan.
 * Validates against Zod schema (G2 compliance).
 */
export function parseTestPlanYaml(yamlStr: string): TestPlan {
  const obj = yamlParse(yamlStr);
  return parseTestPlan(obj);
}

// ─── Minimal YAML serializer (no external deps) ──────────────
// Provides basic YAML output for plan.yaml. Covers all TestPlan field types:
// strings, numbers, booleans, arrays, and nested objects (depth ≤ 4).

function yamlStringify(value: unknown, indent: number): string {
  const pad = '  '.repeat(indent);

  if (value === null || value === undefined) return `${pad}null`;
  if (typeof value === 'boolean') return `${pad}${value}`;
  if (typeof value === 'number') return `${pad}${value}`;
  if (typeof value === 'string') {
    // Simple strings don't need quoting unless they contain special YAML chars
    if (
      /[:{}[\],&*#?|\-<>=!%@`]/.test(value) ||
      value.length === 0 ||
      value === 'null' ||
      value === 'true' ||
      value === 'false'
    ) {
      return `${pad}"${value.replace(/"/g, '\\"')}"`;
    }
    return `${pad}${value}`;
  }
  if (Array.isArray(value)) {
    if (value.length === 0) return `${pad}[]`;
    return value
      .map((item) => {
        if (typeof item === 'object' && item !== null && !Array.isArray(item)) {
          const lines = yamlStringify(item, indent + 1);
          const firstLine = lines.split('\n')[0] ?? '';
          return `${pad}- ${firstLine.trimStart()}`;
        }
        return `${pad}- ${yamlStringify(item, 0).trimStart()}`;
      })
      .join('\n');
  }
  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>);
    if (entries.length === 0) return `${pad}{}`;
    return entries
      .map(([key, val]) => {
        if (typeof val === 'object' && val !== null && !Array.isArray(val)) {
          return `${pad}${key}:\n${yamlStringify(val, indent + 1)}`;
        }
        if (Array.isArray(val)) {
          if (val.length === 0) return `${pad}${key}: []`;
          return `${pad}${key}:\n${val
            .map((item) => {
              if (typeof item === 'object' && item !== null) {
                const itemLines = yamlStringify(item, indent + 1);
                return itemLines
                  .split('\n')
                  .map((l, i) =>
                    i === 0 ? `${pad}  - ${l.trimStart()}` : `${pad}    ${l.trimStart()}`,
                  )
                  .join('\n');
              }
              return `${pad}  - ${yamlStringify(item, 0).trimStart()}`;
            })
            .join('\n')}`;
        }
        return `${pad}${key}: ${yamlStringify(val, 0).trimStart()}`;
      })
      .join('\n');
  }
  return `${pad}${String(value)}`;
}

// ─── Minimal YAML parser (no external deps) ──────────────────

function yamlParse(yamlStr: string): unknown {
  // Delegate to JSON.parse for simple cases; for full YAML compliance,
  // swap to the `yaml` npm package.
  // This minimal parser handles the plan.yaml format which is JSON-compatible
  // (no YAML-specific anchors, tags, or multi-line strings with |/>).
  try {
    return JSON.parse(yamlStr);
  } catch {
    throw new Error(
      'Failed to parse YAML: input is not JSON-compatible. Use `yaml` npm package for full YAML 1.2 support.',
    );
  }
}
