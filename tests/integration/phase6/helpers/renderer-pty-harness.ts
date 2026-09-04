import { appendFileSync, writeFileSync } from 'node:fs';
import { createConfiguredRenderer } from '../../../../packages/itestagent-tui/src/renderer-factory.js';
import { createInitialState } from '../../../../packages/itestagent-tui/src/tui-shell.js';

const rendererKind = process.argv[2];
const eventPath = process.argv[3];
if (!rendererKind || !eventPath) {
  throw new Error('usage: renderer-pty-harness.ts <renderer> <event-path>');
}

writeFileSync(eventPath, '');
const selected = await createConfiguredRenderer(rendererKind);
process.stdout.write(`PTY_SELECTED:${selected.kind}\n`);
await selected.renderer.start(createInitialState('/tmp/renderer-pty-workspace'), (event) => {
  appendFileSync(eventPath, `${JSON.stringify(event)}\n`);
});
