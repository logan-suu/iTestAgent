import { testRender } from '@opentui/solid';
import { jsx } from '@opentui/solid/jsx-runtime';
import { TestPlanSchema } from 'itestagent-contracts';
import { applyAgentPatch } from '../../../../packages/itestagent-tui/src/entry.js';
import { OpenTuiApp } from '../../../../packages/itestagent-tui/src/renderers/opentui-renderer.js';
import {
  type TuiShellEvent,
  type TuiShellState,
  createInitialState,
} from '../../../../packages/itestagent-tui/src/tui-shell.js';

const scenario = process.argv[2];
const reviewScenario =
  scenario === 'candidate-edit' ? 'candidate-review' : scenario?.replace('-arrows', '-review');

function createState(): TuiShellState {
  const initial = {
    ...createInitialState('/tmp/renderer-pty-workspace'),
    deviceStatus: 'healthy' as const,
  };
  if (reviewScenario === 'assertion-review') {
    return {
      ...initial,
      mode: 'assertion_review',
      assertionSuggestions: Array.from({ length: 20 }, (_, index) => ({
        id: `assertion-${index}`,
        caseId: 'validation',
        label: `Assertion ${index + 1}`,
        source: 'agent' as const,
        conditions: [{ type: 'no_crash' as const, description: 'No crash' }],
      })),
    };
  }
  if (reviewScenario === 'candidate-review') {
    return {
      ...initial,
      mode: 'candidate_review',
      candidates:
        scenario === 'candidate-arrows'
          ? Array.from({ length: 20 }, (_, index) => ({
              name: `Candidate ${index + 1}`,
              evidence: ['source: fixture.swift'],
              confidence: 0.5,
              confirmed: false,
              displayOrder: index,
            }))
          : [
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
  if (scenario === 'welcome-resize') return initial;
  if (scenario === 'setup-welcome') return { ...initial, mode: 'setup' };
  if (scenario === 'setup-disclosure') {
    return {
      ...initial,
      mode: 'setup',
      setupStep: 4,
      messages: [
        {
          id: 'disclosure',
          type: 'system',
          timestamp: 0,
          text: [
            'Saving to the macOS Keychain requires explicit confirmation.',
            'Scope: device-local Keychain item, not synchronized.',
            'Service: itestagent/openai_api_key',
            'Account: itestagent',
            'Type save to authorize one write, or session to decline.',
          ].join('\n'),
        },
      ],
    };
  }
  if (scenario === 'success-negative') {
    return {
      ...initial,
      messages: [
        { id: 'user-success', type: 'user', text: 'SUCCESS', timestamp: 0 },
        { id: 'assistant-success', type: 'assistant', text: 'SUCCESS', timestamp: 0 },
        { id: 'system-success', type: 'system', text: 'SUCCESS', timestamp: 0 },
        {
          id: 'failed-success',
          type: 'system',
          text: 'SUCCESS',
          runStatus: 'failed',
          timestamp: 0,
        },
        {
          id: 'inconclusive-success',
          type: 'system',
          text: 'SUCCESS',
          runStatus: 'inconclusive',
          timestamp: 0,
        },
      ],
    };
  }
  if (scenario === 'report-complete' || scenario === 'success-resize') {
    return applyAgentPatch(initial, {
      type: 'activity_update',
      payload: { id: 'report-execution', text: 'Saving the run report…' },
    });
  }
  if (scenario === 'success-long-report') {
    const runDirectory = `/tmp/${'long-project-name-'.repeat(12)}/runs/run-example`;
    return {
      ...initial,
      messages: [
        { id: 'previous-system', type: 'system', text: 'Previous system message.', timestamp: 0 },
        {
          id: 'completed-long-report',
          type: 'system',
          runStatus: 'passed',
          timestamp: 0,
          text: [
            'Execution completed. Run run-example committed.',
            `Report directory: ${runDirectory}`,
            `Summary: ${runDirectory}/summary.md`,
            `Evidence directory: ${runDirectory}/artifacts`,
          ].join('\n'),
        },
      ],
    };
  }
  if (scenario === 'permission-timeout') {
    return applyAgentPatch(initial, {
      type: 'permission_request',
      payload: {
        callId: 'ask-wda',
        action: 'prepare_wda',
        resource: 'com.example.App@private-device-fixture',
        timeoutMs: 120_000,
      },
    });
  }
  if (
    reviewScenario === 'device-review' ||
    scenario === 'device-switch' ||
    scenario === 'device-scroll'
  ) {
    return {
      ...initial,
      mode: 'device_review',
      deviceStatus: 'discovered',
      deviceSelectionTargetKind: 'physical',
      deviceSelectionIndex: scenario === 'device-scroll' ? 13 : 1,
      deviceTargetSwitch:
        scenario === 'device-switch'
          ? {
              token: 'switch-fixture',
              udid: 'sim-private',
              name: 'Simulator iPhone',
              from: 'physical',
              to: 'simulator',
            }
          : null,
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
        ...Array.from({ length: scenario === 'device-scroll' ? 12 : 1 }, (_, index) => ({
          udid: `sim-private-${index}`,
          name: `Simulator iPhone ${index + 1}`,
          platform: 'ios' as const,
          targetKind: 'simulator' as const,
          state: 'booted' as const,
          availability: 'ready' as const,
        })),
      ],
    };
  }
  if (reviewScenario === 'plan-review') {
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
const stateRef: { current: ((state: TuiShellState) => void) | null } = { current: null };
const setup = await testRender(
  () =>
    jsx(OpenTuiApp, {
      initialState: state,
      dispatch: (event: TuiShellEvent) => events.push(event),
      setStateRef: stateRef,
    }),
  {
    width: 100,
    height:
      scenario === 'success-long-report'
        ? 28
        : scenario === 'setup-disclosure'
          ? 30
          : scenario === 'welcome-resize' || scenario === 'setup-welcome'
            ? 40
            : 36,
  },
);
try {
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
  if (scenario === 'candidate-edit') {
    await setup.mockInput.typeText('e');
    await setup.flush();
    setup.mockInput.pressArrow('left');
    await setup.mockInput.typeText('X');
    await setup.flush();
    setup.mockInput.pressEnter();
    await setup.flush();
    frames.push(setup.captureCharFrame());
  }
  if (scenario?.endsWith('-arrows')) {
    const count = scenario === 'candidate-arrows' || scenario === 'assertion-arrows' ? 19 : 1;
    for (let index = 0; index < count; index++) {
      setup.mockInput.pressArrow('down');
      await setup.flush();
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
    await setup.flush();
    frames.push(setup.captureCharFrame());
    setup.mockInput.pressEnter();
    await setup.flush();
  }
  function captureBrandSpans() {
    return setup
      .captureSpans()
      .lines.flatMap((line) => line.spans)
      .filter((span) => span.text.includes('SUCCESS') || /[█▀▄].*[█▀▄]/u.test(span.text))
      .map((span) => ({ text: span.text, foreground: span.fg.toInts() }));
  }
  const brandSpanFrames = [captureBrandSpans()];
  function captureNextFrame(): void {
    frames.push(setup.captureCharFrame());
    brandSpanFrames.push(captureBrandSpans());
  }
  if (scenario === 'success-long-report') {
    setup.mockInput.pressKey('\x1b[5~');
    await setup.flush();
    captureNextFrame();
    setup.resize(100, 50);
    await setup.flush();
    captureNextFrame();
  }
  if (scenario === 'welcome-resize' || scenario === 'setup-welcome') {
    setup.resize(scenario === 'welcome-resize' ? 60 : 100, scenario === 'welcome-resize' ? 24 : 30);
    await setup.flush();
    captureNextFrame();
    setup.resize(100, 40);
    await setup.flush();
    captureNextFrame();
    if (scenario === 'welcome-resize') {
      stateRef.current?.({
        ...state,
        agentActivity: { callId: 'started', text: 'Working on the confirmed task…' },
        messages: [{ id: 'task-input', type: 'user', text: 'Test the app.', timestamp: 0 }],
      });
      await setup.flush();
      captureNextFrame();
    }
  }
  if (scenario === 'chat-activity') {
    await new Promise((resolve) => setTimeout(resolve, 120));
    await setup.flush();
    captureNextFrame();
  }
  if (scenario === 'report-complete' || scenario === 'success-resize') {
    const runDirectory = '/tmp/真机 验收/itestagent/runs/run_report_6_12';
    const completed = applyAgentPatch(state, {
      type: 'activity_update',
      payload: { id: 'report-execution', complete: true },
    });
    stateRef.current?.(
      applyAgentPatch(completed, {
        type: 'message_add',
        payload: {
          role: 'system',
          runStatus: 'passed',
          text: [
            'Execution completed. Run run_report_6_12 committed.',
            `Report directory: ${runDirectory}`,
            `Summary: ${runDirectory}/summary.md`,
            `Evidence directory: ${runDirectory}/artifacts`,
          ].join('\n'),
        },
      }),
    );
    await setup.flush();
    captureNextFrame();
    await new Promise((resolve) => setTimeout(resolve, 120));
    await setup.flush();
    captureNextFrame();
    if (scenario === 'success-resize') {
      setup.resize(100, 24);
      await setup.flush();
      captureNextFrame();
      setup.resize(40, 36);
      await setup.flush();
      captureNextFrame();
      setup.resize(100, 36);
      await setup.flush();
      captureNextFrame();
    }
  }
  if (scenario === 'permission-timeout') {
    stateRef.current?.(
      applyAgentPatch(state, {
        type: 'permission_resolved',
        payload: { callId: 'ask-wda', effect: 'deny', reason: 'timeout' },
      }),
    );
    await setup.flush();
    captureNextFrame();
  }
  if (scenario === 'chat-input-lifecycle') {
    setup.mockInput.pressEnter();
    await setup.flush();
  }
  const successSpans = setup
    .captureSpans()
    .lines.flatMap((line) => line.spans)
    .filter((span) => span.text.includes('SUCCESS'))
    .map((span) => ({ text: span.text, foreground: span.fg.toInts() }));
  process.stdout.write(
    JSON.stringify({ scenario, frame, frames, events, successSpans, brandSpanFrames }),
  );
} finally {
  setup.renderer.destroy();
}
