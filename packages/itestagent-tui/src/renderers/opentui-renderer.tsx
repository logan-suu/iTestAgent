/**
 * OpenTuiRenderer — OpenTUI+SolidJS 渲染器实现（目标主线）。
 *
 * ADR-008：OpenTUI+SolidJS 为目标主线，对齐 OpenCode TUI 技术栈。
 *
 * US-4.1 AC2：TUI 显示当前 workspace、设备状态、可输入自然语言。
 */

import { render as otRender } from '@opentui/solid';
import type { JSX } from '@opentui/solid';
import { For, Show, createMemo, createSignal } from 'solid-js';
import {
  ASSERTION_REVIEW_FOOTER_HINTS,
  assertionFooterStatus,
  formatAssertionSuggestions,
} from '../assertion-review.js';
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
import { CredentialPromptPanel } from './credential-prompt-panel.jsx';
import {
  CANDIDATE_EDITING_HINT,
  CANDIDATE_REVIEW_FOOTER_HINTS,
  FOOTER_CMD_LABEL,
  PLAN_MODIFYING_HINT,
  PLAN_REVIEW_FOOTER_HINTS,
  candidateFooterStatus,
  planFooterStatus,
} from './opentui-footer.js';
import { dispatchCandidateKey, dispatchPlanKey } from './opentui-key-dispatch.js';
import {
  type OpenTuiStateRef,
  createOpenTuiLifecycle,
  draftForEvent,
} from './opentui-renderer-lifecycle.js';
import { RecordingPanel } from './recording-panel.jsx';

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
        <span>Workspace: </span>
        <span>{props.workspace}</span>
      </text>
      <text>
        <span>Device: </span>
        <span>{DEVICE_LABELS[props.deviceStatus]}</span>
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
          let prefix: string;
          switch (msg.type) {
            case 'user':
              prefix = 'You';
              break;
            case 'assistant':
              prefix = 'AI';
              break;
            case 'error':
              prefix = 'ERR';
              break;
            default:
              prefix = 'Sys';
              break;
          }
          return (
            // biome-ignore lint/correctness/useJsxKeyInIterable: OpenTUI uses id as element key
            <text id={msg.id}>
              <span>{`[${prefix}] `}</span>
              <span>{msg.text}</span>
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
        focused={true}
        value={props.draft}
        onInput={props.setDraft}
        onSubmit={props.onSubmit}
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
    const result = dispatchCandidateKey(
      { dispatch, editMode: s().candidateEditMode, editDraft: s().candidateEditDraft },
      value,
    );
    if (result === 'edit-committed') {
      setCmd('');
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

  const candidates = createMemo(() => s().candidates);
  const idx = createMemo(() => s().candidateIndex);

  return (
    <box flexDirection="column" flexGrow={1} padding={1}>
      <box borderStyle="double" padding={1} marginBottom={1}>
        <text>Candidate Core Paths — Review & Confirm</text>
        <text opacity={0.5}>{CANDIDATE_REVIEW_FOOTER_HINTS}</text>
      </box>

      <scrollbox flexGrow={1} padding={0}>
        <box flexDirection="column">
          <For each={candidates()}>
            {(candidate, index) => {
              const isSelected = index() === idx();
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
                    <span>{`${prefix} ${marker} `}</span>
                    <span>{`${CONFIDENCE_PREFIX[tier]} ${candidate.name}`}</span>
                    <Show when={candidate.keywords && candidate.keywords.length > 0}>
                      <span>{`  (${(candidate.keywords ?? []).join(', ')})`}</span>
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
          <text>{`Edit: "${candidates()[idx()]?.name ?? ''}" → `}</text>
          <text>{s().candidateEditDraft}</text>
        </box>
      </Show>

      <box borderStyle="rounded" padding={1} marginTop={1}>
        <text opacity={0.5}>
          {candidateFooterStatus(
            candidates().filter((c) => c.confirmed).length,
            candidates().length,
          )}
        </text>
        <Show when={s().candidateEditMode}>
          <text opacity={0.5}>{CANDIDATE_EDITING_HINT}</text>
        </Show>
        <Show when={!s().candidateEditMode}>
          <text opacity={0.5}>{FOOTER_CMD_LABEL}</text>
        </Show>
        <input
          focused={true}
          value={cmd()}
          onInput={handleCmdInput}
          placeholder="j/k/space/e/A/N/q"
        />
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

  const handleCommand = (value: string) => {
    dispatchPlanKey(
      { dispatch, editMode: s().planModifyMode, editDraft: s().planModifyDraft },
      value,
    );
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
        <text opacity={0.5}>{PLAN_REVIEW_FOOTER_HINTS}</text>
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
                    <span>{`${prefix} ${section.title}`}</span>
                  </text>
                  <For each={section.fields as unknown as Array<(typeof section.fields)[number]>}>
                    {(field) => (
                      <box padding={0}>
                        <text>
                          <span>{`    ${field.label}: `}</span>
                          <span>{field.value}</span>
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
        <text opacity={0.5}>{planFooterStatus(sectionIndex(), sections().length)}</text>
        <Show when={s().planModifyMode}>
          <text opacity={0.5}>{PLAN_MODIFYING_HINT}</text>
        </Show>
        <Show when={!s().planModifyMode}>
          <text opacity={0.5}>{FOOTER_CMD_LABEL}</text>
        </Show>
        <input focused={true} value={cmd()} onInput={handleCmdInput} placeholder="j/k/m/Enter/q" />
      </box>
    </box>
  );
}

// ─── Sub-component: AssertionReviewPanel (US-11.1 AC4) ─────────────────────

function AssertionReviewPanel(props: {
  state: () => TuiShellState;
  dispatch: (event: TuiShellEvent) => void;
}): JSX.Element {
  const s = props.state;
  const dispatch = props.dispatch;
  const [cmd, setCmd] = createSignal('');

  const suggestions = createMemo(() => s().assertionSuggestions);
  const idx = createMemo(() => s().assertionIndex);
  const lines = createMemo(() => formatAssertionSuggestions(suggestions(), idx()));

  const handleCmdInput = (value: string) => {
    if (!value) {
      setCmd('');
      return;
    }
    const key = value[value.length - 1] ?? value;
    if (key === 'j') dispatch({ type: 'assertion_navigate', direction: 'down' });
    else if (key === 'k') dispatch({ type: 'assertion_navigate', direction: 'up' });
    else if (key === ' ') dispatch({ type: 'assertion_confirm' });
    else if (key === 'n') dispatch({ type: 'assertion_reject' });
    else if (key === 'A') dispatch({ type: 'assertion_confirm_all' });
    else if (key === 'q') dispatch({ type: 'exit_assertion_review' });
    setTimeout(() => setCmd(''), 0);
  };

  return (
    <box flexDirection="column" flexGrow={1} padding={1}>
      <box borderStyle="double" padding={1} marginBottom={1}>
        <text>Assertion Suggestions — Review Evidence & Confirm (US-11.1 AC4)</text>
        <text opacity={0.5}>{ASSERTION_REVIEW_FOOTER_HINTS}</text>
      </box>

      <scrollbox flexGrow={1} padding={0}>
        <box flexDirection="column">
          <For each={lines()}>
            {(line) => (
              <text>
                <span>{line}</span>
              </text>
            )}
          </For>
          <Show when={suggestions().length === 0}>
            <text opacity={0.5}>No pending assertion suggestions.</text>
          </Show>
        </box>
      </scrollbox>

      <box borderStyle="rounded" padding={1} marginTop={1}>
        <text opacity={0.5}>
          {assertionFooterStatus(
            s().assertionConfirmed.length,
            s().assertionConfirmed.length + suggestions().length,
          )}
        </text>
        <input
          focused={true}
          value={cmd()}
          onInput={handleCmdInput}
          placeholder="j/k/space/n/A/q"
        />
      </box>
    </box>
  );
}

// ─── App 根组件 ────────────────────────────────────────────────────────

function App(props: {
  initialState: TuiShellState;
  dispatch: (event: TuiShellEvent) => void;
  setStateRef: OpenTuiStateRef;
}): JSX.Element {
  const [state, setState] = createSignal<TuiShellState>(props.initialState);
  const [draft, setDraft] = createSignal('');

  // Expose setState for external renderer.update() calls
  props.setStateRef.current = (s: TuiShellState) => setState(s);

  const s = (): TuiShellState => state();

  const wrappedDispatch = (event: TuiShellEvent) => {
    setState((prev) => tuiShellReducer(prev, event));
    const nextDraft = draftForEvent(event);
    if (nextDraft !== null) {
      setDraft(nextDraft);
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
      <Header workspace={s().workspace} deviceStatus={s().deviceStatus} />

      {s().mode === 'plan_review' ? (
        <PlanReviewPanel state={state} dispatch={wrappedDispatch} />
      ) : s().mode === 'candidate_review' ? (
        <CandidateReviewPanel state={state} dispatch={wrappedDispatch} />
      ) : s().mode === 'recording_review' ? (
        <RecordingPanel state={state} dispatch={wrappedDispatch} />
      ) : s().mode === 'assertion_review' ? (
        <AssertionReviewPanel state={state} dispatch={wrappedDispatch} />
      ) : s().mode === 'credential_prompt' ? (
        <CredentialPromptPanel state={state} dispatch={wrappedDispatch} />
      ) : (
        <>
          <MessageList messages={s().messages} />
          <InputBar draft={draft()} setDraft={setDraft} onSubmit={handleSubmit} />
        </>
      )}
    </box>
  );
}

// ─── OpenTuiRenderer ───────────────────────────────────────────────────

export function createOpenTuiRenderer(): TuiRenderer {
  const lifecycle = createOpenTuiLifecycle();

  return {
    async start(initialState, dispatch) {
      const detachResize = lifecycle.bind(process.stdout);
      try {
        await otRender(
          () => <App initialState={initialState} dispatch={dispatch} setStateRef={lifecycle.ref} />,
          {
            stdout: process.stdout,
            stdin: process.stdin,
            exitOnCtrlC: true,
          },
        );
      } finally {
        detachResize();
      }
    },
    update(state: TuiShellState) {
      lifecycle.update(state);
    },
  };
}
