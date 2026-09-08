import { describe, expect, test } from 'bun:test';
import { applyAgentPatch } from '../src/entry.js';
import { createInitialState, tuiShellReducer } from '../src/tui-shell.js';

describe('committed run outcome presentation', () => {
  test('preserves the validated canonical outcome on a system terminal message', () => {
    const state = applyAgentPatch(createInitialState(), {
      type: 'message_add',
      payload: { role: 'system', text: 'Report directory: /tmp/run', runStatus: 'passed' },
    });
    expect(state.messages[0]).toMatchObject({ type: 'system', runStatus: 'passed' });
  });

  for (const payload of [
    { role: 'system', text: 'SUCCESS' },
    { role: 'system', text: 'SUCCESS', runStatus: 'completed' },
    { role: 'system', text: 'SUCCESS', runStatus: { status: 'passed' } },
    { role: 'user', text: 'SUCCESS', runStatus: 'passed' },
    { role: 'assistant', text: 'SUCCESS', runStatus: 'passed' },
    { text: 'SUCCESS', runStatus: 'passed' },
  ]) {
    test(`does not derive a trusted success outcome from ${JSON.stringify(payload)}`, () => {
      const state = applyAgentPatch(createInitialState(), { type: 'message_add', payload });
      expect(state.messages[0]?.runStatus).toBeUndefined();
    });
  }

  test('does not interpret input or streamed assistant text as a success banner', () => {
    const initial = createInitialState();
    const input = tuiShellReducer(initial, { type: 'input', text: 'SUCCESS' });
    const submitted = tuiShellReducer(input, { type: 'submit' });
    const streamed = applyAgentPatch(submitted, {
      type: 'message_update',
      payload: { id: 'assistant', text: 'SUCCESS', runStatus: 'passed' },
    });
    expect(streamed.messages.map((message) => message.runStatus)).toEqual([undefined, undefined]);
  });
});
