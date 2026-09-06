import { beforeAll, describe, expect, it, mock } from 'bun:test';
import { assertSecureFirstRunRenderer } from '../src/entry.js';
import { type TuiShellState, createInitialState } from '../src/tui-shell.js';

mock.module('@opentui/solid', () => ({
  render: () => Promise.resolve(),
  createElement: () => ({}),
  createComponent: (Comp: unknown, props: unknown) => ({ kind: 'component', Comp, props }),
  spread: () => ({}),
  jsx: (type: unknown, props: unknown) => ({ kind: 'element', type, props }),
  jsxs: (type: unknown, props: unknown) => ({ kind: 'element', type, props }),
  Fragment: 'Fragment',
  useKeyboard: () => {},
  usePaste: () => {},
}));

let setup: typeof import('../src/renderers/first-run-setup-panel.js');

beforeAll(async () => {
  setup = await import('../src/renderers/first-run-setup-panel.js');
});

describe('OpenTUI first-run setup input', () => {
  it('allows only renderers with a production masked setup path', () => {
    expect(() => assertSecureFirstRunRenderer('opentui')).not.toThrow();
    expect(() => assertSecureFirstRunRenderer('ansi')).not.toThrow();
    expect(() => assertSecureFirstRunRenderer('ink')).toThrow('secure masked first-run setup');
  });

  it('preserves pasted Chinese and other Unicode text', () => {
    const text = '执行 T6.12 真机验收：点击按钮';
    const bytes = new TextEncoder().encode(text);
    expect(setup.decodeSetupPaste(bytes)).toBe(text);
    expect(setup.appendSetupInput('', setup.decodeSetupPaste(bytes))).toBe(text);
  });

  it('removes one Unicode symbol without leaving a broken surrogate', () => {
    expect(setup.removeLastSetupInputSymbol('密钥🔑')).toBe('密钥');
  });

  it('drops terminal control characters from pasted input', () => {
    expect(setup.appendSetupInput('api-', 'key\n\u0000value')).toBe('api-keyvalue');
  });

  it('never places the raw API key in the rendered setup tree', () => {
    const secret = 'itestagent-fake-secret-open-tui-612';
    const state: TuiShellState = {
      ...createInitialState('/test/ws'),
      mode: 'setup',
      setupStep: 1,
      setupProvider: 'openai',
      setupBaseUrl: 'https://api.example.com/v1',
      setupModel: 'test-model',
      setupError: '',
    };

    const tree = setup.FirstRunSetupPanel({
      state: () => state,
      draft: () => secret,
      setDraft: () => {},
      onSubmit: () => {},
    });
    const serialized = JSON.stringify(tree, (_key, value: unknown) =>
      typeof value === 'function' ? '[fn]' : value,
    );
    expect(serialized).not.toContain(secret);
    expect(serialized).toContain('•');
    expect(serialized).not.toContain('"input"');
  });
});
