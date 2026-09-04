import { describe, expect, it } from 'bun:test';
import { resolveProductionWdaRoute } from '../src/composition-root.js';

describe('resolveProductionWdaRoute', () => {
  it('selects managed Route B without pretending that an external WDA already exists', () => {
    expect(
      resolveProductionWdaRoute({
        udid: 'PHONE',
        targetKind: 'physical',
      }),
    ).toEqual({
      mode: 'external-url',
      purpose: 'production',
    });
  });

  it('preserves an explicitly supplied external WDA attach endpoint', () => {
    expect(
      resolveProductionWdaRoute({
        udid: 'PHONE',
        targetKind: 'physical',
        webDriverAgentUrl: 'http://127.0.0.1:8200',
      }),
    ).toMatchObject({ webDriverAgentUrl: 'http://127.0.0.1:8200' });
  });

  it('allows Route C only when the caller marks the run as diagnostic', () => {
    const routeC = {
      udid: 'PHONE',
      targetKind: 'physical' as const,
      wdaStartupMode: 'managed-xcodebuild' as const,
      wdaProjectPath: '/tmp/WebDriverAgent.xcodeproj',
    };
    expect(() => resolveProductionWdaRoute(routeC)).toThrow('diagnostic-only');
    expect(resolveProductionWdaRoute({ ...routeC, routePurpose: 'diagnostic' })).toEqual({
      mode: 'managed-xcodebuild',
      purpose: 'diagnostic',
    });
  });

  it('rejects inventory-only preinstalled mode as an execution route', () => {
    expect(() =>
      resolveProductionWdaRoute({
        udid: 'PHONE',
        targetKind: 'physical',
        wdaStartupMode: 'preinstalled',
      }),
    ).toThrow('inventory-only');
  });
});
