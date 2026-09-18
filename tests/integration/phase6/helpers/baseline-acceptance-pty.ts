import { mock } from 'bun:test';
import { mkdir, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import * as sessions from '../../../../packages/itestagent-tui/src/agent-session.js';
import * as keys from '../../../../packages/itestagent-tui/src/api-key-loader.js';
import { baselineFixture } from './baseline-fixture.js';

const output = process.argv[2];
if (!output) throw new Error('Expected fixture audit output');
const fixture = await baselineFixture();
const directory = join(homedir(), '.itestagent/config');
await mkdir(directory, { recursive: true });
await writeFile(
  join(directory, 'itestagent.jsonc'),
  JSON.stringify({
    model: { baseURL: 'https://api.example.invalid/v1', model: 'fixture' },
    tui: { framework: 'opentui' },
  }),
);
mock.module('../../../../packages/itestagent-tui/src/api-key-loader.js', () => ({
  ...keys,
  loadApiKey: async () => ({ ok: true, apiKey: 'fixture-key' }),
}));
let asks = 0;
let success = false;
let disposed = false;
let turnFinished = Promise.resolve();
const actualCreate = sessions.createAgentSession;
mock.module('../../../../packages/itestagent-tui/src/agent-session.js', () => ({
  ...sessions,
  createAgentSession: async () => {
    const session = await actualCreate(fixture.root, {
      baselineAcceptance: fixture.dependencies,
      loadApiKey: async () => 'fixture-key',
      createModel: () => ({}) as never,
      listDevices: async () => [],
      analyzeWorkspace: async () => {
        throw new Error('Unexpected model/planning path');
      },
    });
    return {
      ...session,
      processMessage: async function* (input: string) {
        let finish: () => void = () => {};
        turnFinished = new Promise<void>((resolve) => {
          finish = resolve;
        });
        try {
          for await (const patch of session.processMessage(input)) {
            if (patch.type === 'permission_request') asks++;
            if (String(patch.payload.text ?? '').startsWith('Memory baseline updated'))
              success = true;
            yield patch;
          }
        } finally {
          finish();
        }
      },
      dispose() {
        disposed = true;
        session.dispose();
      },
    };
  },
}));
try {
  const { startTui } = await import('../../../../packages/itestagent-tui/src/entry.js');
  await startTui(fixture.root);
  await turnFinished;
  const baseline = await fixture.baselineStore.get(fixture.old.key);
  await writeFile(
    output,
    JSON.stringify({
      asks,
      success,
      disposed,
      peak: baseline?.memoryPeakMB,
      growth: baseline?.memoryGrowthMiB,
    }),
  );
} finally {
  await fixture.cleanup();
}
