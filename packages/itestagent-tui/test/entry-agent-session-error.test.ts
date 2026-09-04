import { describe, expect, it } from 'bun:test';
import { agentSessionErrorMessage, applyAgentPatch } from '../src/entry.js';
import { createInitialState } from '../src/tui-shell.js';

describe('agentSessionErrorMessage', () => {
  it('maps an error to a readable message', () => {
    expect(agentSessionErrorMessage(new Error('boom'))).toContain('boom');
  });
});

describe('applyAgentPatch', () => {
  it('updates device status from observed discovery results', () => {
    const initial = createInitialState('/workspace');
    const updated = applyAgentPatch(initial, {
      type: 'devices_update',
      payload: { devices: [{ udid: 'device-1', targetKind: 'physical' }] },
    });
    expect(updated.deviceStatus).toBe('healthy');
  });

  it('does not mark shutdown-only Simulator inventory healthy', () => {
    const updated = applyAgentPatch(createInitialState('/workspace'), {
      type: 'devices_update',
      payload: {
        discoveryStatus: 'ok',
        devices: [{ udid: 'sim-1', targetKind: 'simulator', state: 'shutdown' }],
      },
    });
    expect(updated.deviceStatus).toBe('unavailable');
  });

  it('shows partial and failed discovery explicitly', () => {
    const partial = applyAgentPatch(createInitialState('/workspace'), {
      type: 'devices_update',
      payload: { discoveryStatus: 'partial', devices: [] },
    });
    const failed = applyAgentPatch(createInitialState('/workspace'), {
      type: 'devices_update',
      payload: { discoveryStatus: 'failed', devices: [] },
    });
    expect(partial.deviceStatus).toBe('degraded');
    expect(failed.deviceStatus).toBe('unavailable');
  });

  it('renders a permission request with explicit choices', () => {
    const initial = createInitialState('/workspace');
    const updated = applyAgentPatch(initial, {
      type: 'permission_request',
      payload: { callId: 'call-1', action: 'generate_draft_test', resource: '/workspace' },
    });
    expect(updated.messages.at(-1)?.text).toContain('allow, deny, or always-deny');
    expect(updated.messages.at(-1)?.text).toContain('Allow applies to this action only');
    expect(updated.messages.at(-1)?.text).toContain('generate_draft_test');
  });

  it('preserves workspace and existing messages while streaming', () => {
    const initial = applyAgentPatch(createInitialState('/workspace'), {
      type: 'message_add',
      payload: { text: 'Existing state' },
    });
    const updated = applyAgentPatch(initial, {
      type: 'message_update',
      payload: { id: 'turn-1', text: 'Assistant output' },
    });
    expect(updated.workspace).toBe('/workspace');
    expect(updated.messages.map((message) => message.text)).toEqual([
      'Existing state',
      'Assistant output',
    ]);
  });
});
