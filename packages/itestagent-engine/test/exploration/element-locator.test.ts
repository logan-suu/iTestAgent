/**
 * Unit tests for ElementLocator — 5-level locator strategy degradation (AC4).
 *
 * Covers all 5 strategies in priority order:
 *   1. accessibility_id (high confidence)
 *   2. label (high confidence)
 *   3. label_contains (medium confidence)
 *   4. xpath (low confidence)
 *   5. coordinate (low confidence, fallback)
 *
 * AC4: When element location is unstable, degradation is explicitly annotated
 * rather than pretending success (R5: no silent degradation).
 */
import { expect, test } from 'bun:test';
import { ElementLocator } from '../../src/exploration/element-locator.js';
import {
  duplicateLabelsUiTree,
  emptyScreenUiTree,
  loginScreenUiTree,
  settingsScreenUiTree,
  targetNotFoundUiTree,
} from './fixtures/ui-trees.js';

const locator = new ElementLocator();

// ─── Level 1: accessibility_id (exact name match) ────────────────

test('accessibility_id exact match returns high confidence', () => {
  const result = locator.locate(loginScreenUiTree().raw, 'login_button');

  expect(result.found).toBe(true);
  expect(result.strategy).toBe('accessibility_id');
  expect(result.confidence).toBe('high');
  expect(result.attemptedStrategies).toEqual(['accessibility_id']);
  // Should have no degradation for high-confidence exact match
  expect(result.degradation).toBeUndefined();
});

test('accessibility_id match returns correct element', () => {
  const result = locator.locate(loginScreenUiTree().raw, 'login_button');

  expect(result.element).toBeDefined();
  expect(result.element?.name).toBe('login_button');
  expect(result.element?.type).toBe('Button');
  expect(result.element?.enabled).toBe(true);
});

// ─── Level 2: label exact match ─────────────────────────────────

test('label exact match returns high confidence', () => {
  // 'Username' is only a label (accessibilityIdentifier is 'username_field'),
  // so it correctly tests label strategy without matching accessibility_id first.
  const result = locator.locate(loginScreenUiTree().raw, 'Username');

  expect(result.found).toBe(true);
  expect(result.strategy).toBe('label');
  expect(result.confidence).toBe('high');
  expect(result.attemptedStrategies).toEqual(['accessibility_id', 'label']);
  expect(result.degradation).toBeUndefined();
});

test('label match returns correct element with name from accessibilityIdentifier', () => {
  const result = locator.locate(loginScreenUiTree().raw, 'Password');

  expect(result.element).toBeDefined();
  expect(result.element?.name).toBe('password_field');
  expect(result.element?.type).toBe('SecureTextField');
});

// ─── Level 3: label_contains (case-insensitive substring) ───────

test('label_contains substring match returns medium confidence', () => {
  const result = locator.locate(settingsScreenUiTree().raw, 'Display');

  expect(result.found).toBe(true);
  expect(result.strategy).toBe('label_contains');
  expect(result.confidence).toBe('medium');
  expect(result.attemptedStrategies).toEqual(['accessibility_id', 'label', 'label_contains']);
});

test('label_contains is case-insensitive', () => {
  const result = locator.locate(settingsScreenUiTree().raw, 'display');

  expect(result.found).toBe(true);
  expect(result.strategy).toBe('label_contains');
});

test('label_contains matches element with HTML entity in label', () => {
  // "Privacy &amp; Security" parsed as literal "Privacy &amp; Security"
  const result = locator.locate(settingsScreenUiTree().raw, 'Privacy');

  expect(result.found).toBe(true);
  expect(result.strategy).toBe('label_contains');
  expect(result.confidence).toBe('medium');
});

// ─── Level 3 degradation: duplicate label_contains candidates ───

test('label_contains annotates degradation for multiple candidates', () => {
  // Use 'Del' (partial match) to reach label_contains degradation path.
  // (Full label 'Delete' would match via label exact match first.)
  const result = locator.locate(duplicateLabelsUiTree().raw, 'Del');

  expect(result.found).toBe(true);
  expect(result.strategy).toBe('label_contains');
  expect(result.confidence).toBe('medium');
  expect(result.degradation).toBeDefined();
  expect(result.degradation).toContain('3 candidates');
  expect(result.degradation).toContain('Delete');
});

test('duplicate labels via exact match does not degrade', () => {
  // Exact label match returns first match without degradation annotation.
  const result = locator.locate(duplicateLabelsUiTree().raw, 'Delete');

  expect(result.found).toBe(true);
  expect(result.strategy).toBe('label');
  expect(result.confidence).toBe('high');
  expect(result.degradation).toBeUndefined();
});

// ─── Level 4: xpath fallback (regex pattern on name/label) ──────

test('xpath fallback returns low confidence with degradation', () => {
  // 'cell' is substring of element names (general_cell, display_cell, privacy_cell)
  // but NOT in any label — so it bypasses label_contains and hits xpath.
  const result = locator.locate(settingsScreenUiTree().raw, 'cell');

  expect(result.found).toBe(true);
  expect(result.strategy).toBe('xpath');
  expect(result.confidence).toBe('low');
  expect(result.degradation).toBeDefined();
  expect(result.degradation).toContain('xpath fallback');
  expect(result.attemptedStrategies).toEqual([
    'accessibility_id',
    'label',
    'label_contains',
    'xpath',
  ]);
});

test('xpath fallback element has unknown type and target as name', () => {
  const result = locator.locate(settingsScreenUiTree().raw, 'cell');

  expect(result.element).toBeDefined();
  expect(result.element?.type).toBe('unknown');
  expect(result.element?.name).toBe('cell');
  expect(result.element?.enabled).toBe(true);
});

// ─── Level 5: coordinate fallback ───────────────────────────────

test('coordinate fallback returns low confidence with degradation', () => {
  // emptyScreenUiTree has no elements matching 'NonexistentButton'
  const result = locator.locate(emptyScreenUiTree().raw, 'NonexistentButton');

  expect(result.found).toBe(true);
  expect(result.strategy).toBe('coordinate');
  expect(result.confidence).toBe('low');
  expect(result.degradation).toBeDefined();
  expect(result.degradation).toContain('coordinate-only fallback');
  expect(result.degradation).toContain('AC4');
  expect(result.attemptedStrategies).toEqual([
    'accessibility_id',
    'label',
    'label_contains',
    'xpath',
    'coordinate',
  ]);
});

test('coordinate fallback returns screen center element', () => {
  const result = locator.locate(emptyScreenUiTree().raw, 'NonexistentButton');

  expect(result.element).toBeDefined();
  expect(result.element?.x).toBe(0.5);
  expect(result.element?.y).toBe(0.5);
  expect(result.element?.width).toBe(0.1);
  expect(result.element?.height).toBe(0.1);
  expect(result.element?.name).toBe('unknown');
  expect(result.element?.type).toBe('unknown');
  expect(result.element?.enabled).toBe(true);
});

// ─── Not found (fallback disabled) ──────────────────────────────

test('not found when coordinate fallback is disabled', () => {
  const result = locator.locate(targetNotFoundUiTree().raw, 'LogoutButton', false);

  expect(result.found).toBe(false);
  expect(result.confidence).toBe('low');
  expect(result.degradation).toBeDefined();
  expect(result.degradation).toContain('not found');
  expect(result.degradation).toContain('LogoutButton');
  expect(result.attemptedStrategies).toEqual([
    'accessibility_id',
    'label',
    'label_contains',
    'xpath',
  ]);
  expect(result.element).toBeUndefined();
});

test('not found result has strategy set to last attempted strategy', () => {
  const result = locator.locate(targetNotFoundUiTree().raw, 'LogoutButton', false);

  expect(result.strategy).toBe('xpath');
});

// ─── Empty UI tree ──────────────────────────────────────────────

test('empty UI tree returns not found with degradation', () => {
  const result = locator.locate('', 'anything');

  expect(result.found).toBe(false);
  expect(result.confidence).toBe('low');
  expect(result.degradation).toBeDefined();
  expect(result.degradation).toContain('empty');
  expect(result.degradation).toContain('anything');
  expect(result.attemptedStrategies).toEqual([]);
  expect(result.element).toBeUndefined();
});

test('malformed XML with no screen element returns not found', () => {
  const result = locator.locate('<root><foo /></root>', 'target');

  expect(result.found).toBe(false);
  expect(result.degradation).toBeDefined();
  expect(result.degradation).toContain('empty');
});

// ─── Chinese text ───────────────────────────────────────────────

test('Chinese text target falls back to coordinate', () => {
  // loginScreenUiTree has no Chinese labels/names, so target '登录'
  // goes through all strategies and falls back to coordinate.
  const result = locator.locate(loginScreenUiTree().raw, '登录');

  expect(result.found).toBe(true);
  expect(result.strategy).toBe('coordinate');
  expect(result.confidence).toBe('low');
});

// ─── Special characters ─────────────────────────────────────────

test('special characters (HTML entity mismatch) falls to coordinate', () => {
  // The label in the XML is "Display &amp; Brightness" (literal &amp;).
  // The target "Display & Brightness" does not match because &amp; != &.
  // This verifies the locator handles special characters without crashing.
  const result = locator.locate(settingsScreenUiTree().raw, 'Display & Brightness');

  expect(result.found).toBe(true);
  expect(result.strategy).toBe('coordinate');
  expect(result.confidence).toBe('low');
});

// ─── Element fields validation ──────────────────────────────────

test('returned element has all required fields with correct types', () => {
  const result = locator.locate(loginScreenUiTree().raw, 'login_button');

  expect(result.element).toBeDefined();
  const el = result.element as NonNullable<typeof result.element>;

  // String fields
  expect(typeof el.name).toBe('string');
  expect(el.name).toBe('login_button');
  expect(typeof el.type).toBe('string');
  expect(el.type).toBe('Button');

  // Normalized coordinate fields should be in [0, 1] range
  expect(typeof el.x).toBe('number');
  expect(el.x).toBeGreaterThanOrEqual(0);
  expect(el.x).toBeLessThanOrEqual(1);
  expect(typeof el.y).toBe('number');
  expect(el.y).toBeGreaterThanOrEqual(0);
  expect(el.y).toBeLessThanOrEqual(1);

  // Normalized size fields should be in (0, 1] range
  expect(typeof el.width).toBe('number');
  expect(el.width).toBeGreaterThan(0);
  expect(el.width).toBeLessThanOrEqual(1);
  expect(typeof el.height).toBe('number');
  expect(el.height).toBeGreaterThan(0);
  expect(el.height).toBeLessThanOrEqual(1);

  // Enabled boolean
  expect(typeof el.enabled).toBe('boolean');
  expect(el.enabled).toBe(true);
});

test('element center coordinates are computed correctly', () => {
  // login_button: x=20, y=280, width=350, height=50
  // Screen: 390 x 844
  // Normalized center x: (20 + 350/2) / 390 = 195/390 = 0.5
  // Normalized center y: (280 + 50/2) / 844 = 305/844 ≈ 0.3614
  const result = locator.locate(loginScreenUiTree().raw, 'login_button');

  expect(result.element?.x).toBeCloseTo(0.5, 5);
  expect(result.element?.y).toBeCloseTo(305 / 844, 4);
  expect(result.element?.width).toBeCloseTo(350 / 390, 5);
  expect(result.element?.height).toBeCloseTo(50 / 844, 5);
});

// ─── Strategy ordering verification ─────────────────────────────

test('higher-priority strategy is chosen over lower-priority', () => {
  // 'Settings' matches NavigationBar.name="Settings" (accessibility_id)
  // before it could match via label_contains on the same element.
  const result = locator.locate(settingsScreenUiTree().raw, 'Settings');

  expect(result.strategy).toBe('accessibility_id');
  expect(result.confidence).toBe('high');
});

test('each lower strategy includes all prior strategies in attemptedStrategies', () => {
  const coordinateResult = locator.locate(emptyScreenUiTree().raw, 'NonexistentButton');

  expect(coordinateResult.attemptedStrategies).toHaveLength(5);
  expect(coordinateResult.attemptedStrategies).toEqual([
    'accessibility_id',
    'label',
    'label_contains',
    'xpath',
    'coordinate',
  ]);
});

// ─── Edge cases ─────────────────────────────────────────────────

test('target string with only whitespace', () => {
  const result = locator.locate(loginScreenUiTree().raw, '   ');

  expect(result.found).toBe(true);
  // Falls to coordinate since no element matches whitespace
  expect(result.strategy).toBe('coordinate');
});

test('locator is reusable across multiple calls', () => {
  const r1 = locator.locate(loginScreenUiTree().raw, 'login_button');
  const r2 = locator.locate(settingsScreenUiTree().raw, 'General');

  expect(r1.strategy).toBe('accessibility_id');
  expect(r2.strategy).toBe('label');
  expect(r1.element?.name).toBe('login_button');
  expect(r2.element?.name).toBe('general_cell');
});

test('locator handles duplicate calls with same arguments', () => {
  const r1 = locator.locate(loginScreenUiTree().raw, 'login_button');
  const r2 = locator.locate(loginScreenUiTree().raw, 'login_button');

  expect(r1).toEqual(r2);
});
