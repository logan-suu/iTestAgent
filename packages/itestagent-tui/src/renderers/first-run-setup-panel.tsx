/**
 * Production first-run setup panel for OpenTUI.
 *
 * Secret input deliberately avoids OpenTUI's visible <input> renderable. The
 * raw API key remains in the local draft signal and only a bounded mask is
 * placed in the JSX tree.
 */
import { type JSX, useKeyboard, usePaste } from '@opentui/solid';
import { Show } from 'solid-js';
import type { TuiShellState } from '../tui-shell.js';
import { maskedDisplayValue } from './setup-panel.jsx';

const MAX_SETUP_INPUT_LENGTH = 8_192;

export function appendSetupInput(current: string, inserted: string): string {
  const printable = Array.from(inserted)
    .filter((char) => {
      const codePoint = char.codePointAt(0) ?? 0;
      return codePoint >= 0x20 && codePoint !== 0x7f;
    })
    .join('');
  return Array.from(`${current}${printable}`).slice(0, MAX_SETUP_INPUT_LENGTH).join('');
}

export function removeLastSetupInputSymbol(current: string): string {
  return Array.from(current).slice(0, -1).join('');
}

export function decodeSetupPaste(bytes: Uint8Array): string {
  return new TextDecoder().decode(bytes);
}

function SetupStepCopy(props: { state: () => TuiShellState }): JSX.Element {
  const state = props.state;
  return (
    <box flexDirection="column" padding={1} marginBottom={1}>
      <text>First-Time Setup</text>
      <text opacity={0.5}>Configure your AI provider to get started.</text>
      <Show when={state().setupStep === 0}>
        <text>API Base URL</text>
        <text opacity={0.5}>{`Default: ${state().setupBaseUrl}`}</text>
        <text>Press Enter to accept the default, or type a custom URL.</text>
      </Show>
      <Show when={state().setupStep === 1}>
        <text>API Key</text>
        <text opacity={0.5}>Paste your API key (input is hidden).</text>
      </Show>
      <Show when={state().setupStep === 2}>
        <text>Model Name</text>
        <text opacity={0.5}>{`Default: ${state().setupModel}`}</text>
        <text>Press Enter to accept the default, or type a custom model name.</text>
      </Show>
      <Show when={state().setupStep === 3}>
        <text>Credential Storage</text>
        <text>Type "session" to keep the API key in memory for this process.</text>
        <text>Type "save" to review a separate device-local Keychain confirmation.</text>
      </Show>
      <Show when={state().setupStep === 4}>
        <text>Keychain Confirmation</text>
        <text>Review the disclosure above, then type "save" to authorize one write.</text>
        <text>Type "session" to decline persistence.</text>
      </Show>
      <Show when={state().setupError.length > 0}>
        <text fg="red">{state().setupError}</text>
      </Show>
    </box>
  );
}

export function FirstRunSetupPanel(props: {
  state: () => TuiShellState;
  draft: () => string;
  setDraft: (value: string) => void;
  onSubmit: () => void;
}): JSX.Element {
  const isSecretInput = () => props.state().setupStep === 1;

  useKeyboard((key) => {
    if (!isSecretInput() || key.ctrl || key.meta || key.option) return;

    if (key.name === 'return' || key.name === 'enter') {
      key.preventDefault();
      key.stopPropagation();
      props.onSubmit();
      return;
    }
    if (key.name === 'backspace' || key.name === 'delete') {
      key.preventDefault();
      key.stopPropagation();
      props.setDraft(removeLastSetupInputSymbol(props.draft()));
      return;
    }

    const next = appendSetupInput(props.draft(), key.sequence);
    if (next !== props.draft()) {
      key.preventDefault();
      key.stopPropagation();
      props.setDraft(next);
    }
  });

  usePaste((event) => {
    if (!isSecretInput()) return;
    event.preventDefault();
    event.stopPropagation();
    props.setDraft(appendSetupInput(props.draft(), decodeSetupPaste(event.bytes)));
  });

  return (
    <box flexDirection="column" flexGrow={1} padding={1}>
      <box flexDirection="column" flexGrow={1}>
        {props.state().messages.map((message) => (
          // biome-ignore lint/correctness/useJsxKeyInIterable: OpenTUI uses id as element key
          <text
            id={message.id}
          >{`[${message.type === 'system' ? 'Sys' : message.type}] ${message.text}`}</text>
        ))}
        <SetupStepCopy state={props.state} />
      </box>

      <box borderStyle="rounded" padding={1} marginTop={1}>
        <text>{'> '}</text>
        {isSecretInput() ? (
          <text>{maskedDisplayValue(props.draft())}</text>
        ) : (
          <input
            focused={true}
            value={props.draft()}
            onInput={props.setDraft}
            onSubmit={props.onSubmit}
            placeholder="Type here and press Enter..."
          />
        )}
      </box>
      <text opacity={0.5}>Ctrl+C to exit setup at any time.</text>
    </box>
  );
}
