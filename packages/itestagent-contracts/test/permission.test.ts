import { expect, test } from 'bun:test';
import {
  DEFAULT_HIGH_RISK_ACTIONS,
  PermissionEffectSchema,
  PermissionRuleSchema,
  SafetyGateSchema,
  parsePermissionRule,
} from '../src/permission.js';

// ─── PermissionEffectSchema ──────────────────────────────────

test('PermissionEffectSchema parses valid effects: allow, deny, ask', () => {
  expect(PermissionEffectSchema.parse('allow')).toBe('allow');
  expect(PermissionEffectSchema.parse('deny')).toBe('deny');
  expect(PermissionEffectSchema.parse('ask')).toBe('ask');
});

test('PermissionEffectSchema rejects invalid values', () => {
  expect(() => PermissionEffectSchema.parse('maybe')).toThrow();
  expect(() => PermissionEffectSchema.parse('')).toThrow();
  expect(() => PermissionEffectSchema.parse(null)).toThrow();
  expect(() => PermissionEffectSchema.parse(undefined)).toThrow();
});

// ─── SafetyGateSchema ────────────────────────────────────────

test('SafetyGateSchema parses valid gates: allow, ask, deny', () => {
  expect(SafetyGateSchema.parse('allow')).toBe('allow');
  expect(SafetyGateSchema.parse('ask')).toBe('ask');
  expect(SafetyGateSchema.parse('deny')).toBe('deny');
});

test('SafetyGateSchema rejects invalid values', () => {
  expect(() => SafetyGateSchema.parse('maybe')).toThrow();
  expect(() => SafetyGateSchema.parse('grant')).toThrow();
  expect(() => SafetyGateSchema.parse(42)).toThrow();
});

// ─── PermissionRuleSchema ────────────────────────────────────

test('PermissionRuleSchema parses a valid rule with all three fields', () => {
  const result = PermissionRuleSchema.parse({
    action: 'clear_app_data',
    resource: 'com.example.app',
    effect: 'ask',
  });
  expect(result.action).toBe('clear_app_data');
  expect(result.resource).toBe('com.example.app');
  expect(result.effect).toBe('ask');
});

test('PermissionRuleSchema rejects a rule missing effect', () => {
  expect(() =>
    PermissionRuleSchema.parse({
      action: 'uninstall_app',
      resource: 'com.example.app',
    }),
  ).toThrow();
});

// ─── DEFAULT_HIGH_RISK_ACTIONS ───────────────────────────────

test('DEFAULT_HIGH_RISK_ACTIONS is non-empty and has exactly 9 items', () => {
  expect(DEFAULT_HIGH_RISK_ACTIONS.length).toBe(9);
  expect(DEFAULT_HIGH_RISK_ACTIONS).toContain('clear_app_data');
  expect(DEFAULT_HIGH_RISK_ACTIONS).toContain('uninstall_app');
  expect(DEFAULT_HIGH_RISK_ACTIONS).toContain('write_project_file');
  expect(DEFAULT_HIGH_RISK_ACTIONS).toContain('store_credential');
  expect(DEFAULT_HIGH_RISK_ACTIONS).toContain('update_baseline');
  expect(DEFAULT_HIGH_RISK_ACTIONS).toContain('overwrite_flow');
  expect(DEFAULT_HIGH_RISK_ACTIONS).toContain('generate_draft_test');
  expect(DEFAULT_HIGH_RISK_ACTIONS).toContain('open_non_http_url');
  expect(DEFAULT_HIGH_RISK_ACTIONS).toContain('access_private_media');
});

// ─── parsePermissionRule ────────────────────────────────────

test('parsePermissionRule returns a typed rule for valid input', () => {
  const rule = parsePermissionRule({
    action: 'write_project_file',
    resource: '/src/App.ts',
    effect: 'deny',
  });
  expect(rule.action).toBe('write_project_file');
  expect(rule.resource).toBe('/src/App.ts');
  expect(rule.effect).toBe('deny');
});
