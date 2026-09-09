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

  test('reports Simulator WDA build and launch as a separate preparation action', () => {
    const production = createProductionAgentSessionDependencies();
    expect(production.preparesWda?.(simulator)).toBe(true);
  });
});

test('isolated Simulator settings are validated and do not alter the physical route', () => {
  const options = {
    appiumServerUrl: 'http://127.0.0.1:4727',
    wdaLocalPort: 8213,
    mjpegServerPort: 9213,
    derivedDataPath: '/tmp/fixture-wda',
  };
  const production = createProductionAgentSessionDependencies({ simulatorAppium: options });
  expect(production.preparesWda?.(physical)).toBe(true);
  const simBackend = production.createDeviceBackend(simulator) as unknown as {
    opts: Record<string, unknown>;
  };
  const physicalBackend = production.createDeviceBackend(physical) as unknown as {
    opts: Record<string, unknown>;
  };
  expect(simBackend.opts.wdaLocalPort).toBe(8213);
  expect(simBackend.opts.derivedDataPath).toBe(options.derivedDataPath);
  expect(physicalBackend.opts.wdaLocalPort).toBe(8100);
  expect(physicalBackend.opts.derivedDataPath).toBeUndefined();
  for (const patch of [
    { appiumServerUrl: 'https://example.com' },
    { appiumServerUrl: 'http://token@127.0.0.1:4727' },
    { wdaLocalPort: 9213 },
    { mjpegServerPort: 4727 },
    { derivedDataPath: 'relative' },
    { wdaLocalPort: Number.NaN },
  ])
    expect(() =>
      createProductionAgentSessionDependencies({ simulatorAppium: { ...options, ...patch } }),
    ).toThrow('simulator_connection.');
});
