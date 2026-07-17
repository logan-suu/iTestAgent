import { describe, expect, test } from 'bun:test';
import type { AgentEvent, SessionAbortedEvent, SessionIdleEvent } from 'itestagent-contracts';
import { SSEHub } from '../src/sse-hub.js';

// ─── Helpers ─────────────────────────────────────────────────

function idleEvent(sessionId: string): SessionIdleEvent {
  return { type: 'session.idle', sessionId };
}

function abortedEvent(sessionId: string, reason = 'test abort'): SessionAbortedEvent {
  return { type: 'session.aborted', sessionId, reason };
}

/** Read the first chunk from a ReadableStream. Returns decoded string or '' if timed out. */
async function readFirstChunk(
  stream: ReadableStream<Uint8Array>,
  timeoutMs = 200,
): Promise<string> {
  const reader = stream.getReader();
  try {
    const result = await Promise.race([
      reader.read(),
      new Promise<undefined>((r) => setTimeout(() => r(undefined), timeoutMs)),
    ]);
    if (result && !result.done && result.value) {
      return new TextDecoder().decode(result.value);
    }
  } catch {
    // Stream closed.
  }
  return '';
}

/** Read all chunks from a ReadableStream until it closes. */
async function readAllChunks(stream: ReadableStream<Uint8Array>): Promise<string> {
  const reader = stream.getReader();
  const chunks: string[] = [];
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) chunks.push(new TextDecoder().decode(value));
  }
  return chunks.join('');
}

// ─── Tests ───────────────────────────────────────────────────

describe('SSEHub', () => {
  test('subscribe() returns a ReadableStream', () => {
    const hub = new SSEHub();
    const stream = hub.subscribe('ses_001');
    expect(stream).toBeInstanceOf(ReadableStream);
  });

  test('subscribe() increments session count', () => {
    const hub = new SSEHub();
    expect(hub.sessionCount).toBe(0);
    hub.subscribe('ses_001');
    expect(hub.sessionCount).toBe(1);
  });

  test('broadcast() delivers event to subscriber', async () => {
    const hub = new SSEHub();
    const stream = hub.subscribe('ses_001');

    const event: AgentEvent = {
      type: 'session.started',
      sessionId: 'ses_001',
      workspace: '/test',
      startedAt: new Date().toISOString(),
    };
    hub.broadcast('ses_001', event);

    const output = await readFirstChunk(stream);
    expect(output).toContain('event: session.started');
    expect(output).toContain('data:');
    expect(output).toContain('ses_001');

    hub.closeSession('ses_001');
  });

  test('broadcast() is session-isolated — different sessions do not cross-pollinate', async () => {
    const hub = new SSEHub();
    const streamA = hub.subscribe('ses_A');
    const streamB = hub.subscribe('ses_B');

    hub.broadcast('ses_A', {
      type: 'session.started',
      sessionId: 'ses_A',
      workspace: '/a',
      startedAt: new Date().toISOString(),
    });

    const outA = await readFirstChunk(streamA);
    expect(outA).toContain('/a');

    const outB = await readFirstChunk(streamB);
    expect(outB).toBe('');

    hub.closeAll();
  });

  test('terminal event closes the stream automatically', async () => {
    const hub = new SSEHub();
    const stream = hub.subscribe('ses_001');

    hub.broadcast('ses_001', idleEvent('ses_001'));

    const output = await readAllChunks(stream);
    expect(output).toContain('event: session.idle');
    expect(hub.sessionCount).toBe(0);
  });

  test('multiple subscribers for the same session all receive events', async () => {
    const hub = new SSEHub();
    const stream1 = hub.subscribe('ses_001');
    const stream2 = hub.subscribe('ses_001');

    hub.broadcast('ses_001', { type: 'turn.started', turnId: 'turn_1' });

    const out1 = await readFirstChunk(stream1);
    const out2 = await readFirstChunk(stream2);

    expect(out1).toContain('turn.started');
    expect(out2).toContain('turn.started');

    hub.closeSession('ses_001');
  });

  test('terminal event closes ALL subscribers for the session', async () => {
    const hub = new SSEHub();
    const stream1 = hub.subscribe('ses_001');
    const stream2 = hub.subscribe('ses_001');

    hub.broadcast('ses_001', abortedEvent('ses_001'));

    const [out1, out2] = await Promise.all([readAllChunks(stream1), readAllChunks(stream2)]);

    expect(out1).toContain('session.aborted');
    expect(out2).toContain('session.aborted');
    expect(hub.sessionCount).toBe(0);
  });

  test('closeSession() cleans up all subscribers', () => {
    const hub = new SSEHub();
    hub.subscribe('ses_001');
    hub.subscribe('ses_001');
    expect(hub.sessionCount).toBe(1);

    hub.closeSession('ses_001');
    expect(hub.sessionCount).toBe(0);
  });

  test('closeSession() is idempotent for unknown sessions', () => {
    const hub = new SSEHub();
    expect(() => hub.closeSession('nonexistent')).not.toThrow();
  });

  test('closeAll() cleans up all sessions', () => {
    const hub = new SSEHub();
    hub.subscribe('ses_A');
    hub.subscribe('ses_B');
    hub.subscribe('ses_C');
    expect(hub.sessionCount).toBe(3);

    hub.closeAll();
    expect(hub.sessionCount).toBe(0);
  });

  test('broadcast to unknown session does not throw', () => {
    const hub = new SSEHub();
    expect(() => hub.broadcast('nonexistent', idleEvent('nonexistent'))).not.toThrow();
  });

  test('SSE output format is valid', async () => {
    const hub = new SSEHub();
    const stream = hub.subscribe('ses_001');

    hub.broadcast('ses_001', {
      type: 'tool.progress',
      callId: 'call_1',
      message: 'Installing...',
    });

    const output = await readFirstChunk(stream);
    const lines = output.split('\n');

    expect(lines).toContain('event: tool.progress');
    expect(lines).toContain('id: 1');

    const dataLine = lines.find((l) => l.startsWith('data: '));
    expect(dataLine).toBeDefined();
    const parsed = JSON.parse(dataLine?.slice(6) ?? '');
    expect(parsed.type).toBe('tool.progress');
    expect(parsed.callId).toBe('call_1');
    expect(parsed.message).toBe('Installing...');

    hub.closeSession('ses_001');
  });

  test('event IDs are monotonic', async () => {
    const hub = new SSEHub();
    const stream = hub.subscribe('ses_001');

    hub.broadcast('ses_001', { type: 'tool.progress', callId: 'c1', message: 'a' });
    hub.broadcast('ses_001', { type: 'tool.progress', callId: 'c2', message: 'b' });
    hub.broadcast('ses_001', { type: 'tool.progress', callId: 'c3', message: 'c' });

    // Force close after broadcasting all events.
    hub.closeSession('ses_001');

    const output = await readAllChunks(stream);
    const idLines = output.split('\n').filter((l) => l.startsWith('id: '));
    expect(idLines).toEqual(['id: 1', 'id: 2', 'id: 3']);
  });

  test('session entry removed after terminal event', async () => {
    const hub = new SSEHub();
    const stream = hub.subscribe('ses_001');

    hub.broadcast('ses_001', idleEvent('ses_001'));
    await readAllChunks(stream);

    expect(hub.sessionCount).toBe(0);
  });
});
