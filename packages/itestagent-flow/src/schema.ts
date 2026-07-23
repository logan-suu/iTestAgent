/**
 * Flow v2 Zod schemas — replayable iTestAgent Flow YAML.
 *
 * Task 3.15: Flow compilation from RecordingResult → FlowV2 YAML.
 * Schema v2 per ADR-011 §8: adds supportedTargetKinds, requiredCapabilities,
 * lastValidatedTargets for multi-target flow portability.
 *
 * US-9.2 AC1: Level 2 Replayable Flow — self-owned iTestAgent Flow YAML.
 * US-9.2 AC3: Flow contains flowId/source/status/steps.
 */
import { z } from 'zod';

// ─── Locator (normalized, not Appium-specific) ────────────────────

/**
 * Normalized element locator.
 *
 * Architecture §6.7: "归一化元素定位，不保存 Appium-specific locator".
 * Strategy set mirrors the v1 schema: label, identifier, xpath, coordinate, image.
 */
export const LocatorV2Schema = z.object({
  strategy: z.enum(['label', 'identifier', 'xpath', 'coordinate', 'image']),
  value: z.string(),
});
export type LocatorV2 = z.infer<typeof LocatorV2Schema>;

// ─── Flow Step ────────────────────────────────────────────────────

/**
 * Normalized Flow step action enum.
 *
 * Mirrors DeviceBackend interface actions plus assertions and flow-control
 * actions. Kept as a constrained enum to guarantee cross-backend portability.
 */
const FlowActionEnum = z.enum([
  'launchApp',
  'terminateApp',
  'tap',
  'longPress',
  'swipe',
  'typeText',
  'pressButton',
  'openUrl',
  'screenshot',
  'getUiTree',
  'startRecording',
  'stopRecording',
  'collectLogs',
  'assertVisible',
  'assertNotVisible',
  'assertText',
  'wait',
  'comment',
]);

export const FlowStepV2Schema = z.object({
  action: FlowActionEnum,
  /** Human-readable target description or locator label */
  target: z.string().optional(),
  /** Normalized locator (not Appium-specific) */
  locator: LocatorV2Schema.optional(),
  /** Reference to test data. session.secret.* for sensitive data (R6: only in-memory) */
  valueRef: z.string().optional(),
  /** Inline literal value (non-sensitive data only) */
  value: z.unknown().optional(),
  /** Duration in ms for wait/longPress/swipe */
  durationMs: z.number().int().nonnegative().optional(),
  /** Swipe direction */
  direction: z.enum(['up', 'down', 'left', 'right']).optional(),
  /** Expected text for assertText action */
  expectedText: z.string().optional(),
  /** Comment text for comment action or unmapped actions */
  comment: z.string().optional(),
  /** Safety gate for irreversible operations (R7) */
  safetyGate: z.enum(['allow', 'ask', 'deny']).optional(),
});
export type FlowStepV2 = z.infer<typeof FlowStepV2Schema>;

// ─── Validated Target ─────────────────────────────────────────────

/**
 * Audit trail entry for a device that validated this flow.
 *
 * Two-layer strategy (ADR-011 audit recommendation):
 *   - Base data (udid, kind) is always recorded at compile time.
 *   - Full device info (deviceTypeIdentifier, runtimeIdentifier, model, osVersion)
 *     is populated lazily by the replay engine when available.
 */
export const ValidatedTargetSchema = z.object({
  kind: z.enum(['physical', 'simulator']),
  udid: z.string(),
  /** Simulator: com.apple.CoreSimulator.SimDeviceType.iPhone-15-Pro */
  deviceTypeIdentifier: z.string().optional(),
  /** Simulator: com.apple.CoreSimulator.SimRuntime.iOS-18-2 */
  runtimeIdentifier: z.string().optional(),
  /** Physical: iPhone 14 Plus */
  model: z.string().optional(),
  /** Physical: 18.2.1 */
  osVersion: z.string().optional(),
});
export type ValidatedTarget = z.infer<typeof ValidatedTargetSchema>;

// ─── Flow v2 ──────────────────────────────────────────────────────

/**
 * Flow v2 schema — replayable iTestAgent Flow YAML.
 *
 * Architecture §6.7 defines the v2 template with ADR-011 fields.
 * US-9.2 AC3: Flow contains flowId/source/status/steps.
 */
export const FlowV2Schema = z
  .object({
    schemaVersion: z.literal('itestagent.flow.v2'),
    flowId: z.string().min(1),
    source: z.enum(['agent-recorded', 'user-authored', 'imported-draft']),
    status: z.enum(['draft', 'confirmed', 'deprecated']),
    /** Target kinds this flow supports (ADR-011) */
    supportedTargetKinds: z.array(z.enum(['physical', 'simulator'])).min(1),
    /** Normalized backend capabilities required for replay */
    requiredCapabilities: z.array(z.string()).min(1),
    /** Audit trail of validated devices */
    lastValidatedTargets: z.array(ValidatedTargetSchema),
    steps: z.array(FlowStepV2Schema).min(1),
    notes: z.string().optional(),
  })
  .strict();
export type FlowV2 = z.infer<typeof FlowV2Schema>;

// ─── Helpers ──────────────────────────────────────────────────────

/**
 * Parse and validate a FlowV2 object.
 * Throws ZodError on validation failure.
 */
export function parseFlowV2(data: unknown): FlowV2 {
  return FlowV2Schema.parse(data);
}

/**
 * Safely parse a FlowV2 object.
 * Returns { success: true, data } or { success: false, error }.
 */
export function safeParseFlowV2(
  data: unknown,
): { success: true; data: FlowV2 } | { success: false; error: z.ZodError } {
  return FlowV2Schema.safeParse(data);
}
