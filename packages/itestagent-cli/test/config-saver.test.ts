import { afterEach, beforeEach, expect, test } from 'bun:test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DEFAULT_CONFIG, parseConfig } from 'itestagent-contracts';
import { saveProjectConfig } from '../src/config/saver.js';

let tempDir: string;

beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), 'itestagent-saver-'));
});

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true });
});

test('saveProjectConfig writes JSON with $schema', async () => {
  const configPath = await saveProjectConfig(DEFAULT_CONFIG, tempDir, {
    configPath: join(tempDir, 'itestagent.jsonc'),
    skipConfirmation: true,
  });

  const content = await readFile(configPath, 'utf-8');
  const parsed = JSON.parse(content);

  expect(parsed.$schema).toBe('https://itestagent.dev/schemas/config.schema.json');
  expect(parsed.schemaVersion).toBe('1.0');
});

test('saveProjectConfig omits default values to keep config minimal', async () => {
  const configPath = await saveProjectConfig(DEFAULT_CONFIG, tempDir, {
    configPath: join(tempDir, 'itestagent.jsonc'),
    skipConfirmation: true,
  });

  const content = await readFile(configPath, 'utf-8');
  const parsed = JSON.parse(content);

  // Default provider 'openai' should be omitted
  expect(parsed.model).toBeUndefined();
  // Default framework 'opentui' should be omitted
  expect(parsed.tui).toBeUndefined();
  // Default device should be omitted
  expect(parsed.device).toBeUndefined();
});

test('saveProjectConfig writes non-default model config', async () => {
  const config = parseConfig({
    schemaVersion: '1.0',
    model: { provider: 'anthropic', apiKeyRef: 'my-anthropic-key' },
  });

  const configPath = await saveProjectConfig(config, tempDir, {
    configPath: join(tempDir, 'itestagent.jsonc'),
    skipConfirmation: true,
  });

  const content = await readFile(configPath, 'utf-8');
  const parsed = JSON.parse(content);

  expect(parsed.model.provider).toBe('anthropic');
  expect(parsed.model.apiKeyRef).toBe('my-anthropic-key');
  // The actual key should never be in the file (R6)
  expect(content).not.toContain('sk-');
});

test('saveProjectConfig writes device config when non-default', async () => {
  const config = parseConfig({
    schemaVersion: '1.0',
    device: {
      preferredBackends: { physical: ['mock'] },
      allowCrossTargetFallback: true,
    },
  });

  const configPath = await saveProjectConfig(config, tempDir, {
    configPath: join(tempDir, 'itestagent.jsonc'),
    skipConfirmation: true,
  });

  const content = await readFile(configPath, 'utf-8');
  const parsed = JSON.parse(content);

  expect(parsed.device.preferredBackends.physical).toEqual(['mock']);
  expect(parsed.device.allowCrossTargetFallback).toBe(true);
});

test('saveProjectConfig creates parent directory if needed', async () => {
  const nestedDir = join(tempDir, 'nested', 'project');

  const configPath = await saveProjectConfig(DEFAULT_CONFIG, nestedDir, {
    configPath: join(nestedDir, 'itestagent.jsonc'),
    skipConfirmation: true,
  });

  const content = await readFile(configPath, 'utf-8');
  expect(content).toContain('"$schema"');
});

test('saveProjectConfig output ends with trailing newline', async () => {
  const configPath = await saveProjectConfig(DEFAULT_CONFIG, tempDir, {
    configPath: join(tempDir, 'itestagent.jsonc'),
    skipConfirmation: true,
  });

  const content = await readFile(configPath, 'utf-8');
  expect(content.endsWith('\n')).toBe(true);
});

test('saveProjectConfig throws on denied confirmation', async () => {
  // When skipConfirmation is false (default), it should prompt
  // In non-TTY test environment, confirmAction returns 'no'
  const configPath = join(tempDir, 'itestagent.jsonc');
  await expect(
    saveProjectConfig(DEFAULT_CONFIG, tempDir, {
      configPath,
      // skipConfirmation defaults to false → confirmAction runs → non-TTY → 'no'
    }),
  ).rejects.toThrow('declined');
});
