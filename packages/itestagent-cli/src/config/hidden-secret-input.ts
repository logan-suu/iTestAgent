/**
 * Hidden secret input — B17 module split (promotion guide §11.3 "CLI
 * safety/config"; R6/R7).
 *
 * Extracted verbatim from the former inline `config set-secret`
 * implementation in cli.ts and made stream-injectable so tests can verify
 * the echo-suppression contract without a TTY:
 *
 *   - the prompt IS written to the output stream;
 *   - every accepted character echoes a fixed mask char (`*`), never the
 *     plaintext;
 *   - Enter (\r / \n) resolves the trimmed value;
 *   - backspace (\u007f / \b) removes the last entered character;
 *   - Ctrl+C (\u0003) resolves an empty string — the caller decides whether
 *     to abort.
 */

export interface HiddenSecretInputOptions {
  /** Prompt written before reading starts. */
  prompt?: string;
  /** Readable input stream; defaults to process.stdin. */
  input?: NodeJS.ReadableStream & { setRawMode?: (mode: boolean) => void };
  /** Writable output stream; defaults to process.stdout. */
  output?: NodeJS.WritableStream;
}

/**
 * Reads a secret value with local echo suppressed.
 * The raw value lives only in memory (R6): nothing but mask characters is
 * ever written to the output stream.
 */
export async function readHiddenSecret(options: HiddenSecretInputOptions = {}): Promise<string> {
  const {
    prompt = 'Enter value (input hidden): ',
    input = process.stdin,
    output = process.stdout,
  } = options;

  return new Promise((resolve, reject) => {
    output.write(prompt);
    let raw = '';
    let settled = false;

    const cleanup = () => {
      input.removeListener('data', onData);
      input.removeListener('end', onEnd);
      input.removeListener('close', onClose);
      input.removeListener('error', onError);
      try {
        (input as { setRawMode?: (mode: boolean) => void }).setRawMode?.(false);
      } catch {
        // Non-TTY streams cannot toggle raw mode.
      }
    };

    const finish = (value: string) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(value);
    };

    const onEnd = () => finish('');
    const onClose = () => finish('');
    const onError = (error: Error) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(error);
    };

    const onData = (chunk: Buffer | string) => {
      const str = typeof chunk === 'string' ? chunk : chunk.toString('utf-8');
      for (const ch of str) {
        if (ch === '\r' || ch === '\n') {
          output.write('\n');
          finish(raw.trim());
          return;
        }
        if (ch === '\u007f' || ch === '\b') {
          // Backspace: drop the last entered character.
          raw = raw.slice(0, -1);
        } else if (ch === '\u0003') {
          // Ctrl+C: hand back an empty value for the caller to abort on.
          finish('');
          return;
        } else {
          raw += ch;
          output.write('*');
        }
      }
    };

    input.on('data', onData);
    input.once('end', onEnd);
    input.once('close', onClose);
    input.once('error', onError);
    try {
      (input as { setRawMode?: (mode: boolean) => void }).setRawMode?.(true);
    } catch {
      // Non-TTY streams cannot toggle raw mode.
    }
  });
}
