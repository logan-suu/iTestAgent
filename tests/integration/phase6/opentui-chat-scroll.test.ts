import { expect, test } from 'bun:test';
import { SUCCESS_LOGO } from '../../../packages/itestagent-tui/src/startup-brand.js';

interface Snapshot {
  name: string;
  frame: string;
  scrollTop: number;
  scrollHeight: number;
  viewport: { x: number; y: number; width: number; height: number };
  input: { x: number; y: number; width: number; height: number };
  barVisible: boolean;
}

test('OpenTUI bounds chat history, follows the tail and preserves manual reading and input', async () => {
  const child = Bun.spawn(
    ['bun', 'tests/integration/phase6/helpers/opentui_chat_scroll_harness.tsx'],
    { stdout: 'pipe', stderr: 'pipe' },
  );
  const [exitCode, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  expect(exitCode, stderr || stdout).toBe(0);
  const result = JSON.parse(stdout) as {
    snapshots: Snapshot[];
    events: Array<{ type: string; text?: string }>;
  };
  const get = (name: string) => {
    const snapshot = result.snapshots.find((s) => s.name === name);
    if (!snapshot) throw new Error(`Missing snapshot: ${name}`);
    return snapshot;
  };
  const atBottom = (s: Snapshot) =>
    Math.abs(s.scrollTop - Math.max(0, s.scrollHeight - s.viewport.height)) <= 1;
  expect(get('short').barVisible).toBe(false);
  expect(get('short').frame).toContain('SHORT_MESSAGE');
  for (const name of [
    'overflow',
    'stream-start',
    'stream-grown',
    'returned-bottom',
    'completed',
    'narrow',
    'restored',
  ]) {
    expect(get(name).barVisible, name).toBe(true);
    expect(atBottom(get(name)), name).toBe(true);
  }
  expect(get('overflow').frame).toContain('HISTORY_40');
  expect(get('stream-grown').frame).toContain('STREAM_END');
  expect(get('wheel-up').scrollTop).toBeLessThan(get('stream-grown').scrollTop);
  expect(get('page-up').scrollTop).toBeLessThan(get('wheel-up').scrollTop);
  expect(get('reading-retained').scrollTop).toBe(get('page-up').scrollTop);
  expect(atBottom(get('reading-retained'))).toBe(false);
  expect(atBottom(get('reading-resized'))).toBe(false);
  expect(atBottom(get('reading-restored'))).toBe(false);
  for (const name of ['completed', 'restored']) {
    const frame = get(name).frame;
    for (const row of SUCCESS_LOGO) expect(frame).toContain(row.trimEnd());
    expect(frame.indexOf('Execution completed.')).toBeLessThan(
      frame.indexOf(SUCCESS_LOGO[0]?.trimEnd() ?? ''),
    );
    expect(frame.indexOf(SUCCESS_LOGO[3]?.trimEnd() ?? '')).toBeLessThan(
      frame.indexOf('Report directory:'),
    );
    expect(frame).not.toContain('SUCCESS');
  }
  expect(get('narrow').frame).toContain('SUCCESS');
  expect(get('completed').frame).toContain('Evidence directory:');
  expect(get('restored').frame).toContain('/artifacts');
  for (const snapshot of result.snapshots) {
    expect(snapshot.viewport.y + snapshot.viewport.height, snapshot.name).toBeLessThanOrEqual(
      snapshot.input.y,
    );
    const belowTranscript = snapshot.frame.split('\n').slice(snapshot.input.y).join('\n');
    const aboveTranscript = snapshot.frame.split('\n').slice(0, snapshot.viewport.y).join('\n');
    expect(aboveTranscript, snapshot.name).not.toMatch(
      /HISTORY_|STREAM_|SUCCESS|Report directory|Evidence directory|\[Sys\]/,
    );
    for (const row of SUCCESS_LOGO) expect(aboveTranscript).not.toContain(row.trimEnd());
    expect(belowTranscript, snapshot.name).not.toMatch(
      /HISTORY_|STREAM_|SUCCESS|[█▀▄]|Report directory|Evidence directory|\[Sys\]/,
    );
    expect(snapshot.input.y + snapshot.input.height).toBeLessThanOrEqual(
      snapshot.frame.split('\n').length,
    );
  }
  expect(result.events.filter((event) => event.type === 'input')).toEqual([
    { type: 'input', text: 'draft stays' },
  ]);
  expect(result.events.filter((event) => event.type === 'submit')).toHaveLength(1);
}, 15_000);
