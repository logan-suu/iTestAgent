import { afterEach, beforeEach, expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getDefaultConfig, loadConfig } from '../src/config/loader.js';

let tempHome: string;
let tempProject: string;

beforeEach(async () => {
  tempHome = await mkdtemp(join(tmpdir(), 'itestagent-home-'));
  tempProject = await mkdtemp(join(tmpdir(), 'itestagent-project-'));
});

afterEach(async () => {
  await Promise.all([
    rm(tempHome, { recursive: true, force: true }),
    rm(tempProject, { recursive: true, force: true }),
  ]);
});

test('getDefaultConfig returns schema defaults', () => {
  const config = getDefaultConfig();
  expect(config.schemaVersion).toBe('1.0');
  expect(config.model.provider).toBe('openai');
  expect(config.device.allowCrossTargetFallback).toBe(false);
  expect(config.tui.framework).toBe('opentui');
});

test('loadConfig returns defaults when no config files exist', async () => {
  const { config, sources } = await loadConfig({
    projectDir: tempProject,
    homeDir: tempHome,
  });
  expect(config.schemaVersion).toBe('1.0');
  expect(config.model.provider).toBe('openai');
  expect(config.device.allowCrossTargetFallback).toBe(false);
  expect(config.tui.framework).toBe('opentui');
  expect(sources).toHaveLength(3);
  expect(sources.every((s) => !s.exists)).toBe(true);
});

test('loadConfig reads project-root config', async () => {
  await writeFile(
    join(tempProject, 'itestagent.jsonc'),
    JSON.stringify({ model: { provider: 'anthropic' } }),
  );
  const { config, sources } = await loadConfig({
    projectDir: tempProject,
    homeDir: tempHome,
  });
  expect(config.model.provider).toBe('anthropic');
  const rootSource = sources.find((s) => s.path === join(tempProject, 'itestagent.jsonc'));
  expect(rootSource?.exists).toBe(true);
});

test('loadConfig merges three layers (project-root > project-local > global)', async () => {
  // Global: provider=anthropic, model=claude-3
  await mkdir(join(tempHome, '.itestagent', 'config'), { recursive: true });
  await writeFile(
    join(tempHome, '.itestagent', 'config', 'itestagent.jsonc'),
    JSON.stringify({ model: { provider: 'anthropic', model: 'claude-3' } }),
  );

  // Project-local: provider=openai (overrides global provider)
  await mkdir(join(tempProject, '.itestagent'), { recursive: true });
  await writeFile(
    join(tempProject, '.itestagent', 'itestagent.jsonc'),
    JSON.stringify({ model: { provider: 'openai' } }),
  );

  // Project-root: per-target preferredBackends and allowCrossTargetFallback
  await writeFile(
    join(tempProject, 'itestagent.jsonc'),
    JSON.stringify({
      device: { preferredBackends: { physical: ['mock'] }, allowCrossTargetFallback: true },
    }),
  );

  const { config } = await loadConfig({
    projectDir: tempProject,
    homeDir: tempHome,
  });

  // project-local overrides global for provider
  expect(config.model.provider).toBe('openai');
  // global value preserved for model (deep merge, not overridden by project-local)
  expect(config.model.model).toBe('claude-3');
  // project-root sets device
  expect(config.device.allowCrossTargetFallback).toBe(true);
  expect(config.device.preferredBackends?.physical).toEqual(['mock']);
  // tui uses default
  expect(config.tui.framework).toBe('opentui');
});

test('loadConfig parses JSONC with comments (US-18.2 AC2)', async () => {
  const jsoncContent = `{
    // This is a line comment
    "model": {
      "provider": "anthropic" /* inline comment */
    }
  }`;
  await writeFile(join(tempProject, 'itestagent.jsonc'), jsoncContent);
  const { config } = await loadConfig({
    projectDir: tempProject,
    homeDir: tempHome,
  });
  expect(config.model.provider).toBe('anthropic');
});

test('loadConfig supports $schema field (US-18.2 AC2)', async () => {
  const jsoncContent = `{
    "$schema": "https://itestagent.dev/schemas/config.schema.json",
    "schemaVersion": "1.0"
  }`;
  await writeFile(join(tempProject, 'itestagent.jsonc'), jsoncContent);
  const { config } = await loadConfig({
    projectDir: tempProject,
    homeDir: tempHome,
  });
  expect(config.$schema).toBe('https://itestagent.dev/schemas/config.schema.json');
});

test('loadConfig rejects invalid config (Zod validation)', async () => {
  // preferredBackend must be one of appium/mobile-mcp/mock
  await writeFile(
    join(tempProject, 'itestagent.jsonc'),
    JSON.stringify({ device: { preferredBackend: 'invalid-backend' } }),
  );
  await expect(loadConfig({ projectDir: tempProject, homeDir: tempHome })).rejects.toThrow();
});

test('loadConfig marks all three sources correctly', async () => {
  // Only create global config
  await mkdir(join(tempHome, '.itestagent', 'config'), { recursive: true });
  await writeFile(
    join(tempHome, '.itestagent', 'config', 'itestagent.jsonc'),
    JSON.stringify({ model: { provider: 'anthropic' } }),
  );

  const { sources } = await loadConfig({
    projectDir: tempProject,
    homeDir: tempHome,
  });

  // Global exists
  const globalSource = sources.find(
    (s) => s.path.includes('.itestagent/config/itestagent.jsonc') && s.path.startsWith(tempHome),
  );
  expect(globalSource?.exists).toBe(true);

  // Project-local and project-root do not exist
  const projectLocalSource = sources.find(
    (s) => s.path === join(tempProject, '.itestagent', 'itestagent.jsonc'),
  );
  expect(projectLocalSource?.exists).toBe(false);

  const projectRootSource = sources.find((s) => s.path === join(tempProject, 'itestagent.jsonc'));
  expect(projectRootSource?.exists).toBe(false);
});
