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
      payload: { devices: [{ udid: 'device-1' }] },
    });
    expect(updated.deviceStatus).toBe('healthy');
  });

  it('renders a permission request with explicit choices', () => {
    const initial = createInitialState('/workspace');
    const updated = applyAgentPatch(initial, {
      type: 'permission_request',
      payload: { callId: 'call-1', action: 'generate_draft_test', resource: '/workspace' },
    });
    expect(updated.messages.at(-1)?.text).toContain('allow, session, or deny');
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
