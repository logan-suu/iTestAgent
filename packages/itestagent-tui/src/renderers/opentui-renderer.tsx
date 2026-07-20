/**
 * OpenTuiRenderer — OpenTUI+SolidJS 渲染器实现（目标主线）。
 *
 * ADR-008：OpenTUI+SolidJS 为目标主线，对齐 OpenCode TUI 技术栈。
 *
 * US-4.1 AC2：TUI 显示当前 workspace、设备状态、可输入自然语言。
 */

import { render as otRender } from '@opentui/solid';
import type { JSX } from '@opentui/solid';
import { For, Show, createSignal } from 'solid-js';
import { formatConfidenceBar, getConfidenceTier } from '../candidate-review.js';
import { PLAN_SECTIONS, formatPlanSections } from '../plan-review.js';
import type { TuiRenderer } from '../renderer.js';
import {
  type DeviceStatus,
  type Message,
  type TuiShellEvent,
  type TuiShellState,
  tuiShellReducer,
} from '../tui-shell.js';

// ─── 常量 ──────────────────────────────────────────────────────────────

const DEVICE_LABELS: Record<DeviceStatus, string> = {
  no_device: '[no device]',
  checking: '[checking…]',
  healthy: '[✓ connected]',
  untrusted: '[✗ untrusted]',
  busy: '[… busy]',
};

const CONFIDENCE_PREFIX: Record<string, string> = {
  high: '[H]',
  medium: '[M]',
  low: '[L]',
};

// ─── 子组件 ────────────────────────────────────────────────────────────

function Header(props: { workspace: string; deviceStatus: DeviceStatus }): JSX.Element {
  return (
    <box flexDirection="column" borderStyle="single" padding={1} marginBottom={1}>
      <text>
        <text opacity={0.5}>Workspace: </text>
        <text>{props.workspace}</text>
      </text>
      <text>
        <text opacity={0.5}>Device: </text>
        <text>{DEVICE_LABELS[props.deviceStatus]}</text>
      </text>
    </box>
  );
}

function MessageList(props: { messages: readonly Message[] }): JSX.Element {
  const msgs = props.messages;

  return (
    <box flexDirection="column" flexGrow={1} padding={1}>
      {msgs.length === 0 ? (
        <text opacity={0.5}>Type a message and press Enter to send. Ctrl+C to quit.</text>
      ) : (
        msgs.map((msg) => {
          const prefix = msg.type === 'user' ? 'You' : msg.type === 'error' ? 'ERR' : 'Sys';
          return (
            // biome-ignore lint/correctness/useJsxKeyInIterable: OpenTUI uses id as element key
            <text id={msg.id}>
              <text opacity={0.5}>{`[${prefix}] `}</text>
              <text>{msg.text}</text>
            </text>
          );
        })
      )}
    </box>
  );
}

function InputBar(props: {
  draft: string;
  setDraft: (v: string) => void;
  onSubmit: () => void;
}): JSX.Element {
  return (
    <box borderStyle="rounded" padding={1}>
      <text>{'> '}</text>
      <input
        value={props.draft}
        onInput={props.setDraft}
        placeholder="Type here and press Enter to send..."
      />
    </box>
  );
}

// ─── Sub-component: CandidateReviewPanel (US-3.3 AC2) ─────────────────────

function CandidateReviewPanel(props: {
  state: () => TuiShellState;
  dispatch: (event: TuiShellEvent) => void;
}): JSX.Element {
  const s = props.state;
  const dispatch = props.dispatch;
  const [cmd, setCmd] = createSignal('');

  const handleCommand = (value: string) => {
    if (!value) return;
    const key = value === ' ' ? ' ' : value.trim();
    if (!key) return;

    if (s().candidateEditMode) {
      if (key === 'enter') {
        handleEditSubmit();
        return;
      }
      if (key === 'escape') {
        dispatch({ type: 'candidate_edit_cancel' });
        return;
      }
      for (const ch of key) {
        dispatch({ type: 'candidate_edit_input', text: s().candidateEditDraft + ch });
      }
      return;
    }

    switch (key) {
      case 'j':
        dispatch({ type: 'candidate_navigate', direction: 'down' });
        break;
      case 'k':
        dispatch({ type: 'candidate_navigate', direction: 'up' });
        break;
      case ' ':
        dispatch({ type: 'candidate_toggle' });
        break;
      case 'e':
        dispatch({ type: 'candidate_edit_start' });
        break;
      case 'A':
        dispatch({ type: 'candidate_confirm_all' });
        break;
      case 'N':
        dispatch({ type: 'candidate_unconfirm_all' });
        break;
      case 'q':
        dispatch({ type: 'exit_candidate_review' });
        break;
      default:
        break;
    }
  };

  const handleCmdInput = (value: string) => {
    if (!value) {
      setCmd('');
      return;
    }
    handleCommand(value);
    setTimeout(() => setCmd(''), 0);
  };

  const handleEditSubmit = () => {
    if (s().candidateEditMode) {
      dispatch({ type: 'candidate_edit_commit' });
      setCmd('');
    }
  };

  const candidates = s().candidates;
  const idx = s().candidateIndex;

  return (
    <box flexDirection="column" flexGrow={1} padding={1}>
      <box borderStyle="double" padding={1} marginBottom={1}>
        <text>Candidate Core Paths — Review & Confirm</text>
        <text opacity={0.5}>j/k:nav space:toggle e:edit A:all N:none q:done</text>
      </box>

      <scrollbox flexGrow={1} padding={0}>
        <box flexDirection="column">
          <For each={candidates as unknown as Array<(typeof candidates)[number]>}>
            {(candidate, index) => {
              const isSelected = index() === idx;
              const tier = getConfidenceTier(candidate.confidence);
              const marker = candidate.confirmed ? '[x]' : '[ ]';
              const prefix = isSelected ? '>' : ' ';

              return (
                <box
                  flexDirection="column"
                  padding={0}
                  borderStyle={isSelected ? 'single' : undefined}
                  backgroundColor={isSelected ? '#222233' : undefined}
                >
                  <text>
                    <text opacity={0.5}>{`${prefix} ${marker} `}</text>
                    <text>{`${CONFIDENCE_PREFIX[tier]} ${candidate.name}`}</text>
                    <Show when={candidate.keywords && candidate.keywords.length > 0}>
                      <text opacity={0.4}>{`  (${(candidate.keywords ?? []).join(', ')})`}</text>
                    </Show>
                  </text>
                  <text opacity={0.5}>{`    ${formatConfidenceBar(candidate.confidence)}`}</text>
                  <Show when={candidate.evidence && candidate.evidence.length > 0}>
                    <text opacity={0.3}>{`    ev: ${candidate.evidence[0]}`}</text>
                  </Show>
                  <Show when={candidate.requiresAccount}>
                    <text opacity={0.6}>⚠ requires account</text>
                  </Show>
                </box>
              );
            }}
          </For>
        </box>
      </scrollbox>

      <Show when={s().candidateEditMode}>
        <box borderStyle="rounded" padding={1} marginTop={1}>
          <text>{`Edit: "${candidates[idx]?.name ?? ''}" → `}</text>
          <text>{s().candidateEditDraft}</text>
        </box>
      </Show>

      <box borderStyle="rounded" padding={1} marginTop={1}>
        <text
          opacity={0.5}
        >{`${candidates.filter((c) => c.confirmed).length}/${candidates.length} confirmed  `}</text>
        <Show when={s().candidateEditMode}>
          <text opacity={0.5}>Editing — type name, then Enter to save. Escape to cancel </text>
        </Show>
        <Show when={!s().candidateEditMode}>
          <text opacity={0.5}>Cmd: </text>
        </Show>
        <input value={cmd()} onInput={handleCmdInput} placeholder="j/k/space/e/A/N/q" />
      </box>
    </box>
  );
}

// ─── Sub-component: PlanReviewPanel (US-5.2 AC1-AC3) ───────────────────────

function PlanReviewPanel(props: {
  state: () => TuiShellState;
  dispatch: (event: TuiShellEvent) => void;
}): JSX.Element {
  const s = props.state;
  const dispatch = props.dispatch;
  const [cmd, setCmd] = createSignal('');

  const sections = () => {
    const plan = s().plan;
    if (!plan) return [];
    return formatPlanSections(plan);
  };
  const sectionIndex = () => s().planSectionIndex;
  const current = () => sections()[sectionIndex()];

  const handleCommand = (value: string) => {
    if (!value) return;
    const key = value === ' ' ? ' ' : value.trim();
    if (!key) return;

    if (s().planModifyMode) {
      if (key === 'enter') {
        dispatch({ type: 'plan_modify_submit' });
        return;
      }
      if (key === 'escape') {
        dispatch({ type: 'plan_modify_cancel' });
        return;
      }
      for (const ch of key) {
        dispatch({ type: 'plan_modify_input', text: s().planModifyDraft + ch });
      }
      return;
    }

    switch (key) {
      case 'j':
        dispatch({ type: 'plan_navigate_section', direction: 'down' });
        break;
      case 'k':
        dispatch({ type: 'plan_navigate_section', direction: 'up' });
        break;
      case 'm':
        dispatch({ type: 'plan_start_modify' });
        break;
      case 'enter':
        dispatch({ type: 'plan_confirm' });
        break;
      case 'q':
        dispatch({ type: 'plan_cancel' });
        break;
      default:
        break;
    }
  };

  const handleCmdInput = (value: string) => {
    if (!value) {
      setCmd('');
      return;
    }
    handleCommand(value);
    setTimeout(() => setCmd(''), 0);
  };

  return (
    <box flexDirection="column" flexGrow={1} padding={1}>
      <box borderStyle="double" padding={1} marginBottom={1}>
        <text>TestPlan Review — Confirm, Modify or Cancel</text>
        <text opacity={0.5}>j/k:nav m:modify Enter:start q:cancel</text>
      </box>

      <scrollbox flexGrow={1} padding={1}>
        <box flexDirection="column">
          <For each={sections() as unknown as Array<ReturnType<typeof formatPlanSections>[number]>}>
            {(section, index) => {
              const isSelected = index() === sectionIndex();
              const prefix = isSelected ? '>' : ' ';

              return (
                <box
                  flexDirection="column"
                  padding={0}
                  marginBottom={1}
                  borderStyle={isSelected ? 'single' : undefined}
                  backgroundColor={isSelected ? '#222233' : undefined}
                >
                  <text>
                    <text opacity={0.7}>{`${prefix} ${section.title}`}</text>
                  </text>
                  <For each={section.fields as unknown as Array<(typeof section.fields)[number]>}>
                    {(field) => (
                      <box padding={0}>
                        <text>
                          <text opacity={0.4}>{`    ${field.label}: `}</text>
                          <text>{field.value}</text>
                        </text>
                      </box>
                    )}
                  </For>
                </box>
              );
            }}
          </For>
        </box>
      </scrollbox>

      <Show when={s().planModifyMode}>
        <box borderStyle="rounded" padding={1} marginTop={1}>
          <text opacity={0.5}>Modify (natural language): </text>
          <text>{s().planModifyDraft}</text>
        </box>
      </Show>

      <box borderStyle="rounded" padding={1} marginTop={1}>
        <text opacity={0.5}>{`Section ${sectionIndex() + 1}/${sections().length}  `}</text>
        <Show when={s().planModifyMode}>
          <text opacity={0.5}>
            Describe changes in natural language, then Enter to submit. Escape to cancel{' '}
          </text>
        </Show>
        <Show when={!s().planModifyMode}>
          <text opacity={0.5}>Cmd: </text>
        </Show>
        <input value={cmd()} onInput={handleCmdInput} placeholder="j/k/m/Enter/q" />
      </box>
    </box>
  );
}

// ─── App 根组件 ────────────────────────────────────────────────────────

function App(props: {
  initialState: TuiShellState;
  dispatch: (event: TuiShellEvent) => void;
}): JSX.Element {
  const [state, setState] = createSignal<TuiShellState>(props.initialState);
  const [draft, setDraft] = createSignal('');

  const wrappedDispatch = (event: TuiShellEvent) => {
    setState((prev) => tuiShellReducer(prev, event));
    if (event.type === 'input') {
      setDraft(event.text);
    }
    if (event.type === 'submit') {
      setDraft('');
    }
    props.dispatch(event);
  };

  const handleSubmit = () => {
    const currentDraft = draft();
    if (currentDraft.trim()) {
      wrappedDispatch({ type: 'input', text: currentDraft });
      wrappedDispatch({ type: 'submit' });
    }
  };

  return (
    <box flexDirection="column" padding={1}>
      <Header workspace={state().workspace} deviceStatus={state().deviceStatus} />

      {state().mode === 'plan_review' ? (
        <PlanReviewPanel state={state} dispatch={wrappedDispatch} />
      ) : state().mode === 'candidate_review' ? (
        <CandidateReviewPanel state={state} dispatch={wrappedDispatch} />
      ) : (
        <>
          <MessageList messages={state().messages} />
          <InputBar draft={draft()} setDraft={setDraft} onSubmit={handleSubmit} />
        </>
      )}
    </box>
  );
}

// ─── OpenTuiRenderer ───────────────────────────────────────────────────

export function createOpenTuiRenderer(): TuiRenderer {
  return {
    async start(initialState, dispatch) {
      await otRender(() => <App initialState={initialState} dispatch={dispatch} />, {
        stdout: process.stdout,
        stdin: process.stdin,
        exitOnCtrlC: true,
      });
    },
  };
}
