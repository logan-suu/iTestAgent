import { afterEach, describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { discoverXcuitestExecutionAssets, parseSchemeTestAction } from '../src/execution-assets.js';
import { overrideSpawnSync } from '../src/xcodebuild-exec.js';

const fixtureRoot = resolve(import.meta.dir, '../../../../fixtures/xcodeproj-metadata');
const schemePath = resolve(fixtureRoot, 'Demo.xcodeproj/xcshareddata/xcschemes/Demo.xcscheme');
const discovery = {
  root: fixtureRoot,
  name: 'Demo',
  type: 'xcode_project' as const,
  xcodeprojPath: resolve(fixtureRoot, 'Demo.xcodeproj'),
  schemes: ['Demo'],
  configurations: ['Debug'],
};

afterEach(() => overrideSpawnSync(undefined));

describe('metadata-only XCUITest execution asset parser', () => {
  it('extracts graph-proven TestAction targets and test plans', () => {
    const parsed = parseSchemeTestAction(readFileSync(schemePath, 'utf8'), ['DemoUITests']);
    expect(parsed).toEqual({
      targets: ['DemoUITests'],
      testPlans: [
        { name: 'Smoke', isDefault: true },
        { name: 'Regression', isDefault: false },
      ],
    });
  });

  it('does not accept unrelated targets from scheme metadata', () => {
    const parsed = parseSchemeTestAction(readFileSync(schemePath, 'utf8'), ['OtherUITests']);
    expect(parsed.targets).toEqual([]);
  });
});

describe('discoverXcuitestExecutionAssets', () => {
  it('returns evidence-backed candidates without invoking xcodebuild or the sentinel action', async () => {
    let spawned = false;
    overrideSpawnSync(() => {
      spawned = true;
      throw new Error('metadata discovery must not spawn xcodebuild');
    });

    const result = await discoverXcuitestExecutionAssets({
      root: discovery.root,
      discovery,
      xcuitestTargets: ['DemoUITests'],
      targetKind: 'simulator',
    });

    expect(spawned).toBe(false);
    expect(readFileSync(schemePath, 'utf8')).toContain('ITESTAGENT_METADATA_SENTINEL');
    expect(result.status).toBe('available');
    expect(result.configurations).toHaveLength(2);
    expect(result.configurations[0]).toMatchObject({
      scheme: 'Demo',
      testPlan: 'Smoke',
      targets: ['DemoUITests'],
      targetKind: 'simulator',
      isDefault: true,
    });
    expect(result.configurations[0]?.evidence.join(' ')).toContain('Shared scheme metadata');
    expect(result.configurations[0]?.limitations.join(' ')).toContain(
      'does not prove build, signing, installation',
    );
  });

  it('returns none only after readable metadata proves no matching TestAction target', async () => {
    const result = await discoverXcuitestExecutionAssets({
      root: discovery.root,
      discovery,
      xcuitestTargets: ['OtherUITests'],
      targetKind: 'physical',
    });
    expect(result).toMatchObject({ status: 'none', configurations: [] });
  });

  it('returns indeterminate when shared scheme metadata is unavailable', async () => {
    const result = await discoverXcuitestExecutionAssets({
      root: discovery.root,
      discovery: { ...discovery, schemes: ['Unshared'] },
      xcuitestTargets: ['DemoUITests'],
      targetKind: 'physical',
    });
    expect(result.status).toBe('indeterminate');
    expect(result.configurations).toEqual([]);
    expect(result.limitations.join(' ')).toContain('cannot be proven');
  });

  it('fails closed before reading metadata for a cross-target destination', async () => {
    const result = await discoverXcuitestExecutionAssets({
      root: discovery.root,
      discovery,
      xcuitestTargets: ['DemoUITests'],
      targetKind: 'physical',
      destination: { targetKind: 'simulator', simulatorName: 'iPhone 16 Pro' },
    });
    expect(result.status).toBe('indeterminate');
    expect(result.configurations).toEqual([]);
    expect(result.limitations[0]).toContain('does not match');
  });
});
