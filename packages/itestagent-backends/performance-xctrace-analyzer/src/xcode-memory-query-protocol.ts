import { randomBytes } from 'node:crypto';
import { z } from 'zod';

export const memoryQueryBindingSchema = z
  .object({
    sessionId: z.string().uuid(),
    requestId: z.string().uuid(),
    strategy: z.literal('pidReturn'),
    commandSHA256: z.string().regex(/^[a-f0-9]{64}$/),
  })
  .strict();
export type MemoryQueryIPCBinding = z.infer<typeof memoryQueryBindingSchema>;
const base = memoryQueryBindingSchema.extend({
  protocolVersion: z.literal(3),
  sequence: z.number().int().positive().safe(),
  challenge: z.string().regex(/^[a-f0-9]{64}$/),
});
export const memoryQueryFrameSchema = z.discriminatedUnion('kind', [
  base.extend({ kind: z.literal('hello') }).strict(),
  base.extend({ kind: z.literal('hello_ack') }).strict(),
  base.extend({ kind: z.literal('prepared') }).strict(),
  base.extend({ kind: z.literal('decision'), effect: z.enum(['allow', 'deny']) }).strict(),
  base.extend({ kind: z.literal('result'), result: z.string().max(12288) }).strict(),
  base.extend({ kind: z.literal('closing') }).strict(),
  base.extend({ kind: z.literal('closed') }).strict(),
]);
export type MemoryQueryIPCFrame = z.infer<typeof memoryQueryFrameSchema>;

/** Byte framing is separate from authorization. Neither raw frames nor challenges
 * may be logged. Any parse error poisons the decoder, including incomplete EOF.
 */
export class MemoryQueryFrameDecoder {
  #buffer = Buffer.alloc(0);
  #failed = false;
  get pendingBytes() {
    return this.#buffer.length;
  }
  push(chunk: Uint8Array): MemoryQueryIPCFrame[] {
    if (this.#failed) throw new Error('query.ipc_closed');
    try {
      if (chunk.byteLength + this.#buffer.byteLength > 32768) throw new Error();
      this.#buffer = Buffer.concat([this.#buffer, chunk]);
      const frames: MemoryQueryIPCFrame[] = [];
      let newline = this.#buffer.indexOf(10);
      while (newline !== -1) {
        if (newline === 0 || newline > 16384) throw new Error();
        const raw = new TextDecoder('utf-8', { fatal: true }).decode(
          this.#buffer.subarray(0, newline),
        );
        frames.push(memoryQueryFrameSchema.parse(JSON.parse(raw)));
        this.#buffer = this.#buffer.subarray(newline + 1);
        newline = this.#buffer.indexOf(10);
      }
      if (this.#buffer.length > 16384) throw new Error();
      return frames;
    } catch {
      this.#failed = true;
      this.#buffer = Buffer.alloc(0);
      throw new Error('query.ipc_invalid');
    }
  }
  end() {
    const invalid = this.#failed || this.#buffer.length !== 0;
    this.#failed = true;
    this.#buffer = Buffer.alloc(0);
    if (invalid) throw new Error('query.ipc_truncated');
  }
}

/** Parent state machine. Peer process verification is the native launcher's job;
 * a matching challenge alone never proves a peer's identity or resource cleanup.
 */
export class MemoryQueryIPCProtocol {
  readonly binding: Readonly<MemoryQueryIPCBinding>;
  #challenge = randomBytes(32).toString('hex');
  #sequence = 0;
  #state:
    | 'new'
    | 'hello'
    | 'ack'
    | 'prepared'
    | 'decided'
    | 'result'
    | 'closing'
    | 'closed'
    | 'failed' = 'new';
  #allow = false;
  #until: number;
  #deadline: number;
  #now: () => number;
  #grantAttempted = false;
  constructor(binding: MemoryQueryIPCBinding, deadline: number, now = () => performance.now()) {
    this.binding = Object.freeze(memoryQueryBindingSchema.parse(binding));
    this.#deadline = deadline;
    this.#now = now;
    this.#until = Math.min(deadline, now() + 5000);
    this.#check();
  }
  get state() {
    return this.#state;
  }
  get grantAttempted() {
    return this.#grantAttempted;
  }
  #check() {
    if (
      this.#state === 'failed' ||
      !Number.isFinite(this.#deadline) ||
      this.#now() >= this.#until
    ) {
      this.#state = 'failed';
      throw new Error('query.ipc_unavailable');
    }
  }
  #frame(fields: { kind: 'hello' } | { kind: 'decision'; effect: 'allow' | 'deny' }) {
    const frame = {
      ...this.binding,
      protocolVersion: 3,
      sequence: ++this.#sequence,
      challenge: this.#challenge,
      ...fields,
    };
    const line = JSON.stringify(frame);
    if (Buffer.byteLength(line) > 16384) throw new Error('query.ipc_invalid');
    return `${line}\n`;
  }
  hello() {
    this.#check();
    if (this.#state !== 'new') {
      this.fail();
      throw new Error('query.ipc_order');
    }
    this.#state = 'hello';
    return this.#frame({ kind: 'hello' });
  }
  decision(effect: 'allow' | 'deny') {
    this.#check();
    if (this.#state !== 'prepared' || !['allow', 'deny'].includes(effect)) {
      this.fail();
      throw new Error('query.ipc_order');
    }
    this.#state = 'decided';
    this.#allow = effect === 'allow';
    // Set before transport write: an error cannot prove no delivery.
    this.#grantAttempted = this.#allow;
    this.#until = this.#deadline;
    return this.#frame({ kind: 'decision', effect });
  }
  receive(input: unknown): string | undefined {
    this.#check();
    try {
      const frame = memoryQueryFrameSchema.parse(input);
      if (
        frame.challenge !== this.#challenge ||
        frame.sequence !== this.#sequence + 1 ||
        Object.keys(this.binding).some(
          (key) =>
            frame[key as keyof MemoryQueryIPCBinding] !==
            this.binding[key as keyof MemoryQueryIPCBinding],
        )
      )
        throw new Error();
      if (frame.kind === 'hello_ack' && this.#state === 'hello') this.#state = 'ack';
      else if (frame.kind === 'prepared' && this.#state === 'ack') {
        this.#state = 'prepared';
        this.#until = Math.min(this.#deadline, this.#now() + 120000);
      } else if (frame.kind === 'result' && this.#state === 'decided' && this.#allow)
        this.#state = 'result';
      else if (
        frame.kind === 'closing' &&
        ['ack', 'prepared', 'decided', 'result'].includes(this.#state)
      )
        this.#state = 'closing';
      else if (frame.kind === 'closed' && this.#state === 'closing') this.#state = 'closed';
      else throw new Error();
      this.#sequence = frame.sequence;
      return frame.kind === 'result' ? frame.result : undefined;
    } catch {
      this.fail();
      throw new Error('query.ipc_invalid');
    }
  }
  end() {
    if (this.#state !== 'closed') {
      this.fail();
      throw new Error('query.ipc_disconnected');
    }
  }
  fail() {
    this.#state = 'failed';
  }
}
