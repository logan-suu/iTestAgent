/**
 * OpenTUI setup masking tests (guide §6.4 + US-10.2 AC4).
 *
 * Verifies that the setup wizard's pure view-model never exposes a raw
 * secret: sensitive drafts are rendered through the masked-display pipeline
 * only. @opentui/solid is mocked (same pattern as opentui-renderer.test.ts)
 * so the .tsx module can be imported without the native core.
 */
import { beforeEach, describe, expect, it, mock } from 'bun:test';

// Mock @opentui/solid before importing any .tsx module below.
mock.module('@opentui/solid', () => ({
  render: () => Promise.resolve(),
  createElement: () => ({}),
  createComponent: (Comp: unknown, props: unknown) => ({ kind: 'component', Comp, props }),
  spread: () => ({}),
  jsx: (type: unknown, props: unknown) => ({ kind: 'element', type, props }),
  jsxs: (type: unknown, props: unknown) => ({ kind: 'element', type, props }),
  Fragment: 'Fragment',
}));

let panel: typeof import('../src/renderers/setup-panel.js');
let controller: typeof import('../src/tui-setup-controller.js');

beforeEach(async () => {
  panel = await import('../src/renderers/setup-panel.js');
  controller = await import('../src/tui-setup-controller.js');
});

// ─── Fixtures ───────────────────────────────────────────────

const SECRET = 'itestagent-fake-secret-B28-mask-90fe21';

/** A secret short enough to stay under MAX_MASKED_LENGTH (length-preserving range). */
const SHORT_SECRET = 'itestagent-short-secret';

function stateAtApiKeyStep(draft: string) {
  let s = controller.createInitialSetupState();
  s = controller.setupReducer(s, { type: 'start' }).state;
  s = controller.setupReducer(s, { type: 'input', text: 'deepseek' }).state;
  s = controller.setupReducer(s, { type: 'submit' }).state;
  s = controller.setupReducer(s, { type: 'submit' }).state;
  s = controller.setupReducer(s, { type: 'submit' }).state;
  // The draft only lands in apiKeyDraft on submit (reducer contract: input
  // writes state.draft; submit commits it field-by-field).
  s = controller.setupReducer(s, { type: 'input', text: draft }).state;
  s = controller.setupReducer(s, { type: 'submit' }).state;
  return s;
}

// ─── maskedDisplayValue ─────────────────────────────────────

describe('maskedDisplayValue', () => {
  it('returns an empty string for an empty draft', () => {
    expect(panel.maskedDisplayValue('')).toBe('');
  });

  it('emits only the mask character, once per input character', () => {
    // Length-preserving guarantee holds within the cap; the over-cap case is
    // the next test. SHORT_SECRET stays under MAX_MASKED_LENGTH.
    const masked = panel.maskedDisplayValue(SHORT_SECRET);
    expect(masked.length).toBe(SHORT_SECRET.length);
    for (const ch of masked) {
      expect(ch).toBe(panel.MASK_CHAR);
    }
  });

  it('caps the displayed length so terminal layout stays bounded', () => {
    const long = 'x'.repeat(panel.MAX_MASKED_LENGTH + 50);
    const masked = panel.maskedDisplayValue(long);
    expect(masked.length).toBe(panel.MAX_MASKED_LENGTH);
    for (const ch of masked) {
      expect(ch).toBe(panel.MASK_CHAR);
    }
  });

  it('hides multi-byte characters completely', () => {
    const unicode = '密🔑pass-ÖÄÜ';
    const masked = panel.maskedDisplayValue(unicode);
    expect(masked.length).toBe(unicode.length);
    expect(masked).not.toContain('密');
    expect(masked).not.toContain('🔑');
  });
});

// ─── Step metadata ──────────────────────────────────────────

describe('step metadata helpers', () => {
  it('formatSetupStepHeader returns a distinct non-empty header per step', () => {
    const steps = [
      'provider',
      'base_url',
      'model',
      'api_key',
      'persistence_decision',
      'complete',
    ] as const;
    const headers = steps.map((s) => panel.formatSetupStepHeader(s));
    for (const h of headers) {
      expect(h.length).toBeGreaterThan(0);
    }
    expect(new Set(headers).size).toBe(steps.length);
  });

  it('isSecretStep marks only the API-key step as secret', () => {
    expect(panel.isSecretStep('api_key')).toBe(true);
    expect(panel.isSecretStep('provider')).toBe(false);
    expect(panel.isSecretStep('base_url')).toBe(false);
    expect(panel.isSecretStep('model')).toBe(false);
    expect(panel.isSecretStep('persistence_decision')).toBe(false);
    expect(panel.isSecretStep('complete')).toBe(false);
  });
});

// ─── View model masking guarantees ──────────────────────────

describe('buildSetupViewModel masking', () => {
  it('never embeds the raw API-key draft anywhere in the view model', () => {
    const vm = panel.buildSetupViewModel(stateAtApiKeyStep(SECRET));
    expect(vm.maskedDraft.length).toBe(Math.min(SECRET.length, panel.MAX_MASKED_LENGTH));
    expect(JSON.stringify(vm)).not.toContain(SECRET);
  });

  it('keeps non-secret fields readable (provider/baseUrl/model)', () => {
    let s = controller.createInitialSetupState();
    s = controller.setupReducer(s, { type: 'start' }).state;
    s = controller.setupReducer(s, { type: 'input', text: 'deepseek' }).state;
    s = controller.setupReducer(s, { type: 'submit' }).state;
    s = controller.setupReducer(s, { type: 'input', text: 'https://api.example.com/v1' }).state;
    s = controller.setupReducer(s, { type: 'submit' }).state;
    s = controller.setupReducer(s, { type: 'input', text: 'test-model' }).state;
    s = controller.setupReducer(s, { type: 'submit' }).state;
    const vm = panel.buildSetupViewModel(s);
    const body = vm.bodyLines.join('\n');
    expect(body).toContain('deepseek');
    expect(body).toContain('https://api.example.com/v1');
    expect(body).toContain('test-model');
  });

  it('passes the persistence notice through untouched (it contains no secret)', () => {
    const stepped = controller.setupReducer(stateAtApiKeyStep(SECRET), {
      type: 'choose_remember',
    });
    const vm = panel.buildSetupViewModel(stepped.state);
    expect(vm.noticeLines).toEqual(stepped.state.persistenceNotice);
    expect(JSON.stringify(vm)).not.toContain(SECRET);
  });

  it('noticeLines is null when no confirmation is pending', () => {
    const vm = panel.buildSetupViewModel(stateAtApiKeyStep(SECRET));
    expect(vm.noticeLines).toBeNull();
  });

  it('maps every outcome to a human-readable line', () => {
    const cases: Array<[import('../src/tui-setup-controller.js').SetupOutcome, string]> = [
      ['saved_to_keychain', 'Keychain'],
      ['session_only', 'memory-only'],
      ['denied', 'memory-only'],
      ['revoked', 'revoked'],
    ];
    for (const [outcome, fragment] of cases) {
      const base = stateAtApiKeyStep(SECRET);
      const state = { ...base, step: 'complete' as const, outcome };
      const vm = panel.buildSetupViewModel(state);
      expect(vm.outcomeLine).not.toBeNull();
      expect(vm.outcomeLine ?? '').toContain(fragment);
      expect(vm.outcomeLine ?? '').not.toContain(SECRET);
    }
    const pending = panel.buildSetupViewModel(stateAtApiKeyStep(SECRET));
    expect(pending.outcomeLine).toBeNull();
  });

  it('footer hints always disclose the deny path', () => {
    const vm = panel.buildSetupViewModel(stateAtApiKeyStep(SECRET));
    const hints = vm.footerHints.join('\n');
    expect(hints.toLowerCase()).toContain('deny');
  });
});
