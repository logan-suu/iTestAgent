/**
 * OpenTuiRenderer — OpenTUI+SolidJS 渲染器实现（目标主线）。
 *
 * ADR-008：OpenTUI+SolidJS 为目标主线，对齐 OpenCode TUI 技术栈。
 *
 * US-4.1 AC2：TUI 显示当前 workspace、设备状态、可输入自然语言。
 */

import type { ScrollBoxRenderable } from '@opentui/core';
import { render as otRender, useKeyboard, useTerminalDimensions } from '@opentui/solid';
import type { JSX } from '@opentui/solid';
import { For, Show, createEffect, createMemo, createSignal, onCleanup } from 'solid-js';
import {
  ASSERTION_REVIEW_FOOTER_HINTS,
  assertionFooterStatus,
  formatAssertionSuggestion,
  formatAssertionSuggestions,
} from '../assertion-review.js';
import { formatConfidenceBar, getConfidenceTier } from '../candidate-review.js';
import {
  DEVICE_KINDS,
  devicesForReview,
  devicesForTarget,
  formatDeviceAvailability,
  isDeviceReady,
  targetSwitchPrompt,
} from '../device-review.js';
import { PLAN_SECTIONS, formatPlanSections } from '../plan-review.js';
import type { TuiRenderer } from '../renderer.js';
import {
  STARTUP_BRAND_COLOR,
  completionMessageParts,
  startupBrandLines,
  successBrandLinesInViewport,
} from '../startup-brand.js';
import type { DeviceStatus, Message, TuiShellEvent, TuiShellState } from '../tui-shell.js';
import { CredentialPromptPanel } from './credential-prompt-panel.jsx';
import { FirstRunSetupPanel } from './first-run-setup-panel.jsx';
import {
  CANDIDATE_EDITING_HINT,
  CANDIDATE_REVIEW_FOOTER_HINTS,
  FOOTER_CMD_LABEL,
  PLAN_MODIFYING_HINT,
  PLAN_REVIEW_FOOTER_HINTS,
  candidateFooterStatus,
  planFooterStatus,
} from './opentui-footer.js';
import {
  dispatchCandidateKey,
  dispatchDeviceKey,
  dispatchPlanKey,
  dispatchReviewKey,
} from './opentui-key-dispatch.js';
import {
  type OpenTuiStateRef,
  createOpenTuiLifecycle,
  draftForEvent,
  reduceOpenTuiLocalState,
} from './opentui-renderer-lifecycle.js';
import { RecordingPanel } from './recording-panel.jsx';
import { useReviewScroll } from './review-scroll.js';

// ─── 常量 ──────────────────────────────────────────────────────────────

const DEVICE_LABELS: Record<DeviceStatus, string> = {
  no_device: '[no device]',
  discovered: '[target not selected]',
  checking: '[checking…]',
  healthy: '[✓ connected]',
  degraded: '[! discovery degraded]',
  unavailable: '[✗ unavailable]',
  untrusted: '[✗ untrusted]',
  busy: '[… busy]',
};

const CONFIDENCE_PREFIX: Record<string, string> = {
  high: '[H]',
  medium: '[M]',
  low: '[L]',
};

// ─── 子组件 ────────────────────────────────────────────────────────────

function Header(props: {
  workspace: string;
  deviceStatus: DeviceStatus;
  activity: string | null;
  compactBrand?: string;
}): JSX.Element {
  const frames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'] as const;
  const [frame, setFrame] = createSignal(0);
  createEffect(() => {
    if (!props.activity) {
      setFrame(0);
      return;
    }
    const timer = setInterval(() => setFrame((value) => (value + 1) % frames.length), 80);
    onCleanup(() => clearInterval(timer));
  });
  return (
    <box flexDirection="column" flexShrink={0} borderStyle="single" padding={1} marginBottom={1}>
      <box>
        <text>{`${props.compactBrand ? `${props.compactBrand} | ` : ''}Workspace: ${props.workspace}`}</text>
      </box>
      <box>
        <text>{`Device: ${DEVICE_LABELS[props.deviceStatus]}`}</text>
      </box>
      <Show when={props.activity}>
        <box>
          <text opacity={0.6}>{`Activity: ${frames[frame()]} ${props.activity ?? ''}`}</text>
        </box>
      </Show>
    </box>
  );
}

function MessageList(props: { state: () => TuiShellState }): JSX.Element {
  const messages = createMemo(() => props.state().messages);
  const [viewport, setViewport] = createSignal({ width: 0, height: 0 });
  let transcript: ScrollBoxRenderable | undefined;
  const updateViewport = () => {
    if (transcript) {
      setViewport({ width: transcript.viewport.width, height: transcript.viewport.height });
    }
  };
  onCleanup(() => transcript?.viewport.off('resize', updateViewport));
  useKeyboard((key) => {
    if (key.ctrl || key.meta || key.option) return;
    if ((key.name === 'pageup' || key.name === 'pagedown') && transcript?.handleKeyPress(key)) {
      key.preventDefault();
      key.stopPropagation();
    }
  });

  return (
    <scrollbox
      id="chat-transcript"
      ref={(ref: ScrollBoxRenderable) => {
        transcript = ref;
        // Observe layout resize without replacing ScrollBox's internal size callback.
        ref.viewport.on('resize', updateViewport);
        updateViewport();
      }}
      flexGrow={1}
      flexBasis={0}
      minHeight={0}
      scrollX={false}
      scrollY={true}
      stickyScroll={true}
      stickyStart="bottom"
      contentOptions={{ flexDirection: 'column', padding: 1 }}
    >
      <Show
        when={messages().length > 0}
        fallback={
          <text opacity={0.5}>Type a message and press Enter to send. Ctrl+C to quit.</text>
        }
      >
        <For each={messages() as Message[]}>
          {(msg) => {
            const success = createMemo(() => successBrandLinesInViewport(msg, viewport()));
            const parts = completionMessageParts(msg);
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
              <box flexDirection="column" flexShrink={0}>
                <text id={msg.id} flexShrink={0}>
                  <span>{`[${prefix}] `}</span>
                  <span>{parts.heading}</span>
                </text>
                <Show when={success().length > 0}>
                  <text
                    fg="green"
                    flexShrink={0}
                    marginTop={success().length > 1 ? 1 : 0}
                    marginBottom={success().length > 1 ? 1 : 0}
                  >
                    {success().join('\n')}
                  </text>
                </Show>
                <Show when={parts.details}>
                  <text flexShrink={0}>{parts.details}</text>
                </Show>
              </box>
            );
          }}
        </For>
      </Show>
    </scrollbox>
  );
}

function DeviceReviewPanel(props: {
  state: () => TuiShellState;
  dispatch: (event: TuiShellEvent) => void;
}): JSX.Element {
  const s = props.state;
  const [cmd, setCmd] = createSignal('');
  const candidates = () => devicesForReview(s().devices);
  const switchPrompt = () => {
    const request = s().deviceTargetSwitch;
    return request ? targetSwitchPrompt(request) : '';
  };
  const deviceScrollRef = useReviewScroll(() => `device-review-${s().deviceSelectionIndex}`);

  const handleCommand = (value: string) => {
    dispatchReviewKey(s(), value, props.dispatch);
  };

  const handleInput = (value: string) => {
    if (!value) {
      setCmd('');
      return;
    }
    handleCommand(value);
    setTimeout(() => setCmd(''), 0);
  };

  return (
    <box flexDirection="column" flexGrow={1} padding={1}>
      <box flexDirection="column" flexShrink={0} borderStyle="double" padding={1} marginBottom={1}>
        <text>{`Device Selection — current plan: ${s().deviceSelectionTargetKind ?? 'unknown'}`}</text>
        <text opacity={0.5}>↑/↓ or j/k:nav Enter:select r:refresh Esc/q:cancel</text>
        <text
          opacity={0.5}
        >{`physical: ${devicesForTarget(candidates(), 'physical').length} · simulator: ${devicesForTarget(candidates(), 'simulator').length}`}</text>
        <Show when={s().deviceTargetSwitch}>
          <text fg="#eed49f">{switchPrompt()}</text>
        </Show>
      </box>

      <scrollbox ref={deviceScrollRef} flexGrow={1} padding={1}>
        <box flexDirection="column">
          <Show when={s().messages.length > 0}>
            <text>{s().messages[s().messages.length - 1]?.text ?? ''}</text>
          </Show>
          <For each={DEVICE_KINDS}>
            {(kind) => (
              <box flexDirection="column">
                <text>{`${kind}${kind === s().deviceSelectionTargetKind ? ' (current plan)' : ''}`}</text>
                <Show when={devicesForTarget(candidates(), kind).length === 0}>
                  <text>No targets discovered. Connect or boot one, then refresh.</text>
                </Show>
                <For each={devicesForTarget(candidates(), kind)}>
                  {(device) => {
                    const selected = () =>
                      candidates().indexOf(device) === s().deviceSelectionIndex;
                    return (
                      <box
                        id={`device-review-${candidates().indexOf(device)}`}
                        flexDirection="column"
                        paddingLeft={1}
                        paddingRight={1}
                        marginBottom={1}
                        backgroundColor={selected() ? '#222233' : undefined}
                      >
                        <text>{`${selected() ? '>' : ' '} ${device.name ?? 'Unnamed device'}`}</text>
                        <text opacity={isDeviceReady(device) ? 1 : 0.5}>
                          {`${device.targetKind} · iOS ${device.osVersion ?? 'unknown'} · ${formatDeviceAvailability(device)}`}
                        </text>
                      </box>
                    );
                  }}
                </For>
              </box>
            )}
          </For>
        </box>
      </scrollbox>

      <box flexDirection="column" flexShrink={0} borderStyle="rounded" padding={1} marginTop={1}>
        <text opacity={0.5}>
          {candidates().length > 0
            ? `${s().deviceSelectionIndex + 1}/${candidates().length}`
            : '0/0'}
        </text>
        <box flexDirection="row">
          <text opacity={0.5}>Cmd: </text>
          <input
            focused={true}
            value={cmd()}
            onInput={handleInput}
            onSubmit={() => handleCommand('enter')}
            placeholder={
              s().deviceTargetSwitch ? 'y:confirm / n:keep current plan' : '↑/↓/Enter/r/Esc (j/k/q)'
            }
          />
        </box>
      </box>
    </box>
  );
}

function InputBar(props: {
  draft: string;
  setDraft: (v: string) => void;
  onSubmit: () => void;
}): JSX.Element {
  return (
    <box id="chat-input" flexDirection="row" flexShrink={0} borderStyle="rounded" padding={1}>
      <text>{'> '}</text>
      <input
        focused={true}
        flexGrow={1}
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
  const candidateScrollRef = useReviewScroll(() => `candidate-review-${idx()}`);

  return (
    <box flexDirection="column" flexGrow={1} padding={1}>
      <box flexDirection="column" flexShrink={0} borderStyle="double" padding={1} marginBottom={1}>
        <text>Candidate Core Paths — Review & Confirm</text>
        <text opacity={0.5}>{CANDIDATE_REVIEW_FOOTER_HINTS}</text>
      </box>

      <scrollbox ref={candidateScrollRef} flexGrow={1} padding={0}>
        <box flexDirection="column">
          <For each={candidates()}>
            {(candidate, index) => {
              const isSelected = () => index() === idx();
              const tier = getConfidenceTier(candidate.confidence);
              const marker = candidate.confirmed ? '[x]' : '[ ]';

              return (
                <box
                  id={`candidate-review-${index()}`}
                  flexDirection="column"
                  padding={0}
                  borderStyle={isSelected() ? 'single' : undefined}
                  backgroundColor={isSelected() ? '#222233' : undefined}
                >
                  <text>
                    <span>{`${isSelected() ? '>' : ' '} ${marker} `}</span>
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
        <box flexDirection="row" flexShrink={0} borderStyle="rounded" padding={1} marginTop={1}>
          <text>{`Edit: "${candidates()[idx()]?.name ?? ''}" → `}</text>
          <text>{s().candidateEditDraft}</text>
        </box>
      </Show>

      <box flexDirection="column" flexShrink={0} borderStyle="rounded" padding={1} marginTop={1}>
        <text opacity={0.5}>
          {candidateFooterStatus(
            candidates().filter((c) => c.confirmed).length,
            candidates().length,
          )}
        </text>
        <Show when={s().candidateEditMode}>
          <text opacity={0.5}>{CANDIDATE_EDITING_HINT}</text>
        </Show>
        <box flexDirection="row">
          <Show when={!s().candidateEditMode}>
            <text opacity={0.5}>{FOOTER_CMD_LABEL}</text>
          </Show>
          <input
            focused={true}
            value={s().candidateEditMode ? s().candidateEditDraft : cmd()}
            onInput={(value: string) =>
              s().candidateEditMode
                ? dispatch({ type: 'candidate_edit_input', text: value })
                : handleCmdInput(value)
            }
            onSubmit={() => handleCommand('enter')}
            placeholder="↑/↓/Space/Enter/Esc (j/k/e/A/N/q)"
          />
        </box>
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
    return formatPlanSections(plan, s().planConnectionSummary);
  };
  const sectionIndex = () => s().planSectionIndex;
  const planScrollRef = useReviewScroll(() => `plan-review-${sectionIndex()}`);

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
      <box flexDirection="column" flexShrink={0} borderStyle="double" padding={1} marginBottom={1}>
        <text>TestPlan Review — Confirm, Modify or Cancel</text>
        <text opacity={0.5}>{PLAN_REVIEW_FOOTER_HINTS}</text>
      </box>

      <scrollbox ref={planScrollRef} flexGrow={1} padding={1}>
        <box flexDirection="column">
          <For each={sections() as unknown as Array<ReturnType<typeof formatPlanSections>[number]>}>
            {(section, index) => {
              const isSelected = () => index() === sectionIndex();

              return (
                <box
                  id={`plan-review-${index()}`}
                  flexDirection="column"
                  padding={0}
                  marginBottom={1}
                  borderStyle={isSelected() ? 'single' : undefined}
                  backgroundColor={isSelected() ? '#222233' : undefined}
                >
                  <text>
                    <span>{`${isSelected() ? '>' : ' '} ${section.title}`}</span>
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
        <box flexDirection="row" flexShrink={0} borderStyle="rounded" padding={1} marginTop={1}>
          <text opacity={0.5}>Modify (natural language): </text>
          <text>{s().planModifyDraft}</text>
        </box>
      </Show>

      <box flexDirection="column" flexShrink={0} borderStyle="rounded" padding={1} marginTop={1}>
        <text opacity={0.5}>{planFooterStatus(sectionIndex(), sections().length)}</text>
        <Show when={s().planModifyMode}>
          <text opacity={0.5}>{PLAN_MODIFYING_HINT}</text>
        </Show>
        <box flexDirection="row">
          <Show when={!s().planModifyMode}>
            <text opacity={0.5}>{FOOTER_CMD_LABEL}</text>
          </Show>
          <input
            focused={true}
            value={s().planModifyMode ? s().planModifyDraft : cmd()}
            onInput={(value: string) =>
              s().planModifyMode
                ? dispatch({ type: 'plan_modify_input', text: value })
                : handleCmdInput(value)
            }
            onSubmit={() => handleCommand('enter')}
            placeholder="↑/↓/Enter/Esc (j/k/m/q)"
          />
        </box>
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
  const assertionScrollRef = useReviewScroll(() => `assertion-review-${idx()}`);

  const handleCmdInput = (value: string) => {
    if (!value) {
      setCmd('');
      return;
    }
    const key = value[value.length - 1] ?? value;
    dispatchReviewKey(s(), key, dispatch);
    setTimeout(() => setCmd(''), 0);
  };

  return (
    <box flexDirection="column" flexGrow={1} padding={1}>
      <box flexDirection="column" flexShrink={0} borderStyle="double" padding={1} marginBottom={1}>
        <text>Assertion Suggestions — Review Evidence & Confirm (US-11.1 AC4)</text>
        <text opacity={0.5}>{ASSERTION_REVIEW_FOOTER_HINTS}</text>
      </box>

      <scrollbox ref={assertionScrollRef} flexGrow={1} padding={0}>
        <box flexDirection="column">
          <For each={suggestions()}>
            {(suggestion, index) => (
              <box id={`assertion-review-${index()}`} flexDirection="column">
                <For each={formatAssertionSuggestion(suggestion, index() === idx())}>
                  {(line) => <text>{line}</text>}
                </For>
              </box>
            )}
          </For>
          <Show when={suggestions().length === 0}>
            <text opacity={0.5}>No pending assertion suggestions.</text>
          </Show>
        </box>
      </scrollbox>

      <box flexDirection="column" flexShrink={0} borderStyle="rounded" padding={1} marginTop={1}>
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
          onSubmit={() => dispatchReviewKey(s(), 'enter', dispatch)}
          placeholder="↑/↓/Space/Enter/Esc (j/k/n/A/q)"
        />
      </box>
    </box>
  );
}

// ─── App 根组件 ────────────────────────────────────────────────────────

export function OpenTuiApp(props: {
  initialState: TuiShellState;
  dispatch: (event: TuiShellEvent) => void;
  setStateRef: OpenTuiStateRef;
}): JSX.Element {
  const [state, setState] = createSignal<TuiShellState>(props.initialState);
  const [draft, setDraft] = createSignal('');
  const dimensions = useTerminalDimensions();
  const branding = createMemo(() => startupBrandLines(state(), dimensions()));

  // Expose setState for external renderer.update() calls
  props.setStateRef.current = (s: TuiShellState) => setState(s);

  const s = (): TuiShellState => state();

  const wrappedDispatch = (event: TuiShellEvent) => {
    setState((prev) => reduceOpenTuiLocalState(prev, event));
    const nextDraft = draftForEvent(event);
    if (nextDraft !== null) {
      setDraft(nextDraft);
    }
    props.dispatch(event);
  };

  useKeyboard((key) => {
    if (key.ctrl || key.meta || key.option) return;
    const command = ['up', 'down', 'left', 'right', 'escape', 'return', 'enter'].includes(key.name)
      ? key.name
      : key.sequence;
    if (dispatchReviewKey(state(), command, wrappedDispatch) !== 'ignored') {
      key.preventDefault();
      key.stopPropagation();
    }
  });

  const handleSubmit = () => {
    const currentDraft = draft();
    if (currentDraft.trim()) {
      wrappedDispatch({ type: 'input', text: currentDraft });
      wrappedDispatch({ type: 'submit' });
    }
  };

  const handleSetupSubmit = () => {
    wrappedDispatch({ type: 'input', text: draft() });
    wrappedDispatch({ type: 'submit' });
  };

  return (
    <box flexDirection="column" width="100%" height="100%" overflow="hidden" padding={1}>
      <Header
        workspace={s().workspace}
        deviceStatus={s().deviceStatus}
        activity={s().agentActivity?.text ?? null}
        compactBrand={branding().length === 1 ? branding()[0] : undefined}
      />

      <Show when={branding().length > 1}>
        <box flexDirection="column" alignItems="center" flexShrink={0}>
          <text fg={STARTUP_BRAND_COLOR}>{branding().join('\n')}</text>
        </box>
      </Show>

      {s().mode === 'setup' ? (
        <FirstRunSetupPanel
          state={state}
          draft={draft}
          setDraft={setDraft}
          onSubmit={handleSetupSubmit}
        />
      ) : s().mode === 'device_review' ? (
        <DeviceReviewPanel state={state} dispatch={wrappedDispatch} />
      ) : s().mode === 'plan_review' ? (
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
          <MessageList state={state} />
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
      let resolveDestroyed: (() => void) | null = null;
      const destroyed = new Promise<void>((resolve) => {
        resolveDestroyed = resolve;
      });
      try {
        await otRender(
          () => (
            <OpenTuiApp
              initialState={initialState}
              dispatch={dispatch}
              setStateRef={lifecycle.ref}
            />
          ),
          {
            stdout: process.stdout,
            stdin: process.stdin,
            exitOnCtrlC: true,
            onDestroy: () => resolveDestroyed?.(),
          },
        );
        // @opentui/solid >=0.5 resolves render() after mounting. Keep the
        // renderer lifecycle alive until the underlying CliRenderer exits.
        await destroyed;
      } finally {
        detachResize();
      }
    },
    update(state: TuiShellState) {
      lifecycle.update(state);
    },
  };
}
