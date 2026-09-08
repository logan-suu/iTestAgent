import { Box, Text, render, useApp, useInput } from 'ink';
import React, { useEffect, useRef, useState } from 'react';
import type { TuiRenderer } from '../renderer.js';
import { reviewPresentation } from '../review-presentation.js';
import {
  STARTUP_BRAND_COLOR,
  completionMessageParts,
  startupBrandLines,
  successBrandLines,
} from '../startup-brand.js';
import type { TuiShellEvent, TuiShellState } from '../tui-shell.js';
import { tuiShellReducer } from '../tui-shell.js';
import { dispatchReviewKey, isListReview } from './opentui-key-dispatch.js';
import { reduceOpenTuiLocalState } from './opentui-renderer-lifecycle.js';

export function InkApp(props: {
  initialState: TuiShellState;
  dispatch: (event: TuiShellEvent) => void;
  stateRef: { current: ((s: TuiShellState) => void) | null };
}): React.ReactElement {
  const [state, setState] = useState<TuiShellState>(props.initialState);
  const [draft, setDraft] = useState('');
  const [dimensions, setDimensions] = useState({
    width: process.stdout.columns || 80,
    height: process.stdout.rows || 24,
  });
  const draftRef = useRef('');
  const editCursor = useRef<number | null>(null);
  const { exit } = useApp();
  const startupLines = startupBrandLines(state, dimensions);

  useEffect(() => {
    props.stateRef.current = (s: TuiShellState) => setState(s);
  }, [props.stateRef]);

  useEffect(() => {
    const resize = () =>
      setDimensions({
        width: process.stdout.columns || 80,
        height: process.stdout.rows || 24,
      });
    process.stdout.on('resize', resize);
    return () => {
      process.stdout.off('resize', resize);
    };
  }, []);

  useInput(
    (
      input: string,
      key: {
        return?: boolean;
        backspace?: boolean;
        delete?: boolean;
        ctrl?: boolean;
        meta?: boolean;
        upArrow?: boolean;
        downArrow?: boolean;
        leftArrow?: boolean;
        rightArrow?: boolean;
        escape?: boolean;
      },
    ) => {
      if (key.ctrl && input === 'c') {
        exit();
        return;
      }
      if (isListReview(state)) {
        if (key.ctrl || key.meta) return;
        const dispatch = (event: TuiShellEvent) => {
          setState((previous) => reduceOpenTuiLocalState(previous, event));
          props.dispatch(event);
        };
        const command = key.upArrow
          ? 'up'
          : key.downArrow
            ? 'down'
            : key.leftArrow
              ? 'left'
              : key.rightArrow
                ? 'right'
                : key.escape
                  ? 'escape'
                  : key.return
                    ? 'enter'
                    : input;
        if (dispatchReviewKey(state, command, dispatch) !== 'ignored') {
          if (key.escape || key.return) editCursor.current = null;
          return;
        }
        if (state.candidateEditMode || state.planModifyMode) {
          const chars = Array.from(
            state.candidateEditMode ? state.candidateEditDraft : state.planModifyDraft,
          );
          let cursor = Math.min(editCursor.current ?? chars.length, chars.length);
          if (key.leftArrow) cursor = Math.max(0, cursor - 1);
          else if (key.rightArrow) cursor = Math.min(chars.length, cursor + 1);
          else if (key.backspace || key.delete) {
            if (cursor > 0) chars.splice(--cursor, 1);
          } else if (input && !key.upArrow && !key.downArrow) {
            const inserted = Array.from(input);
            chars.splice(cursor, 0, ...inserted);
            cursor += inserted.length;
          }
          editCursor.current = cursor;
          dispatch({
            type: state.candidateEditMode ? 'candidate_edit_input' : 'plan_modify_input',
            text: chars.join(''),
          });
        }
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

  const messages =
    state.messages.length === 0
      ? React.createElement(
          Text,
          { dimColor: true },
          'Type a message and press Enter to get started.',
        )
      : state.messages.map((msg) =>
          React.createElement(
            Box,
            { key: msg.id, flexDirection: 'column' },
            React.createElement(
              Box,
              { flexDirection: 'row' },
              React.createElement(
                Text,
                { dimColor: true },
                `[${msg.type === 'user' ? 'YOU' : msg.type === 'assistant' ? ' AI' : 'SYS'}]`,
              ),
              React.createElement(Text, null, ` ${completionMessageParts(msg).heading}`),
            ),
            successBrandLines(msg, dimensions, state.messages).length > 0
              ? React.createElement(
                  Text,
                  { color: 'green', bold: true },
                  successBrandLines(msg, dimensions, state.messages).join('\n'),
                )
              : null,
            completionMessageParts(msg).details
              ? React.createElement(Text, null, completionMessageParts(msg).details)
              : null,
          ),
        );

  return React.createElement(
    Box,
    { flexDirection: 'column', paddingX: 1, paddingY: 1 },
    React.createElement(
      Box,
      { marginBottom: 1, flexDirection: 'column' },
      React.createElement(
        Text,
        { dimColor: true },
        `${startupLines.length > 1 ? '' : 'iTestAgent '}v0.0.1 — ${state.workspace}`,
      ),
      React.createElement(Text, { dimColor: true }, `Device: ${state.deviceStatus}`),
      state.agentActivity
        ? React.createElement(Text, { dimColor: true }, `Activity: ${state.agentActivity.text}`)
        : null,
    ),
    startupLines.length > 0
      ? React.createElement(Text, { color: STARTUP_BRAND_COLOR }, startupLines.join('\n'))
      : null,
    React.createElement(
      Box,
      { flexDirection: 'column', marginBottom: 1 },
      isListReview(state)
        ? React.createElement(Text, null, reviewPresentation(state, dimensions.height).join('\n'))
        : messages,
    ),
    React.createElement(
      Box,
      null,
      React.createElement(Text, null, '> '),
      React.createElement(
        Text,
        null,
        state.candidateEditMode
          ? state.candidateEditDraft
          : state.planModifyMode
            ? state.planModifyDraft
            : draft,
      ),
    ),
  );
}

export function createInkRenderer(): TuiRenderer {
  const stateRef: { current: ((s: TuiShellState) => void) | null } = { current: null };

  return {
    async start(initialState, dispatch) {
      const instance = render(React.createElement(InkApp, { initialState, dispatch, stateRef }));
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
