import { renderToString } from 'ink';
import { RunStatusSchema } from 'itestagent-contracts';
import React from 'react';
import { InkApp } from '../../../../packages/itestagent-tui/src/renderers/ink-renderer.js';
import {
  type Message,
  type TuiShellState,
  createInitialState,
} from '../../../../packages/itestagent-tui/src/tui-shell.js';

function frame(
  messages: Message[],
  columns = 100,
  rows = 50,
  overrides: Partial<TuiShellState> = {},
): string {
  const previousColumns = Object.getOwnPropertyDescriptor(process.stdout, 'columns');
  const previousRows = Object.getOwnPropertyDescriptor(process.stdout, 'rows');
  Object.defineProperty(process.stdout, 'columns', { value: columns, configurable: true });
  Object.defineProperty(process.stdout, 'rows', { value: rows, configurable: true });
  try {
    return renderToString(
      React.createElement(InkApp, {
        initialState: { ...createInitialState('/tmp/project'), messages, ...overrides },
        dispatch: () => {},
        stateRef: { current: null },
      }),
      { columns },
    );
  } finally {
    for (const [key, descriptor] of [
      ['columns', previousColumns],
      ['rows', previousRows],
    ] as const) {
      if (descriptor) Object.defineProperty(process.stdout, key, descriptor);
      else Reflect.deleteProperty(process.stdout, key);
    }
  }
}

const initialListeners = process.stdout.listenerCount('resize');
const welcome = frame([]);
const deviceReview = frame([], 100, 50, {
  mode: 'device_review',
  deviceSelectionTargetKind: 'physical',
  deviceSelectionIndex: 1,
  devices: [
    {
      udid: 'private-phone',
      name: 'USB iPhone',
      platform: 'ios',
      targetKind: 'physical',
      availability: 'ready',
    },
    {
      udid: 'private-sim',
      name: 'Simulator iPhone',
      platform: 'ios',
      targetKind: 'simulator',
      state: 'shutdown',
      availability: 'discovered',
    },
  ],
  deviceTargetSwitch: {
    token: 'private-token',
    udid: 'private-sim',
    name: 'Simulator iPhone',
    from: 'physical',
    to: 'simulator',
  },
});
const passedMessages: Message[] = [
  {
    id: 'passed',
    type: 'system',
    text: 'Execution completed.\nReport directory: /tmp/真机 验收/run\nSummary: /tmp/真机 验收/run/summary.md',
    runStatus: 'passed',
    timestamp: 0,
  },
];
const passed = frame(passedMessages);
const compactWelcome = frame([], 30);
const compactPassed = frame(passedMessages, 30);
const shortPassed = frame(passedMessages, 100, 24);
const longRunDir = `/tmp/验收/${'long-project/'.repeat(8)}run`;
const contentPressurePassed = frame(
  [
    { id: 'goal', type: 'user', text: 'Confirmed test goal '.repeat(50), timestamp: 0 },
    {
      id: 'long-report',
      type: 'system',
      runStatus: 'passed',
      timestamp: 0,
      text: [
        'Execution completed.',
        `Report directory: ${longRunDir}`,
        `Summary: ${longRunDir}/summary.md`,
        `Evidence directory: ${longRunDir}/artifacts`,
      ].join('\n'),
    },
  ],
  100,
  36,
);
const untrusted = frame([
  { id: 'user', type: 'user', text: 'SUCCESS', timestamp: 0 },
  { id: 'assistant', type: 'assistant', text: 'SUCCESS', timestamp: 0 },
  ...(['user', 'assistant', 'error'] as const).map((type) => ({
    id: `untrusted-${type}`,
    type,
    text: 'SUCCESS',
    runStatus: 'passed' as const,
    timestamp: 0,
  })),
  ...RunStatusSchema.options
    .filter((status) => status !== 'passed')
    .map((runStatus) => ({
      id: runStatus,
      type: 'system' as const,
      text: 'SUCCESS',
      runStatus,
      timestamp: 0,
    })),
]);
process.stdout.write(
  JSON.stringify({
    welcome,
    deviceReview,
    compactWelcome,
    passed,
    compactPassed,
    shortPassed,
    contentPressurePassed,
    untrusted,
    resizeListenerDelta: process.stdout.listenerCount('resize') - initialListeners,
  }),
);
