/**
 * OpenTuiRenderer — OpenTUI+SolidJS 渲染器实现（目标主线）。
 *
 * ADR-008：OpenTUI+SolidJS 为目标主线，对齐 OpenCode TUI 技术栈。
 *
 * US-4.1 AC2：TUI 显示当前 workspace、设备状态、可输入自然语言。
 */

import { render as otRender } from '@opentui/solid';
import type { JSX } from '@opentui/solid';
import { createSignal } from 'solid-js';
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
      <MessageList messages={state().messages} />
      <InputBar draft={draft()} setDraft={setDraft} onSubmit={handleSubmit} />
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
