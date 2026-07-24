import { describe, expect, it } from 'bun:test';
import { MockAgentRuntime } from 'itestagent-engine';

describe('Phase 3 Agent Execution', () => {
  it('MockAgentRuntime creates and aborts', () => {
    const runtime = new MockAgentRuntime();
    runtime.abort('test');
    expect(runtime.isAborted()).toBe(true);
  });
});
