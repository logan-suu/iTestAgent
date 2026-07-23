/**
 * Flow YAML serializer — converts FlowV2 object to YAML string.
 *
 * Task 3.15: FlowV2 → YAML serialization for file persistence.
 * US-9.2 AC1: Level 2 Replayable Flow — self-owned iTestAgent Flow YAML.
 *
 * Uses the `yaml` package (already a workspace dependency in itestagent-engine).
 * Produces human-readable YAML with header comments for flow context.
 */
import { stringify } from 'yaml';
import type { FlowStepV2, FlowV2 } from './schema.js';

// ─── Header Comment Generator ─────────────────────────────────────

/**
 * Generate a YAML header comment with human-readable flow context.
 *
 * The comment includes metadata that is useful for humans reading the file
 * but is not part of the machine-readable flow structure.
 */
function buildHeaderComment(flow: FlowV2): string {
  const lines = [
    '# iTestAgent Flow v2',
    `# flowId: ${flow.flowId}`,
    `# source: ${flow.source}`,
    `# status: ${flow.status}`,
    `# supported targets: ${flow.supportedTargetKinds.join(', ')}`,
    `# capabilities: ${flow.requiredCapabilities.join(', ')}`,
  ];

  if (flow.lastValidatedTargets.length > 0) {
    lines.push('# validated on:');
    for (const target of flow.lastValidatedTargets) {
      const kind = target.kind;
      const id = target.deviceTypeIdentifier ?? target.model ?? target.udid;
      const version = target.runtimeIdentifier ?? target.osVersion ?? '';
      lines.push(`#   - ${kind}: ${id}${version ? ` (${version})` : ''}`);
    }
  }

  lines.push('#');
  return `${lines.join('\n')}\n`;
}

// ─── Step Normalizer ──────────────────────────────────────────────

/**
 * Clean a FlowStepV2 for YAML serialization.
 *
 * Removes undefined fields to keep YAML output clean.
 * Converts the typed FlowStepV2 to a plain object for yaml.stringify.
 */
function cleanStep(step: FlowStepV2): Record<string, unknown> {
  const out: Record<string, unknown> = { action: step.action };

  if (step.target !== undefined) out.target = step.target;
  if (step.locator !== undefined) {
    out.locator = {
      strategy: step.locator.strategy,
      value: step.locator.value,
    };
  }
  if (step.valueRef !== undefined) out.valueRef = step.valueRef;
  if (step.value !== undefined) out.value = step.value;
  if (step.durationMs !== undefined) out.durationMs = step.durationMs;
  if (step.direction !== undefined) out.direction = step.direction;
  if (step.expectedText !== undefined) out.expectedText = step.expectedText;
  if (step.comment !== undefined) out.comment = step.comment;
  if (step.safetyGate !== undefined) out.safetyGate = step.safetyGate;

  return out;
}

// ─── Main Serializer ──────────────────────────────────────────────

/**
 * Serialize a FlowV2 object to a YAML string.
 *
 * Output format:
 *   - Header comment with human-readable context
 *   - YAML-encoded flow with schemaVersion first
 *   - Clean, no undefined fields
 *
 * @param flow - The FlowV2 object to serialize
 * @returns YAML string ready for file write
 */
export function serializeFlowYaml(flow: FlowV2): string {
  const header = buildHeaderComment(flow);

  // Build the plain object for yaml.stringify
  const doc: Record<string, unknown> = {
    schemaVersion: flow.schemaVersion,
    flowId: flow.flowId,
    source: flow.source,
    status: flow.status,
    supportedTargetKinds: flow.supportedTargetKinds,
    requiredCapabilities: flow.requiredCapabilities,
    lastValidatedTargets: flow.lastValidatedTargets.map((t) => {
      const entry: Record<string, unknown> = {
        kind: t.kind,
        udid: t.udid,
      };
      if (t.deviceTypeIdentifier) entry.deviceTypeIdentifier = t.deviceTypeIdentifier;
      if (t.runtimeIdentifier) entry.runtimeIdentifier = t.runtimeIdentifier;
      if (t.model) entry.model = t.model;
      if (t.osVersion) entry.osVersion = t.osVersion;
      return entry;
    }),
    steps: flow.steps.map(cleanStep),
  };
  if (flow.notes) doc.notes = flow.notes;

  // yaml.stringify with default options (flow style disabled, indented blocks)
  const body = stringify(doc, {
    lineWidth: 0, // no line wrapping for readability
  });

  return header + body;
}

/**
 * Parse a YAML string back to a FlowV2 object.
 *
 * Uses the `yaml` package's parse function. Does NOT validate —
 * callers should run safeParseFlowV2() after parsing.
 *
 * @param yamlStr - The YAML string to parse
 * @returns Parsed object (unvalidated)
 */
export function parseFlowYaml(yamlStr: string): unknown {
  const { parse } = require('yaml');
  return parse(yamlStr);
}
