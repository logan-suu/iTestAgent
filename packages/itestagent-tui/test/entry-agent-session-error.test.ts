import { describe, expect, it } from 'bun:test';
import {
  agentSessionErrorMessage,
  applyAgentPatch,
  createLatestOperationGate,
  processConfirmedPlan,
  requiresProviderSetup,
} from '../src/entry.js';
import { createInitialState } from '../src/tui-shell.js';

describe('agentSessionErrorMessage', () => {
  it('maps an error to a readable message', () => {
    expect(agentSessionErrorMessage(new Error('boom'))).toContain('boom');
  });
});

describe('requiresProviderSetup', () => {
  it('enters setup when config is missing or its Keychain credential is unavailable', () => {
    expect(requiresProviderSetup(true, false)).toBe(true);
    expect(requiresProviderSetup(false, false)).toBe(true);
  });

  it('starts the configured session only when config and credential are both available', () => {
    expect(requiresProviderSetup(false, true)).toBe(false);
  });
});

describe('createLatestOperationGate', () => {
  it('accepts only the newest async operation result', () => {
    const gate = createLatestOperationGate();
    const stale = gate.begin();
    const current = gate.begin();

    expect(gate.isCurrent(stale)).toBe(false);
    expect(gate.isCurrent(current)).toBe(true);
  });

  it('invalidates an in-flight result when the user leaves the review flow', () => {
    const gate = createLatestOperationGate();
    const pending = gate.begin();
    gate.invalidate();

    expect(gate.isCurrent(pending)).toBe(false);
  });
});

describe('processConfirmedPlan', () => {
  it('publishes visible execution activity before waiting for the first session patch', async () => {
    let releaseFirstPatch: (() => void) | undefined;
    const firstPatchReady = new Promise<void>((resolve) => {
      releaseFirstPatch = resolve;
    });
    const patches: Array<{ type: string; payload: Record<string, unknown> }> = [];
    const processing = processConfirmedPlan(
      {
        executeConfirmedPlan: async function* () {
          await firstPatchReady;
          yield {
            type: 'permission_request',
            payload: {
              callId: 'execute-1',
              action: 'replace_device_app',
              resource: 'com.example.App@device-udid',
            },
          };
        },
      },
      (patch) => patches.push(patch),
    );

    expect(patches[0]).toMatchObject({
      type: 'activity_update',
      payload: { text: 'Preparing confirmed TestPlan execution…' },
    });
    releaseFirstPatch?.();
    await processing;
    expect(patches.some((patch) => patch.type === 'permission_request')).toBe(true);
  });

  it('reports a direct execution stream that ends without a terminal lifecycle patch', async () => {
    const patches: Array<{ type: string; payload: Record<string, unknown> }> = [];
    await processConfirmedPlan(
      {
        executeConfirmedPlan: async function* () {},
      },
      (patch) => patches.push(patch),
    );

    expect(patches.at(-1)).toEqual({
      type: 'error',
      payload: { message: 'Confirmed TestPlan execution ended without a lifecycle result.' },
    });
  });
});

describe('applyAgentPatch', () => {
  it('updates device status from observed discovery results', () => {
    const initial = createInitialState('/workspace');
    const updated = applyAgentPatch(initial, {
      type: 'devices_update',
      payload: {
        discoveryStatus: 'ok',
        devices: [
          {
            udid: 'device-1',
            platform: 'ios',
            targetKind: 'physical',
            availability: 'ready',
          },
        ],
      },
    });
    expect(updated.deviceStatus).toBe('discovered');
  });

  it('does not mark shutdown-only Simulator inventory healthy', () => {
    const updated = applyAgentPatch(createInitialState('/workspace'), {
      type: 'devices_update',
      payload: {
        discoveryStatus: 'ok',
        devices: [
          {
            udid: 'sim-1',
            platform: 'ios',
            targetKind: 'simulator',
            state: 'shutdown',
            availability: 'discovered',
          },
        ],
      },
    });
    expect(updated.deviceStatus).toBe('unavailable');
  });

  it('scopes readiness to the requested physical target when a Simulator is ready', () => {
    const updated = applyAgentPatch(createInitialState('/workspace'), {
      type: 'devices_update',
      payload: {
        discoveryStatus: 'ok',
        targetKind: 'physical',
        devices: [
          {
            udid: 'phone-offline',
            platform: 'ios',
            targetKind: 'physical',
            availability: 'discovered',
          },
          {
            udid: 'sim-ready',
            platform: 'ios',
            targetKind: 'simulator',
            state: 'booted',
            availability: 'ready',
          },
        ],
      },
    });
    expect(updated.deviceStatus).toBe('unavailable');
  });

  it('does not preserve connected status when a new planning cycle clears selection', () => {
    const selected = {
      ...createInitialState('/workspace'),
      deviceStatus: 'healthy' as const,
      selectedDeviceUdid: 'phone-ready',
      devices: [
        {
          udid: 'phone-ready',
          platform: 'ios' as const,
          targetKind: 'physical' as const,
          availability: 'ready' as const,
        },
      ],
    };
    const reset = applyAgentPatch(selected, { type: 'planning_reset', payload: {} });
    expect(reset.selectedDeviceUdid).toBeNull();
    expect(reset.deviceStatus).toBe('discovered');
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
    expect(updated.agentActivity?.text).toContain('Awaiting permission: generate_draft_test');
    expect(updated.agentActivity?.text).toContain('type allow + Enter');
  });

  it.each(['execute_project_build', 'replace_device_app', 'prepare_wda'])(
    'does not place a selected device UDID in the %s permission transcript',
    (action) => {
      const updated = applyAgentPatch(createInitialState('/workspace'), {
        type: 'permission_request',
        payload: {
          callId: 'call-device',
          action,
          resource: 'com.example.App@device-fixture',
          timeoutMs: 120_000,
        },
      });

      expect(updated.messages.at(-1)?.text).toContain('com.example.App@selected device');
      expect(updated.messages.at(-1)?.text).not.toContain('device-fixture');
      expect(updated.messages.at(-1)?.text).toContain('Execution is paused');
      expect(updated.messages.at(-1)?.text).toContain('press Enter');
      expect(updated.messages.at(-1)?.text).toContain('120s');
      expect(updated.agentActivity?.text).toContain(`Awaiting permission: ${action}`);
    },
  );

  it.each(['timeout', 'cancelled', 'error'])(
    'does not describe a %s resolution as an explicit user denial',
    (reason) => {
      const waiting = applyAgentPatch(createInitialState('/workspace'), {
        type: 'permission_request',
        payload: { callId: 'ask-1', action: 'prepare_wda', resource: 'com.example.App' },
      });
      const stopped = applyAgentPatch(waiting, {
        type: 'permission_resolved',
        payload: { callId: 'ask-1', effect: 'deny', reason },
      });
      expect(stopped.agentActivity).toBeNull();
      expect(stopped.messages.at(-1)?.text).toContain('execution stopped');
      expect(stopped.messages.at(-1)?.text).not.toContain('Permission deny.');
      if (reason === 'timeout') {
        expect(stopped.messages.at(-1)?.text).toContain('without a response');
      }
    },
  );

  it('preserves the explicit user denial message', () => {
    const denied = applyAgentPatch(createInitialState('/workspace'), {
      type: 'permission_resolved',
      payload: { callId: 'ask-1', effect: 'deny' },
    });
    expect(denied.messages.at(-1)?.text).toBe('Permission deny.');
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

  it('keeps tool activity transient and outside the chat transcript', () => {
    const active = applyAgentPatch(createInitialState('/workspace'), {
      type: 'activity_update',
      payload: { id: 'tool-1', text: 'Refreshing devices…' },
    });
    expect(active.agentActivity).toEqual({
      callId: 'tool-1',
      text: 'Refreshing devices…',
    });
    expect(active.messages).toEqual([]);

    const completed = applyAgentPatch(active, {
      type: 'activity_update',
      payload: { id: 'tool-1', complete: true },
    });
    expect(completed.agentActivity).toBeNull();
    expect(completed.messages).toEqual([]);
  });
});
