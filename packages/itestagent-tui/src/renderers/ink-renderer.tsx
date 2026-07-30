/** @jsxImportSource react */

import { render, Box, Text } from 'ink';
import React, { useState, useEffect } from 'react';
import { useInput } from 'ink';
import type { TuiShellEvent, TuiShellState } from '../tui-shell.js';
import { tuiShellReducer } from '../tui-shell.js';
import type { TuiRenderer } from '../renderer.js';

function App(props: {
  initialState: TuiShellState;
  dispatch: (event: TuiShellEvent) => void;
  stateRef: { current: ((s: TuiShellState) => void) | null };
}): React.ReactElement {
  const [state, setState] = useState<TuiShellState>(props.initialState);
  const [draft, setDraft] = useState('');

  useEffect(() => {
    props.stateRef.current = (s: TuiShellState) => setState(s);
  }, []);

  useInput((input: string, key: { return?: boolean; backspace?: boolean; delete?: boolean; ctrl?: boolean; meta?: boolean }) => {
    if (key.return) {
      const text = draft.trim();
      if (text) {
        props.dispatch({ type: 'input', text });
        props.dispatch({ type: 'submit' });
        setState((prev) => {
          let s = tuiShellReducer(prev, { type: 'input', text });
          s = tuiShellReducer(s, { type: 'submit' });
          return s;
        });
        setDraft('');
      }
      return;
    }
    if (key.backspace || key.delete) {
      setDraft((prev) => prev.slice(0, -1));
      return;
    }
    if (input && !key.ctrl && !key.meta) {
      setDraft((prev) => prev + input);
    }
  });

  return (
    <Box flexDirection="column" paddingX={1} paddingY={1}>
      <Box marginBottom={1}>
        <Text dimColor>
          iTestAgent v0.0.1 — {state.workspace}
          {state.deviceStatus !== 'no_device' ? `  |  Device: ${state.deviceStatus}` : ''}
        </Text>
      </Box>
      <Box flexDirection="column" marginBottom={1}>
        {state.messages.length === 0 ? (
          <Text dimColor>Type a message and press Enter to get started.</Text>
        ) : (
          state.messages.map((msg) => (
            <Box key={msg.id} flexDirection="row">
              <Text dimColor>
                [{msg.type === 'user' ? 'YOU' : msg.type === 'assistant' ? ' AI' : 'SYS'}]
              </Text>
              <Text> {msg.text}</Text>
            </Box>
          ))
        )}
      </Box>
      <Box>
        <Text>{'> '}</Text>
        <Text>{draft}</Text>
      </Box>
    </Box>
  );
}

export function createInkRenderer(): TuiRenderer {
  const stateRef: { current: ((s: TuiShellState) => void) | null } = { current: null };

  return {
    async start(initialState, dispatch) {
      const { unmount } = render(
        React.createElement(App, { initialState, dispatch, stateRef }),
      );
      await new Promise<void>((resolve) => {
        const cleanup = () => {
          unmount();
          resolve();
        };
        process.once('SIGINT', cleanup);
        process.once('SIGTERM', cleanup);
      });
    },
    update(state: TuiShellState) {
      stateRef.current?.(state);
    },
  };
}
