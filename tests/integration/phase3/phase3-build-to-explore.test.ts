/**
 * Phase 3 integration — Build to Explore: DeviceExplorer → MockDeviceBackend → RunStepRecorder → Flow YAML
 */
import { describe, expect, it } from 'bun:test';
import { MockDeviceBackend } from 'itestagent-device-mock';
import {
  BackendRegistry,
  BackendSelector,
  DeviceExplorer,
  PermissionEngine,
  RunStepRecorder,
  ToolDispatcher,
} from 'itestagent-engine';
import { parseFlowYaml, serializeFlowYaml } from 'itestagent-flow';

const SIM_UDID = 'F7C1CF80-9B8A-4E5C-A123-4567890ABCDE';

describe('Phase 3 Build-to-Explore', () => {
  it('DeviceExplorer.explore runs through mock backend', async () => {
    // biome-ignore lint/suspicious/noExplicitAny: integration test — mock backend passed through registry
    const mock = new MockDeviceBackend() as any;
    const registry = new BackendRegistry();
    registry.register('mock', mock);

    const dispatcher = new ToolDispatcher({
      permissionEngine: new PermissionEngine(),
      backendSelector: new BackendSelector(registry),
      targetKind: 'simulator',
    });

    const explorer = new DeviceExplorer(dispatcher, {
      deviceId: SIM_UDID,
      bundleId: 'com.test.app',
      targetKind: 'simulator',
      backendName: 'mock',
    });

    // biome-ignore lint/suspicious/noExplicitAny: integration test — explore step fixture structure
    const steps = await explorer.explore([{ action: 'tap' as const, target: 'Login' } as any]);

    expect(steps.length).toBeGreaterThan(0);
  });

  it('RunStepRecorder.startStep returns stepId', () => {
    const recorder = new RunStepRecorder('mock');
    const stepId = recorder.startStep('tap', 'Login');
    expect(stepId).toBeDefined();
  });

  it('Flow YAML round-trip preserves structure', () => {
    const flow = {
      schemaVersion: 'itestagent.flow.v2',
      flowId: 'phase3-flow',
      source: 'agent-recorded',
      status: 'draft',
      supportedTargetKinds: ['simulator'],
      requiredCapabilities: ['uiTree'],
      lastValidatedTargets: [{ kind: 'simulator', udid: SIM_UDID }],
      steps: [
        { action: 'launchApp', target: 'com.test.app' },
        { action: 'tap', target: 'Login', locator: { strategy: 'label', value: 'Login' } },
      ],
      notes: null,
      // biome-ignore lint/suspicious/noExplicitAny: integration test — FlowV2 test fixture with optional fields
    } as any;

    const yaml = serializeFlowYaml(flow);
    expect(yaml).toContain('phase3-flow');
    expect(yaml).toContain('itestagent.flow.v2');
    expect(yaml).toContain('action: launchApp');
    const parsed = parseFlowYaml(yaml) as Record<string, unknown>;
    expect(parsed.flowId).toBe('phase3-flow');
    const steps = (parsed as Record<string, unknown>).steps as Array<Record<string, unknown>>;
    expect(steps[0]?.action).toBe('launchApp');
  });
});
