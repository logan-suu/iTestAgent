import { appendFileSync, writeFileSync } from 'node:fs';
import { createConfiguredRenderer } from '../../../../packages/itestagent-tui/src/renderer-factory.js';
import { createInitialState } from '../../../../packages/itestagent-tui/src/tui-shell.js';

const rendererKind = process.argv[2];
const eventPath = process.argv[3];
const scenario = process.argv[4] ?? 'chat';
if (!rendererKind || !eventPath) {
  throw new Error('usage: renderer-pty-harness.ts <renderer> <event-path>');
}

writeFileSync(eventPath, '');
const selected = await createConfiguredRenderer(rendererKind);
process.stdout.write(`PTY_SELECTED:${selected.kind}\n`);
const initialState =
  scenario === 'setup-secret'
    ? {
        ...createInitialState('/tmp/renderer-pty-workspace'),
        mode: 'setup' as const,
        setupStep: 1,
        setupProvider: 'openai',
        setupBaseUrl: 'https://api.example.com/v1',
        setupModel: 'test-model',
      }
    : createInitialState('/tmp/renderer-pty-workspace');
await selected.renderer.start(initialState, (event) => {
  appendFileSync(eventPath, `${JSON.stringify(event)}\n`);
});
