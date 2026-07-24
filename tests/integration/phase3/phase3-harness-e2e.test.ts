import { describe, expect, it } from 'bun:test';
import { MockDeviceBackend } from 'itestagent-device-mock';
import {
  BackendRegistry,
  BackendSelector,
  PermissionEngine,
  ToolDispatcher,
} from 'itestagent-engine';

const UDID = '00008110-001A2C3434A0801E';

function setup(pe?: PermissionEngine) {
  // biome-ignore lint/suspicious/noExplicitAny: integration test — mock backend passed through registry
  const mock = new MockDeviceBackend() as any;
  const registry = new BackendRegistry();
  registry.register('mock', mock);
  return new ToolDispatcher({
    permissionEngine: pe ?? new PermissionEngine(),
    backendSelector: new BackendSelector(registry),
    targetKind: 'physical',
  });
}

describe('Phase 3 Harness E2E', () => {
  it('tap → ok', async () => {
    const r = await setup().dispatch({
      id: 'c1',
      name: 'tap',
      arguments: { deviceId: UDID, x: 0.5, y: 0.5 },
    });
    expect(r.status).toBe('ok');
  });
  it('screenshot → ok', async () => {
    const r = await setup().dispatch({
      id: 'c2',
      name: 'screenshot',
      arguments: { deviceId: UDID },
    });
    expect(r.status).toBe('ok');
  });
  it('get_ui_tree → ok', async () => {
    const r = await setup().dispatch({
      id: 'c3',
      name: 'get_ui_tree',
      arguments: { deviceId: UDID },
    });
    expect(r.status).toBe('ok');
  });
  it('launch_app → ok', async () => {
    const r = await setup().dispatch({
      id: 'c4',
      name: 'launch_app',
      arguments: { deviceId: UDID, bundleId: 'com.test.app' },
    });
    expect(r.status).toBe('ok');
  });
  it('PermissionEngine deny → error', async () => {
    const pe = new PermissionEngine();
    pe.addRule({ action: 'tap', resource: '*', effect: 'deny' });
    const r = await setup(pe).dispatch({
      id: 'c5',
      name: 'tap',
      arguments: { deviceId: UDID, x: 0.5, y: 0.5 },
    });
    expect(r.status).toBe('error');
  });
  it('unknown tool → error', async () => {
    const r = await setup().dispatch({ id: 'c6', name: 'ghost_tool', arguments: {} });
    expect(r.status).toBe('error');
  });
  it('invalid tap args → error', async () => {
    // biome-ignore lint/suspicious/noExplicitAny: intentionally invalid args for error-path test
    const r = await setup().dispatch({ id: 'c7', name: 'tap', arguments: { x: 'bad' } as any });
    expect(r.status).toBe('error');
  });
});
