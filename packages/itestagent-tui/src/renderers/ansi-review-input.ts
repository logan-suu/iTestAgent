import { type Key, emitKeypressEvents } from 'node:readline';
import { PassThrough } from 'node:stream';

/** Use Node's terminal decoder so split CSI/SS3 arrows never become letter shortcuts. */
export function createAnsiReviewInput(onKey: (value: string, key: Key) => void) {
  const stream = new PassThrough();
  emitKeypressEvents(stream);
  stream.on('keypress', (value: string | undefined, key: Key) => {
    onKey(
      ['up', 'down', 'left', 'right', 'escape', 'return'].includes(key.name ?? '')
        ? String(key.name)
        : (value ?? ''),
      key,
    );
  });
  return {
    handleChunk(chunk: string) {
      stream.write(chunk);
    },
    dispose() {
      stream.removeAllListeners();
      stream.destroy();
    },
  };
}
