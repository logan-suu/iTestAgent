import { tool as aiTool, stepCountIs, streamText } from 'ai';
import type { LanguageModel, ModelMessage, ToolSet } from 'ai';
import type { TextStreamPart } from 'ai';
import type {
  AgentEvent,
  AgentRuntime,
  AgentTurnInput,
  ToolCall,
  ToolResult,
} from 'itestagent-contracts';

export type ToolExecutor = (call: ToolCall) => Promise<ToolResult>;

export interface AiToolDefinition {
  description: string;
  // biome-ignore lint/suspicious/noExplicitAny: AI SDK type constraint
  parameters: any;
}

export interface AiSdkAgentRuntimeOptions {
  model: LanguageModel;
  tools?: Record<string, AiToolDefinition>;
  toolExecutor?: ToolExecutor;
  system?: string;
  maxSteps?: number;
}

/**
 * AiSdkAgentRuntime — real AgentRuntime backed by Vercel AI SDK
 * multi-step tool-calling.
 *
 * Wraps streamText for the agent loop; maps AI SDK stream parts
 * to iTestAgent AgentEvent discriminated union (16 types).
 * Tool execution delegated through injected toolExecutor callback
 * (ADR-010: AgentRuntime never directly executes device commands).
 *
 * AC coverage (US-17.1):
 *   AC1: streamTurn loop with tool-call continuation; idle on finish.
 *   AC2: Uses Vercel AI SDK streamText with multi-step.
 *   AC4: Single-session serial; AbortController per instance.
 *   AC5: No Effect-TS / event sourcing (R10).
 */
export class AiSdkAgentRuntime implements AgentRuntime {
  private model: LanguageModel;
  private toolDefs: Record<string, AiToolDefinition>;
  private toolExecutor: ToolExecutor | undefined;
  private systemPrompt: string | undefined;
  private maxStepCount: number;
  private abortController: AbortController | null = null;

  constructor(options: AiSdkAgentRuntimeOptions) {
    this.model = options.model;
    this.toolDefs = options.tools ?? {};
    this.toolExecutor = options.toolExecutor;
    this.systemPrompt = options.system;
    this.maxStepCount = options.maxSteps ?? 10;
  }

  async *streamTurn(input: AgentTurnInput): AsyncIterable<AgentEvent> {
    const maxSteps = input.maxSteps ?? this.maxStepCount;
    this.abortController = new AbortController();

    const sessionId = `ses_${Date.now()}`;
    const turnId = `turn_${Date.now()}`;
    const systemPrompt = input.system ?? this.systemPrompt;

    const sdkTools = this.buildSdkToolSet();

    let errored = false;

    try {
      const sdkMessages = this.buildModelMessages(input);
      const result = streamText({
        model: this.model,
        messages: sdkMessages,
        ...(systemPrompt ? { system: systemPrompt } : {}),
        tools: sdkTools,
        abortSignal: this.abortController.signal,
        stopWhen: stepCountIs(maxSteps),
        onError: () => {
          errored = true;
        },
      });

      for await (const part of result.fullStream) {
        if (this.abortController.signal.aborted) break;
        const event = this.mapStreamPart(part, turnId, sessionId);
        if (event) yield event;
      }
    } catch (err: unknown) {
      if (this.abortController.signal.aborted) {
        yield {
          type: 'session.aborted',
          sessionId,
          reason: this.abortController.signal.reason ?? 'aborted',
        } satisfies AgentEvent;
      } else {
        errored = true;
        yield {
          type: 'session.error',
          sessionId,
          error: {
            code: 'backend.error',
            message: err instanceof Error ? err.message : String(err),
          },
        } satisfies AgentEvent;
      }
      return;
    }

    if (!errored && !this.abortController.signal.aborted) {
      yield {
        type: 'turn.completed',
        turnId,
        summary: 'stream complete',
      } satisfies AgentEvent;
      yield {
        type: 'session.idle',
        sessionId,
      } satisfies AgentEvent;
    }
  }

  async executeToolCall(call: ToolCall): Promise<ToolResult> {
    if (!this.toolExecutor) {
      return {
        callId: call.id,
        status: 'error',
        output: { error: 'no tool executor configured' },
      };
    }
    return this.toolExecutor(call);
  }

  async abort(reason: string): Promise<void> {
    if (!this.abortController || this.abortController.signal.aborted) return;
    this.abortController.abort(reason);
  }

  // ─── Internal helpers ────────────────────────────────────

  private buildModelMessages(input: AgentTurnInput): ModelMessage[] {
    const raw = input.messages as Array<{
      role: string;
      content?: unknown;
      parts?: unknown[];
      toolCallId?: string;
      toolName?: string;
      output?: unknown;
    }>;

    return raw.map((m) => {
      switch (m.role) {
        case 'system':
          return { role: 'system', content: String(m.content ?? '') } as ModelMessage;
        case 'user':
          return { role: 'user', content: String(m.content ?? '') } as ModelMessage;
        case 'assistant': {
          const parts = m.parts as unknown[];
          if (Array.isArray(parts) && parts.length > 0) {
            return { role: 'assistant', content: parts } as ModelMessage;
          }
          return { role: 'assistant', content: String(m.content ?? '') } as ModelMessage;
        }
        case 'tool':
          return {
            role: 'tool',
            content: [
              {
                type: 'tool-result',
                toolCallId: m.toolCallId ?? '',
                toolName: m.toolName ?? '',
                output: m.output ?? m.content,
              },
            ],
          } as ModelMessage;
        default:
          return { role: 'user', content: String(m.content ?? JSON.stringify(m)) } as ModelMessage;
      }
    });
  }

  private buildSdkToolSet(): ToolSet {
    const executor = this.toolExecutor;
    // biome-ignore lint/suspicious/noExplicitAny: AI SDK type constraint
    const tools: Record<string, any> = {};

    for (const [name, def] of Object.entries(this.toolDefs)) {
      tools[name] = aiTool({
        description: def.description,
        parameters: def.parameters,
        execute: async (args: unknown): Promise<unknown> => {
          if (!executor) {
            throw new Error('no tool executor configured');
          }
          const result = await executor({
            id: '',
            name,
            arguments: args as Record<string, unknown>,
          });
          if (result.status === 'error') {
            const output = result.output as Record<string, unknown> | undefined;
            const message =
              output && typeof output === 'object' && 'error' in output
                ? String(output.error)
                : String(result.output);
            throw new Error(message);
          }
          return result.output;
        },
        // biome-ignore lint/suspicious/noExplicitAny: AI SDK ToolSet type constraint
      } as any);
    }

    return tools as ToolSet;
  }

  private mapStreamPart(
    part: TextStreamPart<ToolSet>,
    turnId: string,
    sessionId: string,
  ): AgentEvent | null {
    const p = part as Record<string, unknown>;

    switch (part.type) {
      case 'text-delta':
        return {
          type: 'assistant.delta',
          delta: String(p.text ?? ''),
          turnId,
        } satisfies AgentEvent;

      case 'tool-call':
        return {
          type: 'tool.requested',
          callId: p.toolCallId ? String(p.toolCallId) : crypto.randomUUID(),
          name: String(p.toolName ?? ''),
          arguments: (p.input as Record<string, unknown>) ?? {},
        } satisfies AgentEvent;

      case 'tool-result':
        return {
          type: 'tool.completed',
          callId: p.toolCallId ? String(p.toolCallId) : crypto.randomUUID(),
          result: {
            callId: p.toolCallId ? String(p.toolCallId) : crypto.randomUUID(),
            status: 'ok' as const,
            output: p.output,
          },
        } satisfies AgentEvent;

      case 'tool-error':
        return {
          type: 'tool.failed',
          callId: p.toolCallId ? String(p.toolCallId) : crypto.randomUUID(),
          error: {
            code: 'backend.error',
            message:
              p.error instanceof Error ? p.error.message : String(p.error ?? 'unknown tool error'),
          },
        } satisfies AgentEvent;

      case 'error':
        return {
          type: 'session.error',
          sessionId,
          error: {
            code: 'backend.error',
            message:
              p.error instanceof Error ? p.error.message : String(p.error ?? 'unknown error'),
          },
        } satisfies AgentEvent;

      case 'finish':
      case 'start-step':
      case 'finish-step':
      case 'start':
      case 'text-start':
      case 'text-end':
      case 'reasoning-start':
      case 'reasoning-end':
      case 'reasoning-delta':
      case 'source':
      case 'file':
      case 'reasoning-file':
      case 'tool-input-start':
      case 'tool-input-end':
      case 'tool-input-delta':
      case 'tool-output-denied':
      case 'tool-approval-request':
      case 'tool-approval-response':
      case 'custom':
      case 'raw':
      case 'abort':
        return null;
    }

    return null;
  }
}
