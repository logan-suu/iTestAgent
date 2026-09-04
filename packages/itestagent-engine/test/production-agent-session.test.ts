import { describe, expect, test } from 'bun:test';
import type { DeviceInfo } from 'itestagent-contracts';
import { createProductionAgentSessionDependencies } from '../src/production-agent-session.js';

const physical: DeviceInfo = {
  udid: 'physical-1',
  platform: 'ios',
  targetKind: 'physical',
};

const simulator: DeviceInfo = {
  udid: 'simulator-1',
  platform: 'ios',
  targetKind: 'simulator',
  state: 'booted',
};

describe('production WDA permission facts', () => {
  test('marks the default managed physical Route B as preparing WDA', () => {
    const production = createProductionAgentSessionDependencies();
    expect(production.preparesWda?.(physical)).toBe(true);
  });

  test('does not request WDA preparation when attaching to an explicit URL', () => {
    const production = createProductionAgentSessionDependencies({
      appium: {
        wdaStartupMode: 'external-url',
        webDriverAgentUrl: 'http://127.0.0.1:8100',
      },
    });
    expect(production.preparesWda?.(physical)).toBe(false);
  });

  test('marks explicit managed Route C as preparing WDA', () => {
    const production = createProductionAgentSessionDependencies({
      appium: { wdaStartupMode: 'managed-xcodebuild', routePurpose: 'diagnostic' },
    });
    expect(production.preparesWda?.(physical)).toBe(true);
  });

  test('never reports Simulator execution as managed physical WDA preparation', () => {
    const production = createProductionAgentSessionDependencies();
    expect(production.preparesWda?.(simulator)).toBe(false);
  });
});
