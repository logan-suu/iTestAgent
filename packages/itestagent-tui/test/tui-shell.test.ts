/**
 * TuiShell reducer 单元测试。
 *
 * 技术选型文档 §5：TuiShell ViewModel/Event/reducer 应 framework-independent。
 * 此处测试 reducer 纯函数的正确性，不依赖任何渲染器。
 *
 * AC 对齐：
 *   AC2 — TUI 接收自然语言输入（submit 事件追加消息）
 *   AC3 — CLI 子命令作为辅助入口（本任务不在 TUI 内测试 CLI 命令）
 */

import { describe, expect, it } from 'bun:test';
import {
  type TuiShellEvent,
  type TuiShellState,
  createInitialState,
  tuiShellReducer,
} from '../src/tui-shell.js';

describe('createInitialState', () => {
  it('uses the provided workspace path', () => {
    const state = createInitialState('/Users/test/my-project');
    expect(state.workspace).toBe('/Users/test/my-project');
  });

  it('defaults to process.cwd() when no workspace given', () => {
    const state = createInitialState();
    expect(state.workspace).toBe(process.cwd());
  });

  it('starts with no_device status', () => {
    const state = createInitialState('/x');
    expect(state.deviceStatus).toBe('no_device');
  });

  it('starts with empty messages', () => {
    const state = createInitialState('/x');
    expect(state.messages).toEqual([]);
  });

  it('starts with running: true', () => {
    const state = createInitialState('/x');
    expect(state.running).toBe(true);
  });

  it('starts with empty input draft', () => {
    const state = createInitialState('/x');
    expect(state.inputDraft).toBe('');
  });
});

describe('tuiShellReducer', () => {
  const base = createInitialState('/test/workspace');

  // ── input event ──

  it('input event updates inputDraft', () => {
    const next = tuiShellReducer(base, { type: 'input', text: 'hello' });
    expect(next.inputDraft).toBe('hello');
  });

  it('input event does not mutate original state', () => {
    const next = tuiShellReducer(base, { type: 'input', text: 'hello' });
    expect(base.inputDraft).toBe('');
    expect(next).not.toBe(base);
  });

  it('input event replaces previous draft (overwrite, not append)', () => {
    const s1 = tuiShellReducer(base, { type: 'input', text: 'hello' });
    const s2 = tuiShellReducer(s1, { type: 'input', text: 'world' });
    expect(s2.inputDraft).toBe('world');
  });

  // ── submit event ──

  it('submit with non-empty draft appends user message', () => {
    const s1 = tuiShellReducer(base, { type: 'input', text: 'run login smoke' });
    const s2 = tuiShellReducer(s1, { type: 'submit' });
    expect(s2.messages).toHaveLength(1);
    expect(s2.messages[0]?.type).toBe('user');
    expect(s2.messages[0]?.text).toBe('run login smoke');
  });

  it('submit clears inputDraft after message is added', () => {
    const s1 = tuiShellReducer(base, { type: 'input', text: 'test' });
    const s2 = tuiShellReducer(s1, { type: 'submit' });
    expect(s2.inputDraft).toBe('');
  });

  it('submit with empty draft does NOT add a message', () => {
    const next = tuiShellReducer(base, { type: 'submit' });
    expect(next.messages).toHaveLength(0);
    expect(next.inputDraft).toBe('');
  });

  it('submit with whitespace-only draft does NOT add a message', () => {
    const s1 = tuiShellReducer(base, { type: 'input', text: '   ' });
    const s2 = tuiShellReducer(s1, { type: 'submit' });
    expect(s2.messages).toHaveLength(0);
  });

  it('multiple submits accumulate messages', () => {
    let state = base;
    state = tuiShellReducer(state, { type: 'input', text: 'msg1' });
    state = tuiShellReducer(state, { type: 'submit' });
    state = tuiShellReducer(state, { type: 'input', text: 'msg2' });
    state = tuiShellReducer(state, { type: 'submit' });
    expect(state.messages).toHaveLength(2);
    expect(state.messages[0]?.text).toBe('msg1');
    expect(state.messages[1]?.text).toBe('msg2');
  });

  it('submit generates unique message IDs', () => {
    let state = base;
    state = tuiShellReducer(state, { type: 'input', text: 'a' });
    state = tuiShellReducer(state, { type: 'submit' });
    state = tuiShellReducer(state, { type: 'input', text: 'b' });
    state = tuiShellReducer(state, { type: 'submit' });
    expect(state.messages[0]?.id).not.toBe(state.messages[1]?.id);
  });

  it('submit records timestamp on each message', () => {
    const before = Date.now();
    let state = base;
    state = tuiShellReducer(state, { type: 'input', text: 'x' });
    state = tuiShellReducer(state, { type: 'submit' });
    expect(state.messages[0]?.timestamp).toBeGreaterThanOrEqual(before);
    expect(state.messages[0]?.timestamp).toBeLessThanOrEqual(Date.now());
  });

  // ── system_message event ──

  it('system_message event appends system message', () => {
    const next = tuiShellReducer(base, { type: 'system_message', text: 'Backend connected' });
    expect(next.messages).toHaveLength(1);
    expect(next.messages[0]?.type).toBe('system');
    expect(next.messages[0]?.text).toBe('Backend connected');
  });

  it('system_message does not affect inputDraft', () => {
    const next = tuiShellReducer(base, { type: 'system_message', text: 'OK' });
    expect(next.inputDraft).toBe('');
  });

  // ── device_status_updated event ──

  it('device_status_updated updates device status', () => {
    const next = tuiShellReducer(base, { type: 'device_status_updated', status: 'healthy' });
    expect(next.deviceStatus).toBe('healthy');
  });

  it('device_status_updated does not affect messages', () => {
    const next = tuiShellReducer(base, { type: 'device_status_updated', status: 'untrusted' });
    expect(next.messages).toHaveLength(0);
  });

  // ── quit event ──

  it('quit event sets running to false', () => {
    const next = tuiShellReducer(base, { type: 'quit' });
    expect(next.running).toBe(false);
  });

  it('quit event preserves all other state', () => {
    const s1 = tuiShellReducer(base, { type: 'input', text: 'unfinished' });
    const s2 = tuiShellReducer(s1, { type: 'quit' });
    expect(s2.inputDraft).toBe('unfinished');
    expect(s2.messages).toEqual(s1.messages);
    expect(s2.workspace).toBe(s1.workspace);
  });

  // ── immutability ──

  it('reducer never mutates the input state', () => {
    const frozen = Object.freeze({ ...base, messages: Object.freeze([...base.messages]) });
    // Should not throw
    expect(() => tuiShellReducer(frozen, { type: 'input', text: 't' })).not.toThrow();
    expect(() => tuiShellReducer(frozen, { type: 'quit' })).not.toThrow();
  });
});
