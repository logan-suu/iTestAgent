/**
 * CredentialPromptPanel — OpenTUI+SolidJS component for credential input.
 *
 * US-10.2 AC1-AC5: Prompts user for credentials (passwords, tokens, OTPs) in TUI.
 *
 * R6: Sensitive data never logged in plaintext — values exist only in state (memory).
 * AC4: Password/token/otp masked during input display.
 */
import type { JSX } from '@opentui/solid';
import { Show, createSignal } from 'solid-js';
import {
  formatCredentialPromptHeader,
  formatCredentialStatus,
  maskValue,
} from '../credential-prompt.js';
import type { TuiShellEvent, TuiShellState } from '../tui-shell.js';

export function CredentialPromptPanel(props: {
  state: () => TuiShellState;
  dispatch: (event: TuiShellEvent) => void;
}): JSX.Element {
  const s = props.state;
  const dispatch = props.dispatch;
  const [cmd, setCmd] = createSignal('');
  const [localDraft, setLocalDraft] = createSignal('');

  const currentRequest = () => s().credentialRequests[s().credentialIndex];
  const totalCount = () => s().credentialRequests.length;
  const currentIndex = () => s().credentialIndex;
  const isCompleted = () => s().credentialCompleted;

  const displayValue = () => {
    const req = currentRequest();
    const raw = localDraft();
    if (!req) return '';
    if (req.kind === 'text') return raw;
    return maskValue(raw, req.kind);
  };

  const handleCommand = (value: string) => {
    if (!value) return;
    const key = value === ' ' ? ' ' : value.trim();
    if (!key) return;

    switch (key) {
      case 'enter':
        if (isCompleted()) {
          dispatch({ type: 'credential_confirm_all' });
        } else {
          dispatch({ type: 'credential_submit' });
          setLocalDraft('');
        }
        break;
      case 'tab':
        dispatch({ type: 'credential_skip' });
        setLocalDraft('');
        break;
      case 'R':
        dispatch({ type: 'credential_toggle_remember' });
        break;
      case 'q':
        dispatch({ type: 'exit_credential_prompt' });
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

  const handleCredentialInput = (value: string) => {
    setLocalDraft(value);
    dispatch({ type: 'credential_input', text: value });
  };

  const req = currentRequest();
  if (isCompleted()) {
    return (
      <box flexDirection="column" flexGrow={1} padding={1}>
        <box borderStyle="double" padding={1} marginBottom={1}>
          <text>Credentials Complete</text>
        </box>
        <box flexDirection="column" padding={1}>
          <text>All requested credentials have been provided.</text>
          <text opacity={0.5}>Press Enter to continue or q to go back.</text>
        </box>
        <box borderStyle="rounded" padding={1} marginTop={1}>
          <text opacity={0.5}>Cmd: </text>
          <input value={cmd()} onInput={handleCmdInput} placeholder="Enter/q" />
        </box>
      </box>
    );
  }

  if (!req) {
    return (
      <box flexDirection="column" flexGrow={1} padding={1}>
        <text>No credential requests to display.</text>
      </box>
    );
  }

  return (
    <box flexDirection="column" flexGrow={1} padding={1}>
      <box borderStyle="double" padding={1} marginBottom={1}>
        <text>Credential Prompt</text>
        <text opacity={0.5}>
          {`${currentIndex() + 1}/${totalCount()} — Provide credentials for execution`}
        </text>
      </box>

      <box flexDirection="column" padding={1} marginBottom={1}>
        <text>
          <text opacity={0.7}>Label: </text>
          <text>{formatCredentialPromptHeader(req.label, req.helpText)}</text>
        </text>
        <text>
          <text opacity={0.4}>Kind: </text>
          <text>{req.kind}</text>
          <Show when={req.required}>
            <text opacity={0.7}> (required)</text>
          </Show>
          <Show when={!req.required}>
            <text opacity={0.4}> (optional)</text>
          </Show>
        </text>
        <Show when={s().credentialRememberToggled}>
          <text opacity={0.6}>[R] Remember on — credential will be saved to Keychain</text>
        </Show>
      </box>

      <box borderStyle="rounded" padding={1} marginBottom={1}>
        <text>{'> '}</text>
        <text opacity={0.5}>{req.kind === 'text' ? '' : '[masked] '}</text>
        <input
          value={displayValue()}
          onInput={handleCredentialInput}
          placeholder={`Enter ${req.kind === 'text' ? 'value' : req.kind}...`}
        />
      </box>

      <Show when={s().credentialResponses.get(req.key)}>
        {(() => {
          const resp = s().credentialResponses.get(req.key);
          return resp ? (
            <box padding={1} marginBottom={1}>
              <text opacity={0.5}>{formatCredentialStatus(resp)}</text>
            </box>
          ) : null;
        })()}
      </Show>

      <box borderStyle="rounded" padding={1} marginTop={1}>
        <text opacity={0.5}>
          [Enter] Submit | [Tab] Skip | [Ctrl+R] Remember | [q] Cancel{'  '}
        </text>
        <text opacity={0.5}>Cmd: </text>
        <input value={cmd()} onInput={handleCmdInput} placeholder="Enter/Tab/R/q" />
      </box>
    </box>
  );
}
