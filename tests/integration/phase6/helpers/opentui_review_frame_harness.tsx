import { testRender } from '@opentui/solid';
import { jsx } from '@opentui/solid/jsx-runtime';
import { TestPlanSchema } from 'itestagent-contracts';
import { OpenTuiApp } from '../../../../packages/itestagent-tui/src/renderers/opentui-renderer.js';
import {
  type TuiShellEvent,
  type TuiShellState,
  createInitialState,
} from '../../../../packages/itestagent-tui/src/tui-shell.js';

const scenario = process.argv[2];

function createState(): TuiShellState {
  const initial = {
    ...createInitialState('/tmp/renderer-pty-workspace'),
    deviceStatus: 'healthy' as const,
  };
  if (scenario === 'candidate-review') {
    return {
      ...initial,
      mode: 'candidate_review',
      candidates: [
        {
          name: 'Validation',
          evidence: ['source: SpikeApp/SpikeApp.swift'],
          confidence: 0.5,
          confirmed: true,
          displayOrder: 0,
        },
      ],
    };
  }
  if (scenario === 'chat-activity') {
    return {
      ...initial,
      mode: 'chat',
      deviceStatus: 'discovered',
      agentActivity: { callId: 'device-tool', text: 'Refreshing devices…' },
      messages: [
        {
          id: 'assistant-safe-summary',
          type: 'assistant',
          text: '正在检查已连接的真机。',
          timestamp: 0,
        },
      ],
    };
  }
  if (scenario === 'chat-input-lifecycle') {
    return initial;
  }
  if (scenario === 'device-review') {
    return {
      ...initial,
      mode: 'device_review',
      deviceStatus: 'discovered',
      deviceSelectionTargetKind: 'physical',
      deviceSelectionIndex: 1,
      devices: [
        {
          udid: 'offline-device',
          name: 'Paired iPhone',
          platform: 'ios',
          targetKind: 'physical',
          availability: 'discovered',
        },
        {
          udid: 'ready-device',
          name: 'USB iPhone',
          platform: 'ios',
          targetKind: 'physical',
          availability: 'ready',
        },
      ],
    };
  }
  if (scenario === 'plan-review') {
    const plan = TestPlanSchema.parse({
      schemaVersion: 'itestagent.test-plan.v3',
      runId: 'run-opentui-frame-review',
      projectProfileRef: `projects/${'a'.repeat(64)}/project-profile.json`,
      target: { type: 'current_workspace' },
      device: { kind: 'physical', physical: { selector: 'local_connected' } },
      appSource: { strategy: 'auto_from_workspace' },
      backendPreference: { device: ['appium'] },
      execution: {
        prefer: 'device_backend',
        fallback: 'device_backend',
        resolvedPath: 'device_backend',
        selectionReason: 'confirmed_no_xcuitest_candidate',
        features: ['Validation'],
        testData: { allowAgentGeneratedData: true, askUserInTuiWhenRequired: true },
        assertion: { policy: 'user_goal_then_profile_then_agent_confirmed' },
      },
      artifacts: {
        collect: ['screenshot'],
        report: { outputs: ['summary_md', 'result_json', 'artifact_index_json'] },
      },
      performance: { baseline: 'skip', baselineDomain: 'physical', thresholdRequired: false },
      safety: { defaultMode: 'ask', highRiskActions: [] },
    });
    return { ...initial, mode: 'plan_review', plan };
  }
  throw new Error(`unsupported scenario: ${scenario ?? '(missing)'}`);
}

const state = createState();
const events: TuiShellEvent[] = [];
const setup = await testRender(
  () =>
    jsx(OpenTuiApp, {
      initialState: state,
      dispatch: (event: TuiShellEvent) => events.push(event),
      setStateRef: () => {},
    }),
  { width: 100, height: 36 },
);
await setup.flush();
if (scenario === 'chat-input-lifecycle') {
  await setup.mockInput.typeText(
    '用这台真机测试应用：启动后确认“T6.12 Device Lane”可见，点击“Tap Me”，确认“Taps: 1”可见，并采集截图。',
  );
  setup.mockInput.pressEnter();
  await setup.flush();
  await setup.mockInput.typeText('allow');
  await setup.flush();
}
const frame = setup.captureCharFrame();
const frames = [frame];
if (scenario === 'chat-activity') {
  await new Promise((resolve) => setTimeout(resolve, 120));
  await setup.flush();
  frames.push(setup.captureCharFrame());
}
if (scenario === 'chat-input-lifecycle') {
  setup.mockInput.pressEnter();
  await setup.flush();
}
process.stdout.write(JSON.stringify({ scenario, frame, frames, events }));
setup.renderer.destroy();
