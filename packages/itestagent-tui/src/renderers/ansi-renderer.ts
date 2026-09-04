import type { createInterface } from 'node:readline';
import { createAnsiInputHandler } from '../ansi-input.js';
import { RESET } from '../ansi-layout.js';
import type { TuiRenderer } from '../renderer.js';
import type { TuiShellEvent, TuiShellState } from '../tui-shell.js';
import { moveCursorToPromptColumn, renderScreen } from './ansi-renderer-frame.js';
import { dispatchCandidateKey, dispatchPlanKey } from './opentui-key-dispatch.js';

// ── Simple ANSI terminal renderer — zero external dependencies ──
//
// B27: frame composition lives in ./ansi-renderer-frame.ts, layout constants
// in ../ansi-layout.ts, and raw-input handling in ../ansi-input.ts. This file
// keeps only the renderer wiring (stdin lifecycle + dispatch plumbing).
// Output bytes are locked by test/ansi-renderer.test.ts characterization.

export function createAnsiRenderer(): TuiRenderer {
  let currentState: TuiShellState;
  let dispatchFn: ((event: TuiShellEvent) => void) | null = null;
  const rl: ReturnType<typeof createInterface> | null = null;
  let activeDataListener: ((chunk: string) => void) | null = null;
  let activeResizeListener: (() => void) | null = null;
  let resolveExit: (() => void) | null = null;

  const cleanup = () => {
    process.stdin.setRawMode?.(false);
    process.stdin.pause();
    if (activeDataListener) {
      process.stdin.removeListener('data', activeDataListener);
      activeDataListener = null;
    }
    if (activeResizeListener) {
      process.stdout.off('resize', activeResizeListener);
      activeResizeListener = null;
    }
    resolveExit?.();
    resolveExit = null;
  };

  const input = createAnsiInputHandler({
    write: (chunk) => {
      process.stdout.write(chunk);
    },
    submit: (text) => {
      if (dispatchFn) {
        if (currentState.mode === 'candidate_review') {
          if (currentState.candidateEditMode && text) {
            dispatchFn({ type: 'candidate_edit_input', text });
          }
          dispatchCandidateKey(
            {
              dispatch: dispatchFn,
              editMode: currentState.candidateEditMode,
              editDraft: text || currentState.candidateEditDraft,
            },
            currentState.candidateEditMode || !text ? 'enter' : text,
          );
          renderScreen(currentState);
          return;
        }
        if (currentState.mode === 'plan_review') {
          if (currentState.planModifyMode && text) {
            dispatchFn({ type: 'plan_modify_input', text });
          }
          dispatchPlanKey(
            {
              dispatch: dispatchFn,
              editMode: currentState.planModifyMode,
              editDraft: text || currentState.planModifyDraft,
            },
            currentState.planModifyMode || !text ? 'enter' : text,
          );
          renderScreen(currentState);
          return;
        }
        dispatchFn({ type: 'input', text });
        dispatchFn({ type: 'submit' });
        // Re-render
        renderScreen(currentState);
      }
    },
    interrupt: () => {
      cleanup();
    },
    maskInput: () => currentState?.mode === 'setup' && currentState.setupStep === 1,
  });

  return {
    async start(initialState, dispatch) {
      currentState = initialState;
      dispatchFn = dispatch;

      // Render initial screen
      renderScreen(currentState);

      // Set up raw stdin
      process.stdin.setRawMode?.(true);
      process.stdin.resume();
      process.stdin.setEncoding('utf-8');

      const onData = (chunk: string) => {
        if (
          dispatchFn &&
          currentState.mode === 'candidate_review' &&
          !currentState.candidateEditMode
        ) {
          for (const char of chunk) {
            dispatchCandidateKey(
              { dispatch: dispatchFn, editMode: false, editDraft: '' },
              char === '\r' ? 'enter' : char,
            );
          }
          return;
        }
        if (dispatchFn && currentState.mode === 'plan_review' && !currentState.planModifyMode) {
          for (const char of chunk) {
            dispatchPlanKey(
              { dispatch: dispatchFn, editMode: false, editDraft: '' },
              char === '\r' ? 'enter' : char,
            );
          }
          return;
        }
        input.handleChunk(chunk);
      };
      activeDataListener = onData;
      activeResizeListener = () => renderScreen(currentState);

      process.stdin.on('data', onData);
      process.stdout.on('resize', activeResizeListener);

      // Wait for exit signal
      const onSignal = () => {
        process.stdout.write(`${RESET}\r\n`);
        cleanup();
      };
      await new Promise<void>((resolve) => {
        resolveExit = resolve;
        process.once('SIGINT', onSignal);
        process.once('SIGTERM', onSignal);
      });
      process.removeListener('SIGINT', onSignal);
      process.removeListener('SIGTERM', onSignal);
    },

    update(state: TuiShellState) {
      currentState = state;
      renderScreen(state);
      process.stdout.write(`> ${input.getInputBuffer()}`);
    },
  };
}

// Retained for API parity with the pre-refactor module surface.
export { moveCursorToPromptColumn };
