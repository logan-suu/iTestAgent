/**
 * OpenTUI masked-field component tests (guide §6.4 + US-10.2 AC4).
 *
 * MaskedField is the only component allowed to display a secret-shaped
 * value; these tests prove the raw value never reaches a rendered text
 * node. @opentui/solid is mocked with a recording JSX factory so the
 * produced element tree can be inspected directly.
 */
import { beforeEach, describe, expect, it, mock } from 'bun:test';

// Recording mock: element trees are plain inspectable objects.
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

// ─── Tree inspection helpers ────────────────────────────────

interface MockNode {
  kind?: string;
  type?: unknown;
  Comp?: unknown;
  props?: Record<string, unknown>;
}

/** Collects every string leaf reachable through props/children arrays. */
function collectStrings(node: unknown, out: string[] = []): string[] {
  if (typeof node === 'string') {
    out.push(node);
    return out;
  }
  if (typeof node === 'number' || node === null || node === undefined) {
    return out;
  }
  if (Array.isArray(node)) {
    for (const child of node) collectStrings(child, out);
    return out;
  }
  const candidate = node as MockNode;
  if (candidate.props && typeof candidate.props === 'object') {
    collectStrings(candidate.props.children, out);
  }
  return out;
}

function treeOf(node: unknown): string {
  return JSON.stringify(node, (_key, value: unknown) =>
    typeof value === 'function' ? '[fn]' : value,
  );
}

// ─── Fixtures ───────────────────────────────────────────────

const SECRET = 'itestagent-fake-secret-B28-field-c0ffee';
const LABEL = 'API Key';

// ─── MaskedField ────────────────────────────────────────────

describe('MaskedField', () => {
  it('renders the label as a visible text leaf', () => {
    const tree = panel.MaskedField({ label: LABEL, value: SECRET }) as MockNode;
    const strings = collectStrings(tree);
    expect(strings.some((s) => s.startsWith(`${LABEL}:`))).toBe(true);
  });

  it('never renders the raw value into any text leaf', () => {
    const tree = panel.MaskedField({ label: LABEL, value: SECRET }) as MockNode;
    expect(treeOf(tree)).not.toContain(SECRET);
  });

  it('renders exactly one mask character per input character (up to the cap)', () => {
    const tree = panel.MaskedField({ label: LABEL, value: SECRET }) as MockNode;
    const displayLeaf = collectStrings(tree).find((s) => !s.includes(LABEL));
    expect(displayLeaf).toBe(panel.maskedDisplayValue(SECRET));
    expect(displayLeaf?.length).toBe(Math.min(SECRET.length, panel.MAX_MASKED_LENGTH));
    for (const ch of displayLeaf ?? '') {
      expect(ch).toBe(panel.MASK_CHAR);
    }
  });

  it('caps the displayed length for oversized values', () => {
    const long = 'y'.repeat(panel.MAX_MASKED_LENGTH + 10);
    const tree = panel.MaskedField({ label: LABEL, value: long }) as MockNode;
    const displayLeaf = collectStrings(tree).find((s) => !s.includes(LABEL));
    expect(displayLeaf?.length).toBe(panel.MAX_MASKED_LENGTH);
    expect(treeOf(tree)).not.toContain(long);
  });

  it('shows the placeholder when the value is empty', () => {
    const tree = panel.MaskedField({
      label: LABEL,
      value: '',
      placeholder: '(not set)',
    }) as MockNode;
    const displayLeaf = collectStrings(tree).find((s) => !s.includes(LABEL));
    expect(displayLeaf).toBe('(not set)');
  });

  it('falls back to "(not set)" when empty and no placeholder given', () => {
    const tree = panel.MaskedField({ label: LABEL, value: '' }) as MockNode;
    const displayLeaf = collectStrings(tree).find((s) => !s.includes(LABEL));
    expect(displayLeaf).toBe('(not set)');
  });
});

// ─── SetupPanel integration ─────────────────────────────────

function stateAtApiKeyStep(draft: string) {
  let s = controller.createInitialSetupState();
  s = controller.setupReducer(s, { type: 'start' }).state;
  s = controller.setupReducer(s, { type: 'input', text: 'deepseek' }).state;
  s = controller.setupReducer(s, { type: 'submit' }).state;
  s = controller.setupReducer(s, { type: 'submit' }).state;
  s = controller.setupReducer(s, { type: 'submit' }).state;
  s = controller.setupReducer(s, { type: 'input', text: draft }).state;
  return s;
}

describe('SetupPanel rendering', () => {
  it('api_key step: the rendered tree contains no raw secret', () => {
    const state = stateAtApiKeyStep(SECRET);
    const tree = panel.SetupPanel({ state: () => state, dispatch: () => {} }) as MockNode;
    expect(treeOf(tree)).not.toContain(SECRET);
  });

  it('persistence decision: notice shows scope/service/account/revocation, never the secret', () => {
    const stepped = controller.setupReducer(stateAtApiKeyStep(SECRET), {
      type: 'choose_remember',
    });
    const tree = panel.SetupPanel({
      state: () => stepped.state,
      dispatch: () => {},
    }) as MockNode;
    const flat = treeOf(tree);
    expect(flat).toContain('device-local');
    expect(flat).toContain('itestagent/openai_api_key');
    expect(flat).toContain('itestagent');
    expect(flat).toContain('delete-generic-password');
    expect(flat).not.toContain(SECRET);
  });

  it('denied outcome renders the memory-only disclosure', () => {
    const stepped = controller.setupReducer(stateAtApiKeyStep(SECRET), {
      type: 'choose_remember',
    });
    const denied = controller.setupReducer(stepped.state, { type: 'deny_persistence' });
    const tree = panel.SetupPanel({
      state: () => denied.state,
      dispatch: () => {},
    }) as MockNode;
    const flat = treeOf(tree);
    expect(flat.toLowerCase()).toContain('memory-only');
    expect(flat).not.toContain(SECRET);
  });

  it('dispatch is wired: panel render does not mutate controller state', () => {
    const state = stateAtApiKeyStep(SECRET);
    let dispatched = 0;
    const tree = panel.SetupPanel({
      state: () => state,
      dispatch: () => {
        dispatched += 1;
      },
    }) as MockNode;
    expect(tree).toBeDefined();
    expect(dispatched).toBe(0);
  });
});
