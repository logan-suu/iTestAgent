/**
 * replay-step-complete.test.ts — B08 coverage for the extracted step
 * dispatcher (promotion guide §11.3 "Flow replay/redaction").
 *
 * executeStep was split out of the former 919-line replay.ts monolith.
 * This suite locks the control-flow contract that replay.test.ts exercises
 * only end-to-end:
 *
 *   - safetyGate: deny → skipped; ask without callback → skipped;
 *     ask denied by callback → skipped; ask approved → executes (R7)
 *   - no-backend fast paths: comment / wait pass without a backend call
 *   - pre-aborted signal → skipped before any backend interaction
 *   - unknown action → blocked (R5: explicit, never silently dropped)
 *   - R6 defense-in-depth: unresolved session.secret.* valueRef → failed
 *   - getUiTree observation applies UI-tree redaction before reporting
 */
import { describe, expect, it } from 'bun:test';
import type { DeviceBackend, UiTreeSnapshot } from 'itestagent-contracts';
import { executeStep } from '../src/replay-step.js';
import type { FlowStepV2 } from '../src/schema.js';
import { redactUiTreeXml } from '../src/ui-tree-redactor.js';

/** Backend whose every method throws — enough for control-flow-only steps. */
const throwingBackend = {
  name: 'throwing-b08',
  async launchApp(): Promise<void> {
    throw new Error('should not be called');
  },
  async getUiTree(): Promise<UiTreeSnapshot> {
    throw new Error('no uiTree configured');
  },
} as unknown as DeviceBackend;

function run(
  step: FlowStepV2,
  opts: {
    signal?: AbortSignal;
    onSafetyGate?: (s: FlowStepV2) => Promise<boolean>;
    collectEvidence?: boolean;
  } = {},
) {
  return executeStep(
    step,
    0,
    opts.signal !== undefined || opts.onSafetyGate !== undefined
      ? throwingBackend
      : throwingBackend,
    'device-b08',
    undefined,
    opts.signal,
    opts.collectEvidence ?? false,
    opts.onSafetyGate,
  );
}

describe('executeStep safetyGate contract (R7)', () => {
  it('deny gate skips the step with an explicit reason', async () => {
    const step = { action: 'tap', safetyGate: 'deny' } as unknown as FlowStepV2;
    const result = await run(step);
    expect(result.status).toBe('skipped');
    expect(result.error).toContain('"deny"');
  });

  it('ask gate without a callback skips the step', async () => {
    const step = { action: 'tap', safetyGate: 'ask' } as unknown as FlowStepV2;
    const result = await run(step);
    expect(result.status).toBe('skipped');
    expect(result.error).toContain('no onSafetyGate callback');
  });

  it('ask gate denied by the callback skips the step', async () => {
    const step = { action: 'tap', safetyGate: 'ask' } as unknown as FlowStepV2;
    const result = await run(step, { onSafetyGate: async () => false });
    expect(result.status).toBe('skipped');
    expect(result.error).toContain('user denied');
  });

  it('ask gate approved by the callback lets a comment step pass', async () => {
    const step = {
      action: 'comment',
      comment: 'approved note',
      safetyGate: 'ask',
    } as unknown as FlowStepV2;
    const result = await run(step, { onSafetyGate: async () => true });
    expect(result.status).toBe('passed');
    expect(result.detail).toBe('approved note');
  });
});

describe('executeStep no-backend fast paths', () => {
  it('comment passes with zero duration and passthrough detail', async () => {
    const step = { action: 'comment', comment: 'note' } as unknown as FlowStepV2;
    const result = await run(step);
    expect(result.status).toBe('passed');
    expect(result.durationMs).toBe(0);
    expect(result.detail).toBe('note');
  });

  it('wait honors durationMs (>=50ms)', async () => {
    const step = { action: 'wait', durationMs: 50 } as unknown as FlowStepV2;
    const result = await run(step);
    expect(result.status).toBe('passed');
    expect(result.durationMs).toBeGreaterThanOrEqual(50);
  });
});

describe('executeStep failure semantics', () => {
  it('pre-aborted signal skips before backend interaction', async () => {
    const controller = new AbortController();
    controller.abort();
    const step = {
      action: 'tap',
      locator: { strategy: 'coordinate', value: '0.5,0.5' },
    } as unknown as FlowStepV2;
    const result = await run(step, { signal: controller.signal });
    expect(result.status).toBe('skipped');
    expect(result.error).toContain('aborted before');
  });

  it('unknown action is blocked, never silently dropped (R5)', async () => {
    const step = { action: 'timeTravel' } as unknown as FlowStepV2;
    const result = await run(step);
    expect(result.status).toBe('blocked');
    expect(result.error).toContain('timeTravel');
  });

  it('unresolved session.secret.* valueRef fails with an R6 message', async () => {
    const step = {
      action: 'typeText',
      valueRef: 'session.secret.password',
      value: 'session.secret.password',
    } as unknown as FlowStepV2;
    const result = await run(step);
    expect(result.status).toBe('failed');
    expect(result.error).toContain('R6');
  });
});

describe('getUiTree observation applies UI-tree redaction (B08)', () => {
  it('marks the artifact redacted and reports the count for sensitive fields', async () => {
    const xml =
      '<?xml?><XCUIElementTypeTextField name="user" value="alice" x="0" y="0" width="10" height="10" />' +
      '<XCUIElementTypeSecureTextField name="pw" value="hunter2" x="0" y="20" width="10" height="10" />';
    const backend = {
      name: 'redact-b08',
      async getUiTree(): Promise<UiTreeSnapshot> {
        return { raw: xml } as UiTreeSnapshot;
      },
    } as unknown as DeviceBackend;
    const step = { action: 'getUiTree' } as unknown as FlowStepV2;
    const result = await executeStep(
      step,
      3,
      backend,
      'device-b08',
      undefined,
      undefined,
      false,
      undefined,
    );
    expect(result.status).toBe('passed');
    expect(result.evidence[0]?.redactionStatus).toBe('redacted');
    expect(result.detail).toContain('1 value(s) redacted');
  });

  it('keeps plain captures untouched (safe, original length)', async () => {
    const xml = '<XCUIElementTypeButton name="Go" value="Go" x="0" y="0" width="10" height="10" />';
    const backend = {
      name: 'redact-b08-clean',
      async getUiTree(): Promise<UiTreeSnapshot> {
        return { raw: xml } as UiTreeSnapshot;
      },
    } as unknown as DeviceBackend;
    const step = { action: 'getUiTree' } as unknown as FlowStepV2;
    const result = await executeStep(
      step,
      4,
      backend,
      'device-b08',
      undefined,
      undefined,
      false,
      undefined,
    );
    expect(result.evidence[0]?.redactionStatus).toBe('safe');
    expect(result.detail).toBe(`UI tree captured (${xml.length} chars)`);
  });
});

describe('redactUiTreeXml unit contract', () => {
  it('redacts value attributes only on sensitive elements, preserving structure', () => {
    const xml =
      '<XCUIElementTypeSecureTextField name="otp" value="123456" label="code" />' +
      '<XCUIElementTypeStaticText name="title" value="Welcome" />';
    const result = redactUiTreeXml(xml);
    expect(result.redactionCount).toBe(1);
    expect(result.xml).toContain('value="••••••"');
    expect(result.xml).not.toContain('123456');
    expect(result.xml).toContain('value="Welcome"');
    expect(result.xml).toContain('name="otp"');
  });

  it('returns input unchanged with zero count when nothing is sensitive', () => {
    const xml = '<XCUIElementTypeButton name="Go" value="Go" />';
    const result = redactUiTreeXml(xml);
    expect(result.redactionCount).toBe(0);
    expect(result.xml).toBe(xml);
  });
});
