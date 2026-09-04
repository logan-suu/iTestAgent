/**
 * config.test.ts — characterization tests for the iTestAgent config contracts
 * (US-18.1/US-18.2, AGENTS.md §5 data contracts, guide §11.4 "config->B02").
 *
 * These tests lock the CURRENT behavior of ItestAgentConfigSchema,
 * DEFAULT_CONFIG and parseConfig so later batches cannot silently change the
 * runtime contract:
 *
 *   - schemaVersion defaults to '1.0' and preserves explicit values;
 *   - model/device/tui sections apply their documented defaults;
 *   - strict objects reject unknown keys (Zod .strict());
 *   - enum fields only accept the documented backend/framework values;
 *   - the root transform always fills model/device/tui (never undefined).
 */
import { describe, expect, test } from 'bun:test';
import {
  DEFAULT_CONFIG,
  DeviceConfigSchema,
  ItestAgentConfigSchema,
  ModelConfigSchema,
  PermissionsConfigSchema,
  TuiConfigSchema,
  parseConfig,
} from '../src/config.js';

// ─── DEFAULT_CONFIG shape ────────────────────────────────────────────────────

describe('DEFAULT_CONFIG', () => {
  test('equals parsing an empty object', () => {
    expect(DEFAULT_CONFIG).toEqual(parseConfig({}));
  });

  test('carries the documented schemaVersion default', () => {
    expect(DEFAULT_CONFIG.schemaVersion).toBe('1.0');
  });

  test('always fills model/device/tui/permissions sections (never undefined)', () => {
    expect(DEFAULT_CONFIG.model).toBeDefined();
    expect(DEFAULT_CONFIG.device).toBeDefined();
    expect(DEFAULT_CONFIG.tui).toBeDefined();
    expect(DEFAULT_CONFIG.permissions).toBeDefined();
  });

  test('model section is at its defaults', () => {
    expect(DEFAULT_CONFIG.model.provider).toBe('openai');
    expect(DEFAULT_CONFIG.model.baseURL).toBeUndefined();
    expect(DEFAULT_CONFIG.model.apiKeyRef).toBeUndefined();
    expect(DEFAULT_CONFIG.model.model).toBeUndefined();
  });

  test('device section is at its defaults', () => {
    expect(DEFAULT_CONFIG.device.allowCrossTargetFallback).toBe(false);
    expect(DEFAULT_CONFIG.device.preferredBackends).toBeUndefined();
  });

  test('tui section is at its defaults', () => {
    expect(DEFAULT_CONFIG.tui.framework).toBe('auto');
    expect(DEFAULT_CONFIG.permissions.deniedRules).toEqual([]);
  });

  test('$schema stays unset when not provided', () => {
    expect(DEFAULT_CONFIG.$schema).toBeUndefined();
  });
});

// ─── schemaVersion behavior ──────────────────────────────────────────────────

describe('schemaVersion', () => {
  test('defaults to "1.0" when omitted', () => {
    expect(parseConfig({}).schemaVersion).toBe('1.0');
  });

  test('preserves an explicit value', () => {
    expect(parseConfig({ schemaVersion: '1.1' }).schemaVersion).toBe('1.1');
  });

  test('rejects non-string values', () => {
    const result = ItestAgentConfigSchema.safeParse({ schemaVersion: 1 });
    expect(result.success).toBe(false);
  });
});

// ─── Model section ───────────────────────────────────────────────────────────

describe('model config parsing', () => {
  test('fills provider default when model section omitted entirely', () => {
    const config = parseConfig({});
    expect(config.model.provider).toBe('openai');
  });

  test('preserves a partial model section without inventing values', () => {
    const config = parseConfig({ model: { provider: 'anthropic' } });
    expect(config.model.provider).toBe('anthropic');
    // Characterization: absent optional keys stay absent (no fabricated "").
    expect('baseURL' in config.model).toBe(false);
    expect('apiKeyRef' in config.model).toBe(false);
    expect('model' in config.model).toBe(false);
  });

  test('round-trips a complete model section', () => {
    const config = parseConfig({
      model: {
        provider: 'openai',
        baseURL: 'https://api.example.com/v1',
        apiKeyRef: 'ITESTAGENT_OPENAI_KEY',
        model: 'gpt-4o',
      },
    });
    expect(config.model).toEqual({
      provider: 'openai',
      baseURL: 'https://api.example.com/v1',
      apiKeyRef: 'ITESTAGENT_OPENAI_KEY',
      model: 'gpt-4o',
    });
  });

  test('rejects unknown model keys (strict)', () => {
    expect(ModelConfigSchema.safeParse({ apiKey: 'sk-secret' }).success).toBe(false);
  });

  test('rejects non-string provider', () => {
    expect(ModelConfigSchema.safeParse({ provider: 42 }).success).toBe(false);
  });
});

// ─── Device section ──────────────────────────────────────────────────────────

describe('device config parsing', () => {
  test('fills allowCrossTargetFallback default false when device omitted', () => {
    const config = parseConfig({});
    expect(config.device.allowCrossTargetFallback).toBe(false);
  });

  test('preserves explicit allowCrossTargetFallback true', () => {
    const config = parseConfig({ device: { allowCrossTargetFallback: true } });
    expect(config.device.allowCrossTargetFallback).toBe(true);
  });

  test('accepts physical backend preference lists in documented order', () => {
    const config = parseConfig({
      device: { preferredBackends: { physical: ['mobile-mcp', 'appium'] } },
    });
    expect(config.device.preferredBackends?.physical).toEqual(['mobile-mcp', 'appium']);
  });

  test('accepts simulator backend preference lists', () => {
    const config = parseConfig({
      device: { preferredBackends: { simulator: ['mock'] } },
    });
    expect(config.device.preferredBackends?.simulator).toEqual(['mock']);
  });

  test('rejects unknown backend names for physical targets', () => {
    const result = DeviceConfigSchema.safeParse({
      preferredBackends: { physical: ['iphone-use'] },
    });
    expect(result.success).toBe(false);
  });

  test('rejects mobile-mcp for simulator targets (enum mismatch)', () => {
    const result = DeviceConfigSchema.safeParse({
      preferredBackends: { simulator: ['mobile-mcp'] },
    });
    expect(result.success).toBe(false);
  });

  test('rejects non-boolean allowCrossTargetFallback', () => {
    const result = DeviceConfigSchema.safeParse({ allowCrossTargetFallback: 'yes' });
    expect(result.success).toBe(false);
  });
});

// ─── TUI section ─────────────────────────────────────────────────────────────

describe('tui config parsing', () => {
  test('fills framework default auto when tui omitted', () => {
    const config = parseConfig({});
    expect(config.tui.framework).toBe('auto');
  });

  test('accepts the verified ink fallback', () => {
    expect(parseConfig({ tui: { framework: 'ink' } }).tui.framework).toBe('ink');
  });

  test('accepts explicit ansi and opentui renderers', () => {
    expect(parseConfig({ tui: { framework: 'ansi' } }).tui.framework).toBe('ansi');
    expect(parseConfig({ tui: { framework: 'opentui' } }).tui.framework).toBe('opentui');
  });

  test('only accepts deny rules for persistent permissions', () => {
    expect(
      PermissionsConfigSchema.parse({
        deniedRules: [{ action: 'uninstall_app', resource: '*', effect: 'deny' }],
      }).deniedRules,
    ).toHaveLength(1);
    expect(
      PermissionsConfigSchema.safeParse({
        deniedRules: [{ action: 'uninstall_app', resource: '*', effect: 'allow' }],
      }).success,
    ).toBe(false);
  });

  test('rejects frameworks outside the documented enum', () => {
    expect(TuiConfigSchema.safeParse({ framework: 'rezi' }).success).toBe(false);
  });

  test('rejects unknown tui keys (strict)', () => {
    expect(TuiConfigSchema.safeParse({ theme: 'dark' }).success).toBe(false);
  });
});

// ─── parseConfig valid/invalid inputs ────────────────────────────────────────

describe('parseConfig', () => {
  test('parses a fully populated config with $schema reference', () => {
    const raw = {
      $schema: 'https://itestagent.dev/schemas/config.schema.json',
      schemaVersion: '1.0',
      model: { provider: 'openai', model: 'gpt-4o' },
      device: {
        preferredBackends: { physical: ['appium'], simulator: ['mock'] },
        allowCrossTargetFallback: false,
      },
      tui: { framework: 'opentui' },
    };
    const config = parseConfig(raw);
    expect(config.$schema).toBe('https://itestagent.dev/schemas/config.schema.json');
    expect(config.schemaVersion).toBe('1.0');
    expect(config.model).toEqual({ provider: 'openai', model: 'gpt-4o' });
    expect(config.device.preferredBackends).toEqual({
      physical: ['appium'],
      simulator: ['mock'],
    });
    expect(config.device.allowCrossTargetFallback).toBe(false);
    expect(config.tui.framework).toBe('opentui');
  });

  test('parses from an empty object by applying every default', () => {
    const config = parseConfig({});
    expect(config.schemaVersion).toBe('1.0');
    expect(config.model.provider).toBe('openai');
    expect(config.device.allowCrossTargetFallback).toBe(false);
    expect(config.tui.framework).toBe('auto');
  });

  test('throws on non-object input', () => {
    expect(() => parseConfig('not-an-object')).toThrow();
    expect(() => parseConfig(42)).toThrow();
    expect(() => parseConfig(null)).toThrow();
  });

  test('throws on unknown root keys (strict)', () => {
    expect(() => parseConfig({ unknownSection: {} })).toThrow();
  });

  test('throws on wrong-typed nested sections', () => {
    expect(() => parseConfig({ model: 'openai' })).toThrow();
    expect(() => parseConfig({ device: [] })).toThrow();
    expect(() => parseConfig({ tui: true })).toThrow();
  });
});
