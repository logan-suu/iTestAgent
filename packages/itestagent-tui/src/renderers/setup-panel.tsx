/**
 * SetupPanel — OpenTUI+SolidJS component for the first-run setup wizard.
 *
 * Guide §6.4: the API key is memory-only by default; Keychain persistence
 * is offered only through an explicit confirmation flow whose notice shows
 * scope/service/account/revocation. Masking guarantees live in the pure
 * helpers below (maskedDisplayValue / buildSetupViewModel) so they are
 * testable without a renderer.
 */
import type { JSX } from '@opentui/solid';
import { createSignal } from 'solid-js';
import {
  type SetupControllerState,
  type SetupEvent,
  type SetupStepId,
  createInitialSetupState,
  setupReducer,
} from '../tui-setup-controller.js';

// ─── Pure masking helpers ───────────────────────────────────

export const MASK_CHAR = '•';
export const MAX_MASKED_LENGTH = 32;

/**
 * Length-preserving mask for secret display, capped so oversized values
 * cannot blow up terminal layout. The raw value never reaches the output.
 */
export function maskedDisplayValue(raw: string): string {
  if (raw.length === 0) return '';
  return MASK_CHAR.repeat(Math.min(raw.length, MAX_MASKED_LENGTH));
}

export function isSecretStep(step: SetupStepId): boolean {
  return step === 'api_key';
}

const STEP_HEADERS: Record<SetupStepId, string> = {
  provider: 'Setup — LLM Provider',
  base_url: 'Setup — Base URL',
  model: 'Setup — Model',
  api_key: 'Setup — API Key',
  persistence_decision: 'Setup — Keychain Persistence Confirmation',
  complete: 'Setup Complete',
};

export function formatSetupStepHeader(step: SetupStepId): string {
  return STEP_HEADERS[step];
}

const OUTCOME_LINES: Record<Exclude<SetupControllerState['outcome'], 'pending'>, string> = {
  saved_to_keychain: 'Saved to Keychain (device-local item)',
  session_only: 'Provided (memory-only, session)',
  denied: 'Denied — credential kept memory-only',
  revoked: 'Keychain persistence revoked for this session',
};

// ─── View model ─────────────────────────────────────────────

export interface SetupViewModel {
  readonly header: string;
  readonly bodyLines: readonly string[];
  /** Masked rendering of the current API-key draft (never the raw value). */
  readonly maskedDraft: string;
  readonly noticeLines: readonly string[] | null;
  readonly footerHints: readonly string[];
  readonly outcomeLine: string | null;
}

const FOOTER_HINTS: readonly string[] = [
  '[Enter] Submit | [Tab] Skip (optional steps)',
  '[R] Remember in Keychain (requires explicit confirmation)',
  '[D] Deny — keep credential memory-only',
];

export function buildSetupViewModel(state: SetupControllerState): SetupViewModel {
  const bodyLines = [
    `Provider: ${state.provider.length > 0 ? state.provider : '(pending)'}`,
    `Base URL: ${state.baseUrl.length > 0 ? state.baseUrl : '(default)'}`,
    `Model: ${state.model.length > 0 ? state.model : '(default)'}`,
    `API key: ${state.apiKeyDraft.length > 0 ? maskedDisplayValue(state.apiKeyDraft) : '(not set)'}`,
  ];
  return {
    header: formatSetupStepHeader(state.step),
    bodyLines,
    maskedDraft: maskedDisplayValue(state.apiKeyDraft),
    noticeLines: state.persistenceNotice,
    footerHints: FOOTER_HINTS,
    outcomeLine: state.outcome === 'pending' ? null : OUTCOME_LINES[state.outcome],
  };
}

// ─── Components ─────────────────────────────────────────────

/**
 * Renders a label plus a masked value. The component accepts only the raw
 * value for masking purposes; no code path places it into a text node.
 */
export function MaskedField(props: {
  label: string;
  value: string;
  placeholder?: string;
}): JSX.Element {
  const masked = maskedDisplayValue(props.value);
  const display = masked.length > 0 ? masked : (props.placeholder ?? '(not set)');
  return (
    <box flexDirection="row">
      <text>{`${props.label}: `}</text>
      <text>{display}</text>
    </box>
  );
}

export function SetupPanel(props: {
  state: () => SetupControllerState;
  dispatch: (event: SetupEvent) => void;
}): JSX.Element {
  const s = props.state;
  const dispatch = props.dispatch;
  const [cmd, setCmd] = createSignal('');

  const handleCmdInput = (value: string) => {
    if (!value) {
      setCmd('');
      return;
    }
    if (value === 'enter') dispatch({ type: 'submit' });
    else if (value === 'tab') dispatch({ type: 'skip' });
    else if (value === 'R') dispatch({ type: 'choose_remember' });
    else if (value === 'Y') dispatch({ type: 'confirm_persistence' });
    else if (value === 'D') dispatch({ type: 'deny_persistence' });
    setTimeout(() => setCmd(''), 0);
  };

  const vm = () => buildSetupViewModel(s());
  const state = s();

  return (
    <box flexDirection="column" flexGrow={1} padding={1}>
      <box borderStyle="double" padding={1} marginBottom={1}>
        <text>{vm().header}</text>
      </box>

      <box flexDirection="column" padding={1} marginBottom={1}>
        {vm().bodyLines.map((line) => (
          // biome-ignore lint/correctness/useJsxKeyInIterable: OpenTUI TextProps has no key prop
          <text>{line}</text>
        ))}
        {/* Defense-in-depth: the child component receives the ALREADY-masked
            value, so a raw secret never crosses a component boundary. */}
        {isSecretStep(state.step) && state.draft.length > 0 ? (
          <MaskedField label="Current input" value={maskedDisplayValue(state.draft)} />
        ) : null}
      </box>

      {(() => {
        // Each vm() call returns a fresh object, so a local binding is needed for TS narrowing.
        const noticeLines = vm().noticeLines;
        return noticeLines ? (
          <box borderStyle="rounded" borderColor="yellow" padding={1} marginBottom={1}>
            {noticeLines.map((line) => (
              // biome-ignore lint/correctness/useJsxKeyInIterable: OpenTUI TextProps has no key prop
              <text>{line}</text>
            ))}
            <text opacity={0.6}>[Y] Confirm save | [D] Deny</text>
          </box>
        ) : null;
      })()}

      {vm().outcomeLine ? (
        <box padding={1} marginBottom={1}>
          <text>{vm().outcomeLine}</text>
        </box>
      ) : null}

      <box borderStyle="rounded" padding={1} marginTop={1}>
        {vm().footerHints.map((hint) => (
          // biome-ignore lint/correctness/useJsxKeyInIterable: OpenTUI TextProps has no key prop
          <text opacity={0.5}>{hint}</text>
        ))}
        <text opacity={0.5}>Cmd: </text>
        <input
          focused={true}
          value={cmd()}
          onInput={handleCmdInput}
          placeholder="Enter/Tab/R/Y/D"
        />
      </box>
    </box>
  );
}
