/**
 * RecordingPanel — OpenTUI SolidJS component for interactive recording review.
 *
 * Task 3.13: Interactive Recording (US-8.2).
 *
 * Displays Agent suggestions, recorded steps, and recording controls.
 * Follows same pattern as CandidateReviewPanel and PlanReviewPanel.
 */

import type { JSX } from '@opentui/solid';
import { Show, createSignal } from 'solid-js';
import {
  canUserRespond,
  formatActionLabel,
  formatRecordingProgress,
  formatRecordingStatus,
  formatSuggestions,
  getRecordingKeyHints,
  isRecordingEnded,
  summarizeStep,
} from '../recording-review.js';
import type { TuiShellEvent, TuiShellState } from '../tui-shell.js';

export function RecordingPanel(props: {
  state: () => TuiShellState;
  dispatch: (event: TuiShellEvent) => void;
}): JSX.Element {
  const s = props.state;
  const dispatch = props.dispatch;
  const [cmd, setCmd] = createSignal('');

  const handleCommand = (value: string) => {
    if (!value) return;

    const key = value === ' ' ? ' ' : value.trim().charAt(0);
    if (!key) return;

    // In modify mode, handle text input
    if (s().recordingModifyMode) {
      if (key === '\r' || key === '\n') {
        dispatch({ type: 'recording_modify_submit' });
        return;
      }
      dispatch({ type: 'recording_modify_input', text: s().recordingModifyDraft + key });
      return;
    }

    switch (key) {
      case '\r':
      case '\n':
        if (canUserRespond(s().recordingState)) {
          dispatch({ type: 'recording_confirm' });
        }
        break;
      case 'm':
        if (canUserRespond(s().recordingState)) {
          dispatch({ type: 'recording_modify_start' });
        }
        break;
      case 's':
        if (canUserRespond(s().recordingState)) {
          dispatch({ type: 'recording_skip' });
        }
        break;
      case 'p':
        if (s().recordingPaused) {
          dispatch({ type: 'recording_resume' });
        } else if (canUserRespond(s().recordingState)) {
          dispatch({ type: 'recording_pause' });
        }
        break;
      case 'q':
        if (isRecordingEnded(s().recordingState)) {
          dispatch({ type: 'exit_recording' });
        } else {
          dispatch({ type: 'recording_cancel' });
        }
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

  const status = formatRecordingStatus(s().recordingState);
  const progress = formatRecordingProgress(
    s().recordingStepIndex,
    s().recordingTotalSteps,
    s().recordingFeatureName,
  );
  const hints = getRecordingKeyHints(s().recordingState);
  const suggestion = s().recordingSuggestedAction as Record<string, unknown> | null;
  const suggestionDetails = suggestion ? formatSuggestions(suggestion) : [];
  const ended = isRecordingEnded(s().recordingState);

  return (
    <box flexDirection="column" flexGrow={1} padding={1}>
      {/* ── Header ────────────────────────────── */}
      <box borderStyle="double" padding={1} marginBottom={1}>
        <text>Recording: {s().recordingFeatureName}</text>
        <text opacity={0.5}>{`  ${status}`}</text>
      </box>

      {/* ── Progress Bar ──────────────────────── */}
      <box padding={1} marginBottom={1}>
        <text>{progress}</text>
      </box>

      {/* ── Key Hints ─────────────────────────── */}
      <Show when={!ended && hints.length > 0}>
        <box borderStyle="single" padding={1} marginBottom={1}>
          <text opacity={0.5}>{hints.join('  |  ')}</text>
        </box>
      </Show>

      {/* ── Agent Suggestion ──────────────────── */}
      <Show when={suggestion}>
        <box borderStyle="single" padding={1} marginBottom={1} backgroundColor="#1a1a2e">
          <text>Agent Suggestion</text>
          <text>{`Action: ${formatActionLabel(String(suggestion?.action ?? ''))} → ${suggestion?.target ?? ''}`}</text>
          <Show when={suggestionDetails.length > 0}>
            <box flexDirection="column" padding={0} marginTop={1}>
              {suggestionDetails.map((detail: string) => (
                // biome-ignore lint/correctness/useJsxKeyInIterable: OpenTUI uses id as element key
                <text opacity={0.7}>{`  ${detail}`}</text>
              ))}
            </box>
          </Show>
          <Show when={s().recordingSuggestionReasoning}>
            <text
              opacity={0.5}
              marginTop={1}
            >{`Reasoning: ${s().recordingSuggestionReasoning}`}</text>
          </Show>
        </box>
      </Show>

      {/* ── Modify Mode ───────────────────────── */}
      <Show when={s().recordingModifyMode}>
        <box borderStyle="rounded" padding={1} marginBottom={1}>
          <text>Modify action description: </text>
          <text>{s().recordingModifyDraft}</text>
          <text opacity={0.3}>_</text>
        </box>
      </Show>

      {/* ── Recorded Steps ────────────────────── */}
      <scrollbox flexGrow={1} padding={1} marginBottom={1}>
        <box flexDirection="column">
          <Show
            when={(s().recordingConfirmedSteps as Array<Record<string, unknown>>).length > 0}
            fallback={
              <text opacity={0.5}>
                {ended ? 'No steps were recorded.' : 'Waiting for the first step...'}
              </text>
            }
          >
            {(s().recordingConfirmedSteps as unknown[]).map((step, idx) => (
              // biome-ignore lint/correctness/useJsxKeyInIterable: OpenTUI uses id as element key
              <text opacity={0.7}>{`${idx + 1}. ${summarizeStep(step)}`}</text>
            ))}
          </Show>
        </box>
      </scrollbox>

      {/* ── Status Footer ─────────────────────── */}
      <Show when={ended}>
        <box borderStyle="single" padding={1} backgroundColor="#1a2e1a">
          <text>
            {s().recordingState === 'completed'
              ? `✓ Recording complete — ${s().recordingTotalSteps} steps recorded. Press q to exit.`
              : `✗ Recording cancelled — ${s().recordingTotalSteps} steps saved. Press q to exit.`}
          </text>
        </box>
      </Show>

      {/* ── Hidden command input for key capture ── */}
      <box borderStyle="rounded" padding={0} marginTop={1}>
        <input value={cmd()} onInput={handleCmdInput} placeholder="" />
      </box>
    </box>
  );
}
