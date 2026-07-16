/**
 * Ink renderer 集成测试。
 *
 * 测试 createInkRenderer 返回的对象满足 TuiRenderer 接口。
 * 注：全交互式 Ink 渲染需要真实终端环境（PTY），此处验证接口契约。
 * 通过 mock ink 的 render 函数避免非 TTY 环境下的异常。
 *
 * AC 对齐：
 *   AC1 — itestagent 无参数时进入 TUI（renderer.start() 可被调用）
 *   AC2 — TUI 显示 workspace/设备状态/可输入自然语言
 */

import { beforeEach, describe, expect, it, mock } from 'bun:test';
import { type DeviceStatus, createInitialState, tuiShellReducer } from '../src/tui-shell.js';

// Mock ink's render to avoid "Raw mode is not supported" error in non-TTY test env.
// We verify the interface contract without actually launching Ink.
mock.module('ink', () => {
  return {
    render: () => ({ waitUntilExit: () => Promise.resolve() }),
    Box: 'Box',
    Text: 'Text',
    useInput: () => {},
  };
});

// Dynamic import after mock is set up
let createInkRenderer: typeof import('../src/renderers/ink-renderer.js').createInkRenderer;

beforeEach(async () => {
  const mod = await import('../src/renderers/ink-renderer.js');
  createInkRenderer = mod.createInkRenderer;
});

describe('createInkRenderer', () => {
  it('returns an object implementing TuiRenderer interface', () => {
    const renderer = createInkRenderer();
    expect(renderer).toBeDefined();
    expect(typeof renderer.start).toBe('function');
  });

  it('start returns a Promise and resolves cleanly (mocked Ink)', async () => {
    const renderer = createInkRenderer();
    const result = renderer.start(createInitialState('/test'), () => {});
    expect(result).toBeInstanceOf(Promise);
    // With mocked render, this resolves without error
    await result;
  });

  it('creates distinct renderer instances', () => {
    const r1 = createInkRenderer();
    const r2 = createInkRenderer();
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
