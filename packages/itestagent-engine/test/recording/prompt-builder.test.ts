/**
 * Unit tests for RecordingPromptBuilder.
 *
 * Task 3.13: Interactive Recording — builds LLM system prompts for step suggestions.
 *
 * Tests prompt construction, truncation, section presence, and format constraints.
 */

import { expect, test } from 'bun:test';
import {
  RecordingPromptBuilder,
  type RecordingPromptContext,
} from '../../src/recording/prompt-builder.js';

// ─── Fixtures ────────────────────────────────────────────────────

const BASE_CONTEXT: RecordingPromptContext = {
  featureName: 'login',
  uiTree: 'Button "Login" at (0.5, 0.5)\nTextField "Username" at (0.5, 0.3)',
  historySteps: [],
};

const CONTEXT_WITH_HISTORY: RecordingPromptContext = {
  ...BASE_CONTEXT,
  historySteps: [
    { action: 'tap', target: 'Username field', status: 'done' },
    { action: 'input', target: 'Username field', status: 'done' },
    { action: 'tap', target: 'Next button', status: 'skipped' },
  ],
};

/** Generate a large UI tree string for truncation tests. */
function largeUiTree(chars: number): string {
  return 'A'.repeat(chars);
}

// ═══════════════════════════════════════════════════════════════════
// Feature Name
// ═══════════════════════════════════════════════════════════════════

test('buildSuggestionPrompt includes feature name', () => {
  const builder = new RecordingPromptBuilder();
  const prompt = builder.buildSuggestionPrompt(BASE_CONTEXT);

  expect(prompt).toContain('login');
  expect(prompt).toContain('"login"');
});

test('buildSuggestionPrompt includes different feature names correctly', () => {
  const builder = new RecordingPromptBuilder();
  const prompt = builder.buildSuggestionPrompt({
    ...BASE_CONTEXT,
    featureName: 'checkout-flow',
  });

  expect(prompt).toContain('checkout-flow');
});

// ═══════════════════════════════════════════════════════════════════
// UI Tree
// ═══════════════════════════════════════════════════════════════════

test('buildSuggestionPrompt includes UI tree content', () => {
  const builder = new RecordingPromptBuilder();
  const prompt = builder.buildSuggestionPrompt(BASE_CONTEXT);

  expect(prompt).toContain('Button "Login"');
  expect(prompt).toContain('TextField "Username"');
  expect(prompt).toContain('## CURRENT UI');
});

test('buildSuggestionPrompt truncates UI tree when too long', () => {
  const builder = new RecordingPromptBuilder({ maxUiTreeChars: 100 });
  const prompt = builder.buildSuggestionPrompt({
    ...BASE_CONTEXT,
    uiTree: largeUiTree(500),
  });

  // Should contain truncation notice
  expect(prompt).toContain('characters omitted from UI tree');
  // Should not contain the full tree
  expect(prompt).not.toContain(largeUiTree(500));
  // Should contain the first part
  expect(prompt).toContain(largeUiTree(100));
});

test('buildSuggestionPrompt does NOT truncate UI tree within limit', () => {
  const builder = new RecordingPromptBuilder({ maxUiTreeChars: 500 });
  const prompt = builder.buildSuggestionPrompt({
    ...BASE_CONTEXT,
    uiTree: 'Short UI tree',
  });

  expect(prompt).not.toContain('characters omitted from UI tree');
});

test('custom maxUiTreeChars in constructor works', () => {
  const builder = new RecordingPromptBuilder({ maxUiTreeChars: 50 });
  const prompt = builder.buildSuggestionPrompt({
    ...BASE_CONTEXT,
    uiTree: largeUiTree(200),
  });

  expect(prompt).toContain('characters omitted from UI tree');
  // Should keep first 50 chars
  expect(prompt).toContain(largeUiTree(50));
});

// ═══════════════════════════════════════════════════════════════════
// History Steps
// ═══════════════════════════════════════════════════════════════════

test('buildSuggestionPrompt includes zero-history message when empty', () => {
  const builder = new RecordingPromptBuilder();
  const prompt = builder.buildSuggestionPrompt(BASE_CONTEXT);

  expect(prompt).toContain('No steps have been recorded yet');
  expect(prompt).toContain('first action');
});

test('buildSuggestionPrompt includes history steps with status icons', () => {
  const builder = new RecordingPromptBuilder();
  const prompt = builder.buildSuggestionPrompt(CONTEXT_WITH_HISTORY);

  expect(prompt).toContain('## HISTORY');
  expect(prompt).toContain('tap: Username field');
  expect(prompt).toContain('input: Username field');
  expect(prompt).toContain('tap: Next button');
  // Check status icons
  expect(prompt).toContain('✓'); // done
  expect(prompt).toContain('⊘'); // skipped
});

test('buildSuggestionPrompt shows failed step with ✗ icon', () => {
  const builder = new RecordingPromptBuilder();
  const prompt = builder.buildSuggestionPrompt({
    ...BASE_CONTEXT,
    historySteps: [{ action: 'tap', target: 'Submit', status: 'failed' }],
  });

  expect(prompt).toContain('✗');
});

test('buildSuggestionPrompt shows unknown status with ? icon', () => {
  const builder = new RecordingPromptBuilder();
  const prompt = builder.buildSuggestionPrompt({
    ...BASE_CONTEXT,
    historySteps: [{ action: 'tap', target: 'Unknown', status: 'unknown-status' }],
  });

  expect(prompt).toContain('?');
});

test('buildSuggestionPrompt includes numbered step list', () => {
  const builder = new RecordingPromptBuilder();
  const prompt = builder.buildSuggestionPrompt(CONTEXT_WITH_HISTORY);

  expect(prompt).toMatch(/1\. .*Username field/);
  expect(prompt).toMatch(/2\. .*Username field/);
  expect(prompt).toMatch(/3\. .*Next button/);
});

// ═══════════════════════════════════════════════════════════════════
// Project Context
// ═══════════════════════════════════════════════════════════════════

test('buildSuggestionPrompt includes optional project context', () => {
  const builder = new RecordingPromptBuilder();
  const prompt = builder.buildSuggestionPrompt({
    ...BASE_CONTEXT,
    projectContext: 'This is an e-commerce app with cart and checkout.',
  });

  expect(prompt).toContain('## PROJECT CONTEXT');
  expect(prompt).toContain('e-commerce app with cart and checkout');
});

test('buildSuggestionPrompt does NOT include project context section when omitted', () => {
  const builder = new RecordingPromptBuilder();
  const prompt = builder.buildSuggestionPrompt(BASE_CONTEXT);

  expect(prompt).not.toContain('## PROJECT CONTEXT');
});

test('buildSuggestionPrompt does NOT include project context section when empty string', () => {
  const builder = new RecordingPromptBuilder();
  const prompt = builder.buildSuggestionPrompt({
    ...BASE_CONTEXT,
    projectContext: '',
  });

  expect(prompt).not.toContain('## PROJECT CONTEXT');
});

test('buildSuggestionPrompt does NOT include project context section when whitespace only', () => {
  const builder = new RecordingPromptBuilder();
  const prompt = builder.buildSuggestionPrompt({
    ...BASE_CONTEXT,
    projectContext: '   ',
  });

  expect(prompt).not.toContain('## PROJECT CONTEXT');
});

// ═══════════════════════════════════════════════════════════════════
// Additional Hints
// ═══════════════════════════════════════════════════════════════════

test('buildSuggestionPrompt includes optional additional hints', () => {
  const builder = new RecordingPromptBuilder();
  const prompt = builder.buildSuggestionPrompt({
    ...BASE_CONTEXT,
    additionalHints: 'Focus on the navigation bar.',
  });

  expect(prompt).toContain('## USER HINTS');
  expect(prompt).toContain('Focus on the navigation bar');
});

test('buildSuggestionPrompt does NOT include hints section when omitted', () => {
  const builder = new RecordingPromptBuilder();
  const prompt = builder.buildSuggestionPrompt(BASE_CONTEXT);

  expect(prompt).not.toContain('## USER HINTS');
});

test('buildSuggestionPrompt includes both project context and hints', () => {
  const builder = new RecordingPromptBuilder();
  const prompt = builder.buildSuggestionPrompt({
    ...BASE_CONTEXT,
    projectContext: 'E-commerce iOS app',
    additionalHints: 'Test the payment flow',
  });

  expect(prompt).toContain('## PROJECT CONTEXT');
  expect(prompt).toContain('E-commerce iOS app');
  expect(prompt).toContain('## USER HINTS');
  expect(prompt).toContain('Test the payment flow');
});

// ═══════════════════════════════════════════════════════════════════
// No Markdown Code Fences
// ═══════════════════════════════════════════════════════════════════

test('prompt does NOT contain markdown code fences (```)', () => {
  const builder = new RecordingPromptBuilder();
  const prompt = builder.buildSuggestionPrompt(BASE_CONTEXT);

  // The prompt should avoid ``` fences that confuse JSON parsing downstream
  expect(prompt).not.toContain('```');
});

test('prompt does NOT contain triple backtick json fences', () => {
  const builder = new RecordingPromptBuilder();
  const prompt = builder.buildSuggestionPrompt({
    ...BASE_CONTEXT,
    historySteps: [{ action: 'tap', target: 'Submit', status: 'done' }],
  });

  expect(prompt).not.toMatch(/```json/);
  expect(prompt).not.toMatch(/```/);
});

// ═══════════════════════════════════════════════════════════════════
// JSON Format Instructions
// ═══════════════════════════════════════════════════════════════════

test('prompt includes JSON output format instructions', () => {
  const builder = new RecordingPromptBuilder();
  const prompt = builder.buildSuggestionPrompt(BASE_CONTEXT);

  expect(prompt).toContain('"action"');
  expect(prompt).toContain('"target"');
  expect(prompt).toContain('"reasoning"');
  expect(prompt).toContain('"confidence"');
  expect(prompt).toContain('no markdown fences');
  expect(prompt).toContain('no surrounding text');
});

test('prompt includes all valid action types', () => {
  const builder = new RecordingPromptBuilder();
  const prompt = builder.buildSuggestionPrompt(BASE_CONTEXT);

  expect(prompt).toContain('"tap"');
  expect(prompt).toContain('"swipe"');
  expect(prompt).toContain('"input"');
  expect(prompt).toContain('"screenshot"');
  expect(prompt).toContain('"wait"');
  expect(prompt).toContain('"launch"');
});

test('prompt includes example responses', () => {
  const builder = new RecordingPromptBuilder();
  const prompt = builder.buildSuggestionPrompt(BASE_CONTEXT);

  expect(prompt).toContain('Example of a response');
  expect(prompt).toContain('Login button');
  expect(prompt).toContain('"confidence":0.9');
});

// ═══════════════════════════════════════════════════════════════════
// Section Structure
// ═══════════════════════════════════════════════════════════════════

test('prompt includes ROLE section', () => {
  const builder = new RecordingPromptBuilder();
  const prompt = builder.buildSuggestionPrompt(BASE_CONTEXT);

  expect(prompt).toContain('iOS test recording assistant');
  expect(prompt).toContain('do NOT execute actions');
  expect(prompt).toContain('avoid destructive actions');
});

test('prompt sections are separated by delimiter', () => {
  const builder = new RecordingPromptBuilder();
  const prompt = builder.buildSuggestionPrompt(BASE_CONTEXT);

  // The '---' separator appears between sections
  const separatorCount = (prompt.match(/---/g) || []).length;
  expect(separatorCount).toBeGreaterThanOrEqual(3);
});

test('prompt includes FEATURE section', () => {
  const builder = new RecordingPromptBuilder();
  const prompt = builder.buildSuggestionPrompt(BASE_CONTEXT);

  expect(prompt).toContain('## FEATURE');
  expect(prompt).toContain('recording the feature');
  expect(prompt).toContain('end-to-end');
});

test('prompt includes TASK section with considerations', () => {
  const builder = new RecordingPromptBuilder();
  const prompt = builder.buildSuggestionPrompt(BASE_CONTEXT);

  expect(prompt).toContain('## TASK');
  expect(prompt).toContain('suggest the NEXT single action');
  expect(prompt).toContain('What would a real user do');
  expect(prompt).toContain('Avoid repeating actions');
});

// ═══════════════════════════════════════════════════════════════════
// Edge Cases
// ═══════════════════════════════════════════════════════════════════

test('prompt works with empty uiTree', () => {
  const builder = new RecordingPromptBuilder();
  const prompt = builder.buildSuggestionPrompt({
    ...BASE_CONTEXT,
    uiTree: '',
  });

  // Should not crash and should contain UI section
  expect(prompt).toContain('## CURRENT UI');
});

test('prompt works with many history steps', () => {
  const builder = new RecordingPromptBuilder();
  const manySteps = Array.from({ length: 20 }, (_, i) => ({
    action: 'tap',
    target: `Element ${i + 1}`,
    status: 'done' as const,
  }));

  const prompt = builder.buildSuggestionPrompt({
    ...BASE_CONTEXT,
    historySteps: manySteps,
  });

  expect(prompt).toContain('Element 1');
  expect(prompt).toContain('Element 20');
});

test('prompt returns a non-empty string', () => {
  const builder = new RecordingPromptBuilder();
  const prompt = builder.buildSuggestionPrompt(BASE_CONTEXT);

  expect(typeof prompt).toBe('string');
  expect(prompt.length).toBeGreaterThan(100);
});

test('default maxUiTreeChars is 8000', () => {
  const builder = new RecordingPromptBuilder();
  const prompt = builder.buildSuggestionPrompt({
    ...BASE_CONTEXT,
    uiTree: largeUiTree(9000),
  });

  expect(prompt).toContain('characters omitted from UI tree');
  // Should have truncated from ~9000 to 8000
  expect(prompt).not.toContain(largeUiTree(9000));
});
