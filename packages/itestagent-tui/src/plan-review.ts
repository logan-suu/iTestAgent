/**
 * Plan review mode — pure functions for TestPlan display and interaction.
 *
 * US-5.2 AC1-AC3:
 *   AC1: display device, execution, features, metrics, baseline, estimated time
 *   AC2: natural language plan modification
 *   AC3: not confirmed → not executed
 *
 * This module is framework-independent and testable without a renderer.
 * Follows the same pattern as candidate-review.ts.
 */
import type { TestPlan } from 'itestagent-contracts';

// ─── Types ───────────────────────────────────────────────────

/** Ordered plan sections for TUI navigation. */
export const PLAN_SECTIONS = [
  'overview',
  'device',
  'execution',
  'features',
  'metrics',
  'performance',
  'safety',
] as const;

export type PlanSectionId = (typeof PLAN_SECTIONS)[number];

/** A single display field within a plan section. */
export interface PlanField {
  key: string;
  label: string;
  value: string;
  /** Visual hint for the TUI renderer. */
  kind: 'text' | 'list' | 'enum' | 'boolean' | 'duration';
  /** Whether the user can modify this field (AC2). */
  editable: boolean;
}

/** A navigable section of the TestPlan display. */
export interface PlanSection {
  id: PlanSectionId;
  title: string;
  fields: PlanField[];
}

/** Result of a plan review action. */
export type PlanReviewAction = 'start' | 'cancel';

// ─── Section formatters ──────────────────────────────────────

function formatOverviewSection(plan: TestPlan): PlanSection {
  const duration = formatEstimatedDuration(plan.execution.features);
  const backendLabel =
    plan.backendPreference.device && plan.backendPreference.device.length > 0
      ? plan.backendPreference.device.join(', ')
      : '(default)';

  return {
    id: 'overview',
    title: 'Overview',
    fields: [
      { key: 'target', label: 'Target', value: plan.target.type, kind: 'text', editable: false },
      {
        key: 'appSource',
        label: 'App Source',
        value: plan.appSource.strategy,
        kind: 'text',
        editable: false,
      },
      {
        key: 'deviceBackend',
        label: 'Backend',
        value: backendLabel,
        kind: 'text',
        editable: false,
      },
      {
        key: 'estimatedDuration',
        label: 'Est. Duration',
        value: duration,
        kind: 'duration',
        editable: false,
      },
    ],
  };
}

function formatDeviceSection(plan: TestPlan): PlanSection {
  const fields: PlanField[] = [
    {
      key: 'kind',
      label: 'Target Kind',
      value: plan.device.kind,
      kind: 'enum',
      editable: true,
    },
  ];

  if (plan.device.kind === 'physical' && plan.device.physical) {
    fields.push({
      key: 'selector',
      label: 'Selector',
      value: plan.device.physical.selector,
      kind: 'enum',
      editable: true,
    });
    if (plan.device.physical.udid) {
      fields.push({
        key: 'udid',
        label: 'UDID',
        value: plan.device.physical.udid,
        kind: 'text',
        editable: true,
      });
    }
  }

  if (plan.device.kind === 'simulator' && plan.device.simulator) {
    fields.push({
      key: 'selector',
      label: 'Selector',
      value: plan.device.simulator.selector,
      kind: 'enum',
      editable: true,
    });
    if (plan.device.simulator.name) {
      fields.push({
        key: 'name',
        label: 'Name',
        value: plan.device.simulator.name,
        kind: 'text',
        editable: true,
      });
    }
  }

  return { id: 'device', title: 'Device', fields };
}

function formatExecutionSection(plan: TestPlan): PlanSection {
  return {
    id: 'execution',
    title: 'Execution',
    fields: [
      {
        key: 'prefer',
        label: 'Prefer',
        value: plan.execution.prefer,
        kind: 'enum',
        editable: true,
      },
      {
        key: 'fallback',
        label: 'Fallback',
        value: plan.execution.fallback,
        kind: 'enum',
        editable: true,
      },
      {
        key: 'assertion',
        label: 'Assertion',
        value: plan.execution.assertion.policy,
        kind: 'enum',
        editable: true,
      },
    ],
  };
}

function formatFeaturesSection(plan: TestPlan): PlanSection {
  const features = plan.execution.features;
  const fields: PlanField[] = [
    {
      key: 'features',
      label: 'Features',
      value: features.length > 0 ? features.join(', ') : '(none)',
      kind: 'list',
      editable: true,
    },
  ];

  if (plan.execution.flows && plan.execution.flows.length > 0) {
    fields.push({
      key: 'flows',
      label: 'Flows',
      value: plan.execution.flows.join(', '),
      kind: 'list',
      editable: true,
    });
  }

  return { id: 'features', title: 'Features & Flows', fields };
}

function formatMetricsSection(plan: TestPlan): PlanSection {
  const metrics = plan.execution.metrics ?? [];
  return {
    id: 'metrics',
    title: 'Metrics',
    fields: [
      {
        key: 'metrics',
        label: 'Collect',
        value: metrics.length > 0 ? metrics.join(', ') : '(none)',
        kind: 'list',
        editable: true,
      },
      {
        key: 'artifacts',
        label: 'Artifacts',
        value: plan.artifacts.collect.join(', '),
        kind: 'list',
        editable: true,
      },
    ],
  };
}

function formatPerformanceSection(plan: TestPlan): PlanSection {
  return {
    id: 'performance',
    title: 'Performance',
    fields: [
      {
        key: 'baseline',
        label: 'Baseline',
        value: plan.performance.baseline,
        kind: 'enum',
        editable: true,
      },
      {
        key: 'baselineDomain',
        label: 'Domain',
        value: plan.performance.baselineDomain,
        kind: 'enum',
        editable: false,
      },
    ],
  };
}

function formatSafetySection(plan: TestPlan): PlanSection {
  return {
    id: 'safety',
    title: 'Safety',
    fields: [
      {
        key: 'defaultMode',
        label: 'Default Mode',
        value: plan.safety.defaultMode,
        kind: 'enum',
        editable: true,
      },
      {
        key: 'highRiskActions',
        label: 'High Risk',
        value: plan.safety.highRiskActions.join(', '),
        kind: 'list',
        editable: true,
      },
    ],
  };
}

// ─── Public API ──────────────────────────────────────────────

/**
 * Format a TestPlan into navigable display sections.
 *
 * AC1: Shows device, execution method, features/flows,
 *      metrics/artifacts, baseline, and estimated duration.
 *
 * @param plan - The compiled TestPlan to display
 * @returns 7 ordered sections for TUI navigation
 */
export function formatPlanSections(plan: TestPlan): PlanSection[] {
  return [
    formatOverviewSection(plan),
    formatDeviceSection(plan),
    formatExecutionSection(plan),
    formatFeaturesSection(plan),
    formatMetricsSection(plan),
    formatPerformanceSection(plan),
    formatSafetySection(plan),
  ];
}

/**
 * Navigate between plan sections with wrap-around.
 *
 * @param currentIndex - Current section index (0-based)
 * @param direction - Navigation direction
 * @param total - Total number of sections
 * @returns New section index
 */
export function navigatePlanSection(
  currentIndex: number,
  direction: 'up' | 'down',
  total: number,
): number {
  if (total <= 1) return 0;
  const delta = direction === 'down' ? 1 : -1;
  return (currentIndex + delta + total) % total;
}

/**
 * Format the execution path for display.
 *
 * Examples:
 *   - "auto (XCUITest preferred, device_backend fallback)"
 *   - "xcuitest only (abort on failure)"
 *   - "device_backend (exploration only)"
 */
export function formatExecutionPath(prefer: string, fallback: string): string {
  const preferLabel = prefer === 'auto' ? 'auto (XCUITest preferred)' : prefer;
  const fallbackLabel = fallback === 'abort' ? 'abort on failure' : `${fallback} fallback`;
  return `${preferLabel}, ${fallbackLabel}`;
}

/**
 * Estimate execution duration based on feature count.
 *
 * Rough heuristic: ~1-2 min per feature for exploration.
 * Returns a human-readable string.
 */
export function formatEstimatedDuration(features: string[]): string {
  const count = features.length;
  if (count === 0) return '~1 min';
  if (count <= 2) return '~3 min';
  if (count <= 5) return '~8 min';
  if (count <= 10) return '~15 min';
  return '~25 min';
}
