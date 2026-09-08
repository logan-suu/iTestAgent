import { describe, expect, test } from 'bun:test';
import type { DeviceInfo } from 'itestagent-contracts';
import { deviceReviewLines, devicesForReview } from '../src/device-review.js';
import { applyAgentPatch } from '../src/entry.js';
import { renderFrame } from '../src/renderers/ansi-renderer-frame.js';
import { dispatchDeviceKey } from '../src/renderers/opentui-key-dispatch.js';
import { type TuiShellEvent, createInitialState, tuiShellReducer } from '../src/tui-shell.js';

const physical: DeviceInfo = {
  udid: 'phone',
  name: 'Phone',
  platform: 'ios',
  targetKind: 'physical',
  availability: 'ready',
};
const simulator: DeviceInfo = {
  udid: 'sim',
  name: 'Simulator',
  platform: 'ios',
  targetKind: 'simulator',
  availability: 'discovered',
  state: 'shutdown',
};
const request = {
  token: 'one-shot',
  udid: 'sim',
  name: 'Simulator',
  from: 'physical' as const,
  to: 'simulator' as const,
};
const initial = () =>
  tuiShellReducer(createInitialState('/test'), {
    type: 'enter_device_review',
    targetKind: 'physical',
    devices: [simulator, physical],
  });

describe('grouped target review', () => {
  test('shares one ordered inventory between keyboard navigation and renderer output', () => {
    let state = initial();
    expect(devicesForReview(state.devices)).toEqual([physical, simulator]);
    expect(state.deviceSelectionIndex).toBe(0);
    state = tuiShellReducer(state, { type: 'device_navigate', direction: 'down' });
    expect(state.deviceSelectionIndex).toBe(1);
    const output = deviceReviewLines(state).join('\n');
    expect(output).toContain('physical (current plan)');
    expect(output).toContain('> Simulator');
    expect(output).toContain('shutdown');
    expect(renderFrame(state).join('\n')).toContain(output);
    expect(
      tuiShellReducer(state, { type: 'device_navigate', direction: 'down' }).deviceSelectionIndex,
    ).toBe(0);
  });

  test('freezes the selection during confirmation and clears it on refresh or cancel', () => {
    const state = applyAgentPatch(initial(), {
      type: 'device_target_switch_request',
      payload: request,
    });
    expect(state.deviceTargetSwitch).toEqual(request);
    expect(deviceReviewLines(state).join('\n')).toContain('y:confirm n:keep current plan');
    expect(tuiShellReducer(state, { type: 'device_navigate', direction: 'down' })).toBe(state);
    expect(tuiShellReducer(state, { type: 'device_confirm' })).toBe(state);
    expect(tuiShellReducer(state, { type: 'device_refresh' }).deviceTargetSwitch).toBeNull();
    expect(tuiShellReducer(state, { type: 'device_cancel' }).deviceTargetSwitch).toBeNull();
    expect(tuiShellReducer(state, { type: 'planning_reset' }).deviceTargetSwitch).toBeNull();
  });

  test('requires a distinct y or n event rather than treating Enter as switch approval', () => {
    const events: TuiShellEvent[] = [];
    for (const key of ['enter', 'y', 'n']) dispatchDeviceKey((event) => events.push(event), key);
    expect(events).toEqual([
      { type: 'device_confirm' },
      { type: 'device_target_switch_decision', allow: true },
      { type: 'device_target_switch_decision', allow: false },
    ]);
  });

  test('keeps both empty groups visible', () => {
    const state = { ...initial(), devices: [] };
    expect(deviceReviewLines(state).join('\n')).toContain('physical (current plan)');
    expect(deviceReviewLines(state).join('\n')).toContain('simulator');
    expect(deviceReviewLines(state).join('\n')).toContain('No targets discovered');
  });
});
