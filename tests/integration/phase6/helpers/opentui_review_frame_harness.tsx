import { testRender } from '@opentui/solid';
import { jsx } from '@opentui/solid/jsx-runtime';
import { TestPlanSchema } from 'itestagent-contracts';
import { OpenTuiApp } from '../../../../packages/itestagent-tui/src/renderers/opentui-renderer.js';
import {
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
const setup = await testRender(
  () =>
    jsx(OpenTuiApp, {
      initialState: state,
      dispatch: () => {},
      setStateRef: () => {},
    }),
  { width: 100, height: 36 },
);
await setup.flush();
process.stdout.write(JSON.stringify({ scenario, frame: setup.captureCharFrame() }));
setup.renderer.destroy();
