import type { ScrollBoxRenderable } from '@opentui/core';
import { testRender } from '@opentui/solid';
import { jsx } from '@opentui/solid/jsx-runtime';
import { OpenTuiApp } from '../../../../packages/itestagent-tui/src/renderers/opentui-renderer.js';
import {
  type Message,
  type TuiShellEvent,
  type TuiShellState,
  createInitialState,
} from '../../../../packages/itestagent-tui/src/tui-shell.js';

const message = (id: string, text: string, type: Message['type'] = 'system'): Message => ({
  id,
  text,
  type,
  timestamp: 0,
});
let state: TuiShellState = {
  ...createInitialState('/tmp/chat-layout-fixture'),
  messages: [message('short', 'SHORT_MESSAGE')],
};
const stateRef: { current: ((state: TuiShellState) => void) | null } = { current: null };
const events: TuiShellEvent[] = [];
const setup = await testRender(
  () =>
    jsx(OpenTuiApp, {
      initialState: state,
      dispatch: (event: TuiShellEvent) => events.push(event),
      setStateRef: stateRef,
    }),
  { width: 100, height: 36 },
);
const snapshots: Record<string, unknown>[] = [];
function transcript(): ScrollBoxRenderable {
  return setup.renderer.root.findDescendantById('chat-transcript') as ScrollBoxRenderable;
}
async function capture(name: string) {
  await setup.flush();
  const scroll = transcript();
  const input = setup.renderer.root.findDescendantById('chat-input');
  if (!scroll || !input) throw new Error('Missing bounded transcript/input containers');
  snapshots.push({
    name,
    frame: setup.captureCharFrame(),
    scrollTop: scroll.scrollTop,
    scrollHeight: scroll.scrollHeight,
    viewport: {
      x: scroll.viewport.x,
      y: scroll.viewport.y,
      width: scroll.viewport.width,
      height: scroll.viewport.height,
    },
    input: { x: input.x, y: input.y, width: input.width, height: input.height },
    barVisible: scroll.verticalScrollBar.visible,
  });
}
function patch(patch: Partial<TuiShellState>) {
  state = { ...state, ...patch };
  stateRef.current?.(state);
}
try {
  await capture('short');
  patch({
    agentActivity: { callId: 'fixture', text: 'Installing the validated application…' },
    messages: Array.from({ length: 40 }, (_, i) =>
      message(
        `history-${i}`,
        `HISTORY_${i + 1} ${i % 7 === 0 ? '中文长消息验证不会覆盖输入区域。'.repeat(8) : 'Permission allow.'}`,
        i % 3 === 0 ? 'user' : 'system',
      ),
    ),
  });
  await capture('overflow');
  await setup.mockInput.typeText('draft stays');
  patch({ messages: [...state.messages, message('stream', 'STREAM_BEGIN', 'assistant')] });
  await capture('stream-start');
  patch({
    messages: state.messages.map((msg) =>
      msg.id === 'stream'
        ? { ...msg, text: `STREAM_BEGIN\n${'streaming line\n'.repeat(8)}STREAM_END` }
        : msg,
    ),
  });
  await capture('stream-grown');
  const scroll = transcript();
  await setup.mockMouse.scroll(scroll.viewport.x + 3, scroll.viewport.y + 3, 'up');
  await capture('wheel-up');
  setup.mockInput.pressKey('\x1b[5~');
  await capture('page-up');
  patch({ messages: [...state.messages, message('new-while-reading', 'NEW_WHILE_READING')] });
  await capture('reading-retained');
  setup.resize(60, 28);
  await capture('reading-resized');
  setup.resize(100, 36);
  await capture('reading-restored');
  for (
    let i = 0;
    i < 50 && transcript().scrollTop < transcript().scrollHeight - transcript().viewport.height;
    i++
  ) {
    setup.mockInput.pressKey('\x1b[6~');
    await setup.flush();
  }
  await capture('returned-bottom');
  patch({
    agentActivity: null,
    messages: [
      ...state.messages,
      {
        ...message(
          'complete',
          'Execution completed.\nReport directory: /tmp/chat-layout-fixture/runs/run-example\nSummary: /tmp/chat-layout-fixture/runs/run-example/summary.md\nEvidence directory: /tmp/chat-layout-fixture/runs/run-example/artifacts',
        ),
        runStatus: 'passed',
      },
    ],
  });
  await capture('completed');
  setup.resize(45, 24);
  await capture('narrow');
  setup.resize(100, 36);
  await capture('restored');
  setup.mockInput.pressEnter();
  await setup.flush();
  process.stdout.write(JSON.stringify({ snapshots, events }));
} finally {
  setup.renderer.destroy();
}
