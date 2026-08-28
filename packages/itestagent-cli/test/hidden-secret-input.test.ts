/**
 * hidden-secret-input.test.ts — B17 CLI secret-entry safety (promotion guide
 * §11.3 "CLI safety/config"; R6/R7).
 *
 * Locks the extracted hidden-input reader contract:
 *   - typed characters NEVER reach the output stream in plaintext;
 *   - every accepted character echoes a fixed mask char (user feedback);
 *   - Enter resolves the trimmed value; backspace edits it;
 *   - Ctrl+C resolves an empty value (caller decides whether to abort);
 *   - the prompt itself IS written so the user knows what is asked.
 */
import { describe, expect, it } from 'bun:test';
import { PassThrough } from 'node:stream';
import { readHiddenSecret } from '../src/config/hidden-secret-input.js';

interface CapturedOutput {
  text: string;
}

function makeStreams() {
  const input = new PassThrough();
  const output = new PassThrough();
  const captured: CapturedOutput = { text: '' };
  output.on('data', (chunk: Buffer | string) => {
    captured.text += typeof chunk === 'string' ? chunk : chunk.toString('utf-8');
  });
  return { input, output, captured };
}

describe('readHiddenSecret', () => {
  it('resolves the entered value while suppressing plaintext echo', async () => {
    const { input, output, captured } = makeStreams();
    const pending = readHiddenSecret({ prompt: 'pw: ', input, output });

    input.write('hunter2\r');

    await expect(pending).resolves.toBe('hunter2');
    expect(captured.text).toContain('pw: ');
    expect(captured.text).not.toContain('hunter2');
    expect(captured.text).toContain('*******');
  });

  it('supports backspace editing before Enter', async () => {
    const { input, output, captured } = makeStreams();
    const pending = readHiddenSecret({ prompt: 'pw: ', input, output });

    input.write('ab');
    input.write('\u007f'); // backspace removes 'b'
    input.write('c\r');

    await expect(pending).resolves.toBe('ac');
    expect(captured.text).not.toContain('ab');
  });

  it('resolves an empty value on Ctrl+C', async () => {
    const { input, output, captured } = makeStreams();
    const pending = readHiddenSecret({ prompt: 'pw: ', input, output });

    input.write('\u0003'); // Ctrl+C

    await expect(pending).resolves.toBe('');
    expect(captured.text).toContain('pw: ');
  });

  it('trims surrounding whitespace from the entered value', async () => {
    const { input, output } = makeStreams();
    const pending = readHiddenSecret({ prompt: 'pw: ', input, output });

    input.write('  spaced  \n');

    await expect(pending).resolves.toBe('spaced');
  });
});
