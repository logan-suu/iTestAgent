/** @jsxImportSource react */

import { Box, Text, render, useApp, useInput } from 'ink';
import React, { useEffect, useRef, useState } from 'react';
import type { TuiRenderer } from '../renderer.js';
import type { TuiShellEvent, TuiShellState } from '../tui-shell.js';
import { tuiShellReducer } from '../tui-shell.js';

function App(props: {
  initialState: TuiShellState;
  dispatch: (event: TuiShellEvent) => void;
  stateRef: { current: ((s: TuiShellState) => void) | null };
}): React.ReactElement {
  const [state, setState] = useState<TuiShellState>(props.initialState);
  const [draft, setDraft] = useState('');
  const draftRef = useRef('');
  const { exit } = useApp();

  useEffect(() => {
    props.stateRef.current = (s: TuiShellState) => setState(s);
  }, [props.stateRef]);

  useInput(
    (
      input: string,
      key: {
        return?: boolean;
        backspace?: boolean;
        delete?: boolean;
        ctrl?: boolean;
        meta?: boolean;
      },
    ) => {
      if (key.ctrl && input === 'c') {
        exit();
        return;
      }
      if (key.return) {
        const text = draftRef.current.trim();
        if (text) {
          props.dispatch({ type: 'input', text });
          props.dispatch({ type: 'submit' });
          setState((prev) => {
            let s = tuiShellReducer(prev, { type: 'input', text });
            s = tuiShellReducer(s, { type: 'submit' });
            return s;
          });
          draftRef.current = '';
          setDraft('');
        }
        return;
      }
      if (key.backspace || key.delete) {
        draftRef.current = draftRef.current.slice(0, -1);
        setDraft(draftRef.current);
        return;
      }
      if (input && !key.ctrl && !key.meta) {
        draftRef.current += input;
        setDraft(draftRef.current);
      }
    },
  );

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
      const instance = render(React.createElement(App, { initialState, dispatch, stateRef }));
      try {
        await instance.waitUntilExit();
      } finally {
        instance.unmount();
      }
    },
    update(state: TuiShellState) {
      stateRef.current?.(state);
    },
  };
}
