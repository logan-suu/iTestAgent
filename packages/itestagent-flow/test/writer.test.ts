import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
/**
 * Flow Writer Tests — YAML serialization + R7 gating.
 *
 * Task 3.15: FlowV2 → YAML file persistence.
 * US-9.2 AC4: Default store at ~/.itestagent/flows/; project write needs confirmation.
 */
import { exists, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FlowV2 } from '../src/schema.js';
import { readFlowFile, saveFlow } from '../src/writer.js';
import { serializeFlowYaml } from '../src/yaml.js';

const sampleFlow: FlowV2 = {
  schemaVersion: 'itestagent.flow.v2',
  flowId: 'test-writer-flow',
  source: 'agent-recorded',
  status: 'draft',
  supportedTargetKinds: ['simulator'],
  requiredCapabilities: ['uiTree', 'coordinateTap'],
  lastValidatedTargets: [{ kind: 'simulator', udid: 'TEST-UDID-1234' }],
  steps: [
    { action: 'launchApp', target: 'com.test.app' },
    { action: 'tap', target: 'Start', locator: { strategy: 'label', value: 'Start' } },
  ],
  notes: 'Test flow for writer tests.',
};

const testDir = join(tmpdir(), `itestagent-flow-test-${Date.now()}`);

describe('Flow YAML file write', () => {
  beforeAll(async () => {
    await mkdir(join(testDir, '.itestagent', 'flows'), { recursive: true });
  });

  afterAll(async () => {
    try {
      await rm(testDir, { recursive: true, force: true });
    } catch {
      // cleanup best-effort
    }
  });

  it('produces valid YAML with all required fields', () => {
    const yaml = serializeFlowYaml(sampleFlow);
    expect(yaml.length).toBeGreaterThan(0);
    expect(yaml).toContain('itestagent.flow.v2');
    expect(yaml).toContain('test-writer-flow');
    expect(yaml).toContain('action: launchApp');
    expect(yaml).toContain('action: tap');
    expect(yaml).toContain('supportedTargetKinds');
  });

  it('writes YAML to disk successfully', async () => {
    const yaml = serializeFlowYaml(sampleFlow);
    const flowPath = join(testDir, '.itestagent', 'flows', `${sampleFlow.flowId}.yaml`);
    await writeFile(flowPath, yaml, 'utf-8');

    const fileExists = await exists(flowPath);
    expect(fileExists).toBe(true);
  });

  it('written YAML reads back with correct content', async () => {
    const yaml = serializeFlowYaml(sampleFlow);
    const flowPath = join(testDir, '.itestagent', 'flows', `${sampleFlow.flowId}.yaml`);
    await writeFile(flowPath, yaml, 'utf-8');

    const { readFile } = await import('node:fs/promises');
    const content = await readFile(flowPath, 'utf-8');
    expect(content).toContain('flowId: test-writer-flow');
    expect(content).toContain('itestagent.flow.v2');
  });
});

describe('saveFlow R7 confirmation gate', () => {
  it('rejects project write when projectConfirmed is false', async () => {
    await expect(
      saveFlow(sampleFlow, { projectPath: '/tmp/p', projectConfirmed: false }),
    ).rejects.toThrow('R7');
  });

  it('rejects project write when projectConfirmed is undefined', async () => {
    await expect(saveFlow(sampleFlow, { projectPath: '/tmp/p' })).rejects.toThrow('R7');
  });

  it('rejects project write when projectConfirmed is missing entirely', async () => {
    await expect(
      saveFlow(sampleFlow, {
        projectPath: '/tmp/p',
        projectConfirmed: undefined as unknown as boolean,
      }),
    ).rejects.toThrow('R7');
  });
});

describe('readFlowFile error handling', () => {
  it('throws for nonexistent flow ID', async () => {
    await expect(readFlowFile('completely-nonexistent-flow-id-99999')).rejects.toThrow('not found');
  });

  it('rejects path traversal via ../ in flowId', async () => {
    await expect(readFlowFile('../../../etc/passwd')).rejects.toThrow('Invalid flowId');
  });

  it('rejects absolute path as flowId', async () => {
    await expect(readFlowFile('/etc/passwd')).rejects.toThrow('Invalid flowId');
  });

  it('rejects flowId with special characters', async () => {
    await expect(readFlowFile('flow;rm -rf /')).rejects.toThrow('Invalid flowId');
  });

  it('rejects empty flowId', async () => {
    await expect(readFlowFile('')).rejects.toThrow('Invalid flowId');
  });

  it('rejects flowId longer than 128 characters', async () => {
    const longId = 'a'.repeat(129);
    await expect(readFlowFile(longId)).rejects.toThrow('Invalid flowId');
  });

  it('accepts valid flowId with hyphens and underscores', async () => {
    // Should NOT throw on validation — will throw "not found" because file doesn't exist
    await expect(readFlowFile('my-flow_v2')).rejects.toThrow('not found');
  });
});
