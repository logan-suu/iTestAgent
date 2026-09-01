import { afterEach, describe, expect, it } from 'bun:test';
import {
  discoverXcuitestExecutionAssets,
  parseEnumeratedXcuitestTargets,
  parseShowTestPlans,
} from '../src/execution-assets.js';
import { overrideSpawnSync } from '../src/xcodebuild-exec.js';

const discovery = {
  root: '/workspace/Demo',
  name: 'Demo',
  type: 'xcode_project' as const,
  xcodeprojPath: '/workspace/Demo/Demo.xcodeproj',
  schemes: ['Demo'],
  configurations: ['Debug'],
};

afterEach(() => overrideSpawnSync(undefined));

describe('xcodebuild execution asset parsers', () => {
  it('parses test-plan names without treating headings as plans', () => {
    expect(
      parseShowTestPlans(`
        Test plans associated with the scheme "Demo":
            Smoke (Default)
            Regression
      `),
    ).toEqual(['Smoke', 'Regression']);
  });

  it('keeps only graph-proven XCUITest targets from enumeration JSON', () => {
    const stdout = JSON.stringify({
      values: [
        { name: 'DemoUITests/LoginTests/testLogin' },
        { name: 'DemoUnitTests/ModelTests/testValue' },
      ],
    });
    expect(parseEnumeratedXcuitestTargets(stdout, ['DemoUITests'])).toEqual(['DemoUITests']);
  });

  it('fails closed when enumeration JSON reports a non-generic error', () => {
    expect(() =>
      parseEnumeratedXcuitestTargets(
        JSON.stringify({ errors: ['test runner installation failed'], values: [] }),
        ['DemoUITests'],
      ),
    ).toThrow('unexpected error');
  });

  it('fails closed when the enumeration errors field is malformed', () => {
    expect(() =>
      parseEnumeratedXcuitestTargets(
        JSON.stringify({ errors: 'unexpected warning shape', values: [] }),
        ['DemoUITests'],
      ),
    ).toThrow('errors field is malformed');
  });
});

describe('discoverXcuitestExecutionAssets', () => {
  it('returns a default and named runnable configuration with command evidence', async () => {
    const enumerationArgs: string[][] = [];
    overrideSpawnSync((_cmd, args) => {
      if (args.includes('-showTestPlans')) {
        return {
          exitCode: 0,
          stdout: 'Test plans associated with the scheme "Demo":\n    Smoke (Default)',
          stderr: '',
        };
      }
      enumerationArgs.push(args);
      return {
        exitCode: 0,
        stdout: JSON.stringify({
          errors: [
            'Cannot test target DemoUITests on Any iOS Simulator Device: Tests must be run on a concrete device',
          ],
          values: [{ name: 'DemoUITests/LoginTests/testLogin' }],
        }),
        stderr: '',
      };
    });

    const result = await discoverXcuitestExecutionAssets({
      root: discovery.root,
      discovery,
      xcuitestTargets: ['DemoUITests'],
      targetKind: 'simulator',
      destination: { targetKind: 'simulator', simulatorId: 'simulator-id' },
    });

    expect(result.configurations).toHaveLength(2);
    expect(result.configurations[0]).toMatchObject({
      scheme: 'Demo',
      targets: ['DemoUITests'],
      targetKind: 'simulator',
      isDefault: true,
    });
    expect(result.configurations[1]).toMatchObject({ testPlan: 'Smoke', isDefault: false });
    expect(result.configurations[0]?.destination).toBeUndefined();
    expect(result.configurations[0]?.evidence.join(' ')).toContain('enumeration succeeded');
    expect(enumerationArgs[0]).toContain('generic/platform=iOS Simulator');
    expect(enumerationArgs[0]).toContain('CODE_SIGNING_ALLOWED=NO');
    expect(enumerationArgs[0]).not.toContain('simulator-id');
  });

  it('does not turn a scheme name or failed enumeration into a runnable route', async () => {
    overrideSpawnSync((_cmd, args) =>
      args.includes('-showTestPlans')
        ? { exitCode: 0, stdout: '', stderr: '' }
        : { exitCode: 65, stdout: '', stderr: 'scheme has no test action' },
    );

    const result = await discoverXcuitestExecutionAssets({
      root: discovery.root,
      discovery: { ...discovery, schemes: ['DemoTests'] },
      xcuitestTargets: ['DemoUITests'],
      targetKind: 'physical',
    });

    expect(result.configurations).toEqual([]);
    expect(result.limitations.join(' ')).toContain('exit 65');
  });

  it('fails closed before invoking xcodebuild for a cross-target destination', async () => {
    let called = false;
    overrideSpawnSync(() => {
      called = true;
      return { exitCode: 0, stdout: '', stderr: '' };
    });
    const result = await discoverXcuitestExecutionAssets({
      root: discovery.root,
      discovery,
      xcuitestTargets: ['DemoUITests'],
      targetKind: 'physical',
      destination: { targetKind: 'simulator', simulatorName: 'iPhone 16 Pro' },
    });
    expect(called).toBe(false);
    expect(result.configurations).toEqual([]);
    expect(result.limitations[0]).toContain('does not match');
  });
});
