import { appendFileSync, writeFileSync } from 'node:fs';
import { TestPlanSchema } from 'itestagent-contracts';
import {
  applyAgentPatch,
  processConfirmedPlan,
} from '../../../../packages/itestagent-tui/src/entry.js';
import { createConfiguredRenderer } from '../../../../packages/itestagent-tui/src/renderer-factory.js';
import {
  type TuiShellState,
  createInitialState,
} from '../../../../packages/itestagent-tui/src/tui-shell.js';

const rendererKind = process.argv[2];
const eventPath = process.argv[3];
const scenario = process.argv[4] ?? 'chat';
if (!rendererKind || !eventPath) {
  throw new Error('usage: renderer-pty-harness.ts <renderer> <event-path>');
}

writeFileSync(eventPath, '');
const selected = await createConfiguredRenderer(rendererKind);
process.stdout.write(`PTY_SELECTED:${selected.kind}\n`);

function stateForScenario(): TuiShellState {
  const initial = createInitialState('/tmp/renderer-pty-workspace');
  if (scenario === 'setup-secret') {
    return {
      ...initial,
      mode: 'setup',
      setupStep: 1,
      setupProvider: 'openai',
      setupBaseUrl: 'https://api.example.com/v1',
      setupModel: 'test-model',
    };
  }
  if (scenario === 'candidate-review') {
    return {
      ...initial,
      mode: 'candidate_review',
      deviceStatus: 'healthy',
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
  if (scenario === 'device-review' || scenario === 'device-to-plan') {
    return {
      ...initial,
      mode: 'device_review',
      deviceStatus: 'discovered',
      deviceSelectionTargetKind: 'physical',
      devices: [
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
      runId: 'run-opentui-pty-review',
      projectProfileRef: `projects/${'a'.repeat(64)}/project-profile.json`,
      target: { type: 'current_workspace' },
      device: { kind: 'physical', physical: { selector: 'local_connected' } },
      appSource: { strategy: 'auto_from_workspace' },
      backendPreference: {},
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
    return { ...initial, mode: 'plan_review', deviceStatus: 'healthy', plan };
  }
  return initial;
}

const initialState = stateForScenario();
let currentState = initialState;
await selected.renderer.start(initialState, (event) => {
  appendFileSync(eventPath, `${JSON.stringify(event)}\n`);
  if (scenario === 'device-to-plan' && event.type === 'device_confirm') {
    currentState = stateForScenarioForPlanTransition(initialState);
    selected.renderer.update(currentState);
  } else if (scenario === 'device-to-plan' && event.type === 'plan_confirm') {
    currentState = {
      ...currentState,
      mode: 'chat',
      planConfirmed: true,
      messages: [
        ...currentState.messages,
        {
          id: 'pty-plan-confirmed',
          type: 'system',
          text: 'Plan confirmed. Starting execution of the confirmed TestPlan.',
          timestamp: Date.now(),
        },
      ],
    };
    selected.renderer.update(currentState);
    void processConfirmedPlan(
      {
        executeConfirmedPlan: async function* () {
          yield {
            type: 'permission_request',
            payload: {
              callId: 'pty-execute-plan',
              action: 'replace_device_app',
              resource: 'com.example.SpikeApp@physical-device-udid',
            },
          };
          await new Promise<void>(() => {});
        },
      },
      (patch) => {
        currentState = applyAgentPatch(currentState, patch);
        selected.renderer.update(currentState);
      },
    );
  }
});

function stateForScenarioForPlanTransition(initial: TuiShellState): TuiShellState {
  const plan = TestPlanSchema.parse({
    schemaVersion: 'itestagent.test-plan.v3',
    runId: 'run-opentui-pty-transition',
    projectProfileRef: `projects/${'a'.repeat(64)}/project-profile.json`,
    target: { type: 'current_workspace' },
    device: { kind: 'physical', physical: { selector: 'by_udid', udid: 'ready-device' } },
    appSource: { strategy: 'auto_from_workspace' },
    backendPreference: {},
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
  return { ...initial, mode: 'plan_review', deviceStatus: 'healthy', plan };
}
