/**
 * Assertion suggester tests — LLM-injected tier-3 suggestion generation
 * (US-11.1 AC4 chain: observations → suggestions → user confirmation).
 */
import { describe, expect, it } from 'bun:test';
import { extractJsonArray, suggestAssertions } from '../../src/exploration/assertion-suggester.js';

const VALID_SUGGESTION = {
  id: 's1',
  caseId: 'login',
  label: 'login button visible',
  conditions: [
    {
      type: 'element_visible',
      description: 'login button is visible',
      target: 'login_button',
    },
  ],
  evidence: ['name="login_button" found in tree'],
};

describe('extractJsonArray', () => {
  it('parses a fenced JSON array', () => {
    const text = '```json\n[{"a":1}]\n```';
    expect(extractJsonArray(text)).toEqual([{ a: 1 }]);
  });

  it('parses a bare array with surrounding prose', () => {
    const text = 'Here you go:\n[{"a":1},{"a":2}]\nDone.';
    expect(extractJsonArray(text)).toHaveLength(2);
  });

  it('returns null when no array exists', () => {
    expect(extractJsonArray('no json here')).toBeNull();
  });
});

describe('suggestAssertions', () => {
  it('returns schema-validated suggestions with source forced to agent', async () => {
    const result = await suggestAssertions(
      { goal: 'login works', uiTree: '<XCUIElementTypeButton name="login_button" />' },
      {
        generate: async () => JSON.stringify([VALID_SUGGESTION]),
      },
    );
    expect(result.suggestions).toHaveLength(1);
    expect(result.suggestions[0]?.source).toBe('agent');
    expect(result.suggestions[0]?.conditions[0]?.target).toBe('login_button');
  });

  it('drops suggestions with out-of-policy condition types', async () => {
    const result = await suggestAssertions(
      { goal: 'g', uiTree: '<a />' },
      {
        generate: async () =>
          JSON.stringify([
            VALID_SUGGESTION,
            {
              ...VALID_SUGGESTION,
              id: 's2',
              conditions: [{ type: 'tap', description: 'not allowed' }],
            },
          ]),
      },
    );
    expect(result.suggestions).toHaveLength(1);
    expect(result.reason).toContain('dropped invalid: #1');
  });

  it('returns empty with reason when the LLM emits no JSON array', async () => {
    const result = await suggestAssertions(
      { goal: 'g', uiTree: '<a />' },
      { generate: async () => 'I cannot help with that.' },
    );
    expect(result.suggestions).toHaveLength(0);
    expect(result.reason).toContain('no parseable JSON array');
  });

  it('returns empty with reason when the LLM call throws', async () => {
    const result = await suggestAssertions(
      { goal: 'g', uiTree: '<a />' },
      {
        generate: async () => {
          throw new Error('rate limited');
        },
      },
    );
    expect(result.suggestions).toHaveLength(0);
    expect(result.reason).toContain('rate limited');
  });
});
