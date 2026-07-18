import type {
  AgentEvent,
  AgentRuntime,
  AgentTurnInput,
  ToolCall,
  ToolResult,
} from 'itestagent-contracts';

/**
 * Configuration for MockAgentRuntime behavior.
 */
export interface MockAgentRuntimeConfig {
  /** Delay in ms between yielding each event. Default: 0 (no delay). */
  delayMs: number;
  /** Default maxSteps when input.maxSteps is not provided. Default: 10. */
  defaultMaxSteps: number;
}

const DEFAULT_CONFIG: MockAgentRuntimeConfig = {
  delayMs: 0,
  defaultMaxSteps: 10,
};

/**
 * History of events and tool calls recorded during a session.
 */
export interface RuntimeHistory {
  events: AgentEvent[];
  toolCalls: ToolCall[];
}

/**
 * MockAgentRuntime — test double for AgentRuntime interface.
 *
 * Implements AgentRuntime without AI SDK dependency. Returns
 * preset event sequences and tool results for deterministic
 * testing of Server/SessionManager/SSE integration.
 *
 * Per ADR-010 § "AgentRuntime interface":
 *   AgentRuntime wraps AI SDK, responsible for stream/event/abort,
 *   does not directly execute device commands.
 *
 * Phase 1 notes:
 *   Mock AgentRuntime 在 AI SDK major 锁定后改用真实 AgentRuntime。
 */
export class MockAgentRuntime implements AgentRuntime {
  private eventSequence: AgentEvent[] = [];
  private toolResults: Map<string, ToolResult> = new Map();
  private config: MockAgentRuntimeConfig = { ...DEFAULT_CONFIG };

  private _aborted = false;
  private _abortedReason: string | null = null;
  private history: RuntimeHistory = { events: [], toolCalls: [] };

  // ─── Configuration ─────────────────────────────────────────

  setEventSequence(events: AgentEvent[]): void {
    this.eventSequence = events;
  }

  setToolResults(results: Map<string, ToolResult>): void {
    this.toolResults = results;
  }

  setConfig(partial: Partial<MockAgentRuntimeConfig>): void {
    this.config = { ...this.config, ...partial };
  }

  // ─── AgentRuntime.streamTurn ───────────────────────────────

  async *streamTurn(input: AgentTurnInput): AsyncIterable<AgentEvent> {
    if (this._aborted) {
      return;
    }

    const maxSteps = input.maxSteps ?? this.config.defaultMaxSteps;
    if (maxSteps <= 0) {
      return;
    }

    let count = 0;
    for (const event of this.eventSequence) {
      if (this._aborted) break;
      if (count >= maxSteps) break;

      yield event;
      this.history.events.push(event);
      count++;

      if (this.config.delayMs > 0 && count < maxSteps && !this._aborted) {
        await new Promise<void>((resolve) => setTimeout(resolve, this.config.delayMs));
      }
    }
  }

  // ─── AgentRuntime.executeToolCall ──────────────────────────

  async executeToolCall(call: ToolCall): Promise<ToolResult> {
    this.history.toolCalls.push(call);

    const preset = this.toolResults.get(call.id);
    if (preset) {
      return preset;
    }

    return {
      callId: call.id,
      status: 'error',
      output: { error: `no preset result for callId "${call.id}"` },
    };
  }

  // ─── AgentRuntime.abort ────────────────────────────────────

  async abort(reason: string): Promise<void> {
    if (this._aborted) return;
    this._aborted = true;
    this._abortedReason = reason;
  }

  // ─── Assertion helpers ─────────────────────────────────────

  isAborted(): boolean {
    return this._aborted;
  }

  getAbortedReason(): string | null {
    return this._abortedReason;
  }

  resetAbort(): void {
    this._aborted = false;
    this._abortedReason = null;
  }

  getHistory(): RuntimeHistory {
    return {
      events: [...this.history.events],
      toolCalls: [...this.history.toolCalls],
    };
  }

  clearHistory(): void {
    this.history = { events: [], toolCalls: [] };
  }
}
