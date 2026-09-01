import { describe, expect, it } from 'bun:test';
import type { RunnableXcuitestConfiguration } from 'itestagent-contracts';
import { resolveExecutionRoute } from '../src/execution-route-resolver.js';

function configuration(
  scheme: string,
  overrides: Partial<RunnableXcuitestConfiguration> = {},
): RunnableXcuitestConfiguration {
  return {
    scheme,
    targets: [`${scheme}UITests`],
    targetKind: 'physical',
    isDefault: true,
    evidence: ['xcodebuild enumeration succeeded'],
    limitations: [],
    ...overrides,
  };
}

describe('resolveExecutionRoute (ADR-029 matrix)', () => {
  it('honors an explicit DeviceBackend preference regardless of XCUITest assets', () => {
    expect(
      resolveExecutionRoute({
        preference: 'device_backend',
        targetKind: 'physical',
        configurations: [configuration('Demo')],
      }),
    ).toMatchObject({
      status: 'resolved',
      resolvedPath: 'device_backend',
      selectionReason: 'explicit_preference',
    });
  });

  it('resolves auto to the unique runnable configuration', () => {
    expect(
      resolveExecutionRoute({
        preference: 'auto',
        targetKind: 'physical',
        configurations: [configuration('Demo')],
      }),
    ).toMatchObject({
      status: 'resolved',
      resolvedPath: 'xcuitest',
      selectionReason: 'runnable_xcuitest',
      xcuitest: { scheme: 'Demo', targets: ['DemoUITests'] },
    });
  });

  it('chooses one explicit default among multiple configurations', () => {
    const result = resolveExecutionRoute({
      preference: 'auto',
      targetKind: 'physical',
      configurations: [
        configuration('Demo', { testPlan: 'Smoke', isDefault: true }),
        configuration('Demo', { testPlan: 'Regression', isDefault: false }),
      ],
    });
    expect(result).toMatchObject({
      status: 'resolved',
      xcuitest: { scheme: 'Demo', testPlan: 'Smoke' },
    });
  });

  it('asks for selection when auto has multiple defaults', () => {
    const result = resolveExecutionRoute({
      preference: 'auto',
      targetKind: 'physical',
      configurations: [configuration('One'), configuration('Two')],
    });
    expect(result).toMatchObject({ status: 'ambiguous' });
  });

  it('blocks explicit XCUITest when unavailable or ambiguous', () => {
    expect(
      resolveExecutionRoute({
        preference: 'xcuitest',
        targetKind: 'physical',
        configurations: [],
      }),
    ).toMatchObject({ status: 'blocked', code: 'xcuitest_unavailable' });
    expect(
      resolveExecutionRoute({
        preference: 'xcuitest',
        targetKind: 'physical',
        configurations: [configuration('One'), configuration('Two')],
      }),
    ).toMatchObject({ status: 'blocked', code: 'xcuitest_ambiguous' });
  });

  it('does not turn an unmatched explicit scheme selection into DeviceBackend fallback', () => {
    expect(
      resolveExecutionRoute({
        preference: 'auto',
        targetKind: 'physical',
        configurations: [configuration('Available')],
        selectedScheme: 'Missing',
      }),
    ).toMatchObject({ status: 'blocked', code: 'xcuitest_unavailable', candidates: [] });
  });

  it('does not consider a configuration for the other target kind', () => {
    expect(
      resolveExecutionRoute({
        preference: 'auto',
        targetKind: 'simulator',
        configurations: [configuration('DeviceOnly')],
      }),
    ).toMatchObject({
      status: 'resolved',
      resolvedPath: 'device_backend',
      selectionReason: 'no_runnable_xcuitest',
    });
  });

  it('records a user selection after ambiguity', () => {
    expect(
      resolveExecutionRoute({
        preference: 'auto',
        targetKind: 'physical',
        configurations: [configuration('One'), configuration('Two')],
        selectedScheme: 'Two',
        selectedAfterAmbiguity: true,
      }),
    ).toMatchObject({
      status: 'resolved',
      selectionReason: 'user_selected_after_ambiguity',
      xcuitest: { scheme: 'Two' },
    });
  });
});
