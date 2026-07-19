/**
 * phase1-config-resolve.test.ts — Integration test for configuration resolution chain.
 *
 * Cross-package chain under test:
 *   Config loader (itestagent-cli) → ItestAgentConfigSchema (itestagent-contracts)
 *   → JSONC parser → deep merge → SecretStore (itestagent-contracts)
 *   → MemorySecretStore (itestagent-cli) → credential resolution
 *
 * Note: ModelConfigSchema, DeviceConfigSchema, TuiConfigSchema are all .strict().
 * Only fields defined in the schema are valid.
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { mkdtempSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  MemorySecretStore,
  createSecretStore,
  getDefaultConfig,
  loadConfig,
  resolveCredentials,
} from 'itestagent-cli';
import { ItestAgentConfigSchema } from 'itestagent-contracts';

function tempDir(): string {
  return mkdtempSync(join(tmpdir(), 'itestagent-config-'));
}

function writeJsonc(path: string, content: string): void {
  mkdirSync(join(path, '..'), { recursive: true });
  writeFileSync(path, content, 'utf-8');
}

describe('Phase 1 Integration: Config Resolution (CLI → Contracts → SecretStore)', () => {
  let projectDir: string;
  let homeDir: string;

  beforeEach(() => {
    projectDir = tempDir();
    homeDir = tempDir();
  });

  afterEach(() => {
    rmSync(projectDir, { recursive: true, force: true });
    rmSync(homeDir, { recursive: true, force: true });
  });

  test('loadConfig returns schema defaults when no config files exist', async () => {
    const { config, sources } = await loadConfig({ projectDir, homeDir });
    expect(sources).toHaveLength(3);
    for (const src of sources) expect(src.exists).toBe(false);
    expect(config.schemaVersion).toBe('1.0');
    expect(config.model.provider).toBe('openai');
    expect(config.tui.framework).toBe('opentui');
  });

  test('loadConfig merges three layers', async () => {
    writeJsonc(
      join(homeDir, '.itestagent', 'config', 'itestagent.jsonc'),
      JSON.stringify({ model: { provider: 'openai', model: 'gpt-4o' } }),
    );
    writeJsonc(
      join(projectDir, '.itestagent', 'itestagent.jsonc'),
      JSON.stringify({ tui: { framework: 'ink' } }),
    );
    writeJsonc(
      join(projectDir, 'itestagent.jsonc'),
      JSON.stringify({ model: { model: 'gpt-4o-mini' } }),
    );

    const { config, sources } = await loadConfig({ projectDir, homeDir });
    expect(sources.filter((s) => s.exists)).toHaveLength(3);
    expect(config.model.provider).toBe('openai');
    expect(config.model.model).toBe('gpt-4o-mini'); // Layer 3 overrides
    expect(config.tui.framework).toBe('ink'); // Layer 2
  });

  test('loadConfig parses JSONC with // comments', async () => {
    writeJsonc(
      join(homeDir, '.itestagent', 'config', 'itestagent.jsonc'),
      '{\n  "model": { "provider": "openai", "model": "gpt-4o" }\n}',
    );
    const { config } = await loadConfig({ projectDir, homeDir });
    expect(config.model.provider).toBe('openai');
  });

  test('loadConfig throws on invalid config (schema rejects unknown keys)', async () => {
    writeJsonc(
      join(homeDir, '.itestagent', 'config', 'itestagent.jsonc'),
      JSON.stringify({ model: { unknown_field: 'bad' } }),
    );
    await expect(loadConfig({ projectDir, homeDir })).rejects.toThrow();
  });

  test('getDefaultConfig returns valid defaults', () => {
    const config = getDefaultConfig();
    expect(ItestAgentConfigSchema.parse(config).model.provider).toBe('openai');
  });

  test('MemorySecretStore CRUD', async () => {
    const store = new MemorySecretStore();
    await store.set('KEY1', 'val1');
    expect(await store.get('KEY1')).toBe('val1');
    expect(await store.get('MISSING')).toBeNull();
    await store.delete('KEY1');
    expect(await store.get('KEY1')).toBeNull();
    await store.delete('MISSING'); // no-op
  });

  test('resolveCredentials resolves apiKeyRef from SecretStore', async () => {
    const store = new MemorySecretStore();
    await store.set('my-key', 'sk-resolved');
    const config = getDefaultConfig();
    config.model.apiKeyRef = 'my-key';
    expect((await resolveCredentials(config, store)).resolvedApiKey).toBe('sk-resolved');
  });

  test('resolveCredentials returns null when apiKeyRef missing', async () => {
    const config = getDefaultConfig();
    expect((await resolveCredentials(config, new MemorySecretStore())).resolvedApiKey).toBeNull();
  });

  test('createSecretStore returns a SecretStore with get/set/delete', () => {
    const store = createSecretStore();
    expect(typeof store.get).toBe('function');
    expect(typeof store.set).toBe('function');
    expect(typeof store.delete).toBe('function');
  });
});
