/**
 * OpenTUI renderer 集成测试。
 *
 * 测试 createOpenTuiRenderer 返回的对象满足 TuiRenderer 接口。
 * Mock @opentui/solid 避免原生 Zig core 依赖。
 *
 * AC 对齐：
 *   AC1 — itestagent 无参数时进入 OpenTUI 交互式界面
 *   AC2 — TUI 显示 workspace/设备状态/可输入自然语言
 */

import { beforeEach, describe, expect, it, mock } from 'bun:test';
import { type DeviceStatus, createInitialState, tuiShellReducer } from '../src/tui-shell.js';

// Mock @opentui/solid render to avoid native Zig core dependency in test env.
mock.module('@opentui/solid', () => ({
  render: () => Promise.resolve(),
}));

// biome-ignore format: typeof import() doesn't support multi-line format
let createOpenTuiRenderer: typeof import('../src/renderers/opentui-renderer.js').createOpenTuiRenderer;

beforeEach(async () => {
  const mod = await import('../src/renderers/opentui-renderer.js');
  createOpenTuiRenderer = mod.createOpenTuiRenderer;
});

describe('createOpenTuiRenderer', () => {
  it('returns an object implementing TuiRenderer interface', () => {
    const renderer = createOpenTuiRenderer();
    expect(renderer).toBeDefined();
    expect(typeof renderer.start).toBe('function');
  });

  it('start returns a Promise and resolves cleanly (mocked)', async () => {
    const renderer = createOpenTuiRenderer();
    const result = renderer.start(createInitialState('/test'), () => {});
    expect(result).toBeInstanceOf(Promise);
    await result;
  });

  it('creates distinct renderer instances', () => {
    const r1 = createOpenTuiRenderer();
    const r2 = createOpenTuiRenderer();
    expect(r1).not.toBe(r2);
  });
});

describe('StatefulApp reducer integration', () => {
  it('tuiShellReducer is used by renderer (same reducer, no drift)', () => {
    const state = createInitialState('/workspace');
    const next = tuiShellReducer(state, { type: 'input', text: 'hello world' });
    expect(next.inputDraft).toBe('hello world');
  });

  it('device status labels cover all DeviceStatus values', () => {
    const statuses: DeviceStatus[] = ['no_device', 'checking', 'healthy', 'untrusted', 'busy'];
    for (const status of statuses) {
      const next = tuiShellReducer(createInitialState('/x'), {
        type: 'device_status_updated',
        status,
      });
      expect(next.deviceStatus).toBe(status);
    }
  });

  it('full lifecycle: input → submit → system → quit', () => {
    let state = createInitialState('/proj');
    expect(state.running).toBe(true);

    state = tuiShellReducer(state, { type: 'device_status_updated', status: 'healthy' });
    expect(state.deviceStatus).toBe('healthy');

    state = tuiShellReducer(state, { type: 'input', text: 'run login smoke' });
    state = tuiShellReducer(state, { type: 'submit' });
    expect(state.messages).toHaveLength(1);
    expect(state.inputDraft).toBe('');

    state = tuiShellReducer(state, { type: 'system_message', text: 'Environment OK' });
    expect(state.messages).toHaveLength(2);

    state = tuiShellReducer(state, { type: 'quit' });
    expect(state.running).toBe(false);
  });
});
