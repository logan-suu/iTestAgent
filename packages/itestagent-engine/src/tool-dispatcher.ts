/**
 * ToolDispatcher — ADR-010 §5 Harness 边界核心组件。
 *
 * 职责链：
 *   ToolCall → Zod parse → PermissionEngine → BackendSelector
 *   → backend method → normalize ToolResult → AgentEvent
 *
 * 作为 toolExecutor 回调注入 AiSdkAgentRuntime。
 * 权限事件（permission.requested/resolved）由本组件通过 onEvent 回调发出。
 */

import type { AgentEvent, ArtifactRef, DeviceBackend, TargetKind } from 'itestagent-contracts';
import {
  LaunchAppInputSchema,
  OpenUrlInputSchema,
  PressButtonInputSchema,
  ScreenshotInputSchema,
  SwipeInputSchema,
  TapInputSchema,
  TerminateAppInputSchema,
  TypeTextInputSchema,
} from 'itestagent-contracts';
import { parseToolCall } from 'itestagent-contracts';
import type { BackendSelector } from './backend-selector.js';
import type { PermissionEngine, ResolveResult } from './permission-engine.js';

// ─── Types ─────────────────────────────────────────────────────

export type EventEmitter = (event: AgentEvent) => void;

export interface ToolDispatcherOptions {
  permissionEngine: PermissionEngine;
  backendSelector: BackendSelector;
  /** Target kind for backend selection (default: 'physical'). */
  targetKind?: TargetKind;
  /** Optional event emitter for permission/tool/artifact lifecycle events. */
  onEvent?: EventEmitter;
  /** AbortSignal for cancellation propagation. */
  signal?: AbortSignal;
}

interface ToolMapping {
  /** DeviceBackend method name */
  method: keyof DeviceBackend;
  /** Zod parse function: args → typed input */
  // biome-ignore lint/suspicious/noExplicitAny: dynamic param schemas
  parseParams: (args: Record<string, unknown>) => any;
  /** Permission action name */
  action: string;
}

/** Maximum output size in chars before truncation (R5: not silent). */
const MAX_OUTPUT_SIZE = 50_000;

/** Maximum raw UI tree string before truncation. */
const MAX_RAW_SIZE = 100_000;

// ─── Tool Registry ─────────────────────────────────────────────

const noopParse = (args: Record<string, unknown>): Record<string, unknown> => args;

const TOOL_REGISTRY: Record<string, ToolMapping> = {
  tap: {
    method: 'tap',
    parseParams: (args) => TapInputSchema.parse(args),
    action: 'tap',
  },
  swipe: {
    method: 'swipe',
    parseParams: (args) => SwipeInputSchema.parse(args),
    action: 'swipe',
  },
  type_text: {
    method: 'typeText',
    parseParams: (args) => TypeTextInputSchema.parse(args),
    action: 'type_text',
  },
  press_button: {
    method: 'pressButton',
    parseParams: (args) => PressButtonInputSchema.parse(args),
    action: 'press_button',
  },
  screenshot: {
    method: 'screenshot',
    parseParams: (args) => ScreenshotInputSchema.parse(args),
    action: 'screenshot',
  },
  get_ui_tree: {
    method: 'getUiTree',
    parseParams: noopParse,
    action: 'get_ui_tree',
  },
  launch_app: {
    method: 'launchApp',
    parseParams: (args) => LaunchAppInputSchema.parse(args),
    action: 'launch_app',
  },
  terminate_app: {
    method: 'terminateApp',
    parseParams: (args) => TerminateAppInputSchema.parse(args),
    action: 'terminate_app',
  },
  open_url: {
    method: 'openUrl',
    parseParams: (args) => OpenUrlInputSchema.parse(args),
    action: 'open_url',
  },
  list_devices: {
    method: 'listDevices',
    parseParams: noopParse,
    action: 'list_devices',
  },
  healthcheck: {
    method: 'healthcheck',
    parseParams: noopParse,
    action: 'healthcheck',
  },
  list_apps: {
    method: 'listApps',
    parseParams: noopParse,
    action: 'list_apps',
  },
  start_recording: {
    method: 'startRecording',
    parseParams: noopParse,
    action: 'start_recording',
  },
  stop_recording: {
    method: 'stopRecording',
    parseParams: noopParse,
    action: 'stop_recording',
  },
  list_crashes: {
    method: 'listCrashes',
    parseParams: noopParse,
    action: 'list_crashes',
  },
  collect_logs: {
    method: 'collectLogs',
    parseParams: noopParse,
    action: 'collect_logs',
  },
};

// ─── Helpers ───────────────────────────────────────────────────

function deriveResource(action: string, args: Record<string, unknown>): string {
  // Extract the most specific resource identifier from tool arguments
  const deviceId = typeof args.deviceId === 'string' ? args.deviceId : undefined;
  const bundleId = typeof args.bundleId === 'string' ? args.bundleId : undefined;

  if (bundleId) return `bundleId:${bundleId}`;
  if (deviceId) return `deviceId:${deviceId}`;
  // Fallback: action name as resource
  return `action:${action}`;
}

function safeSerialize(value: unknown): unknown {
  try {
    // Detects circular references — JSON.stringify throws on cycles
    const serialized = JSON.stringify(value);
    return JSON.parse(serialized);
  } catch {
    // Circular reference or non-serializable value
    if (typeof value === 'object' && value !== null) {
      return {
        error: 'unserializable_output',
        hint: 'Output contains circular references or non-JSON values',
      };
    }
    return String(value);
  }
}

function normalizeOutput(raw: unknown): unknown {
  if (raw === undefined || raw === null) return raw;

  // Handle ArtifactRef — pass through as-is
  if (typeof raw === 'object' && raw !== null && 'id' in raw && 'type' in raw && 'path' in raw) {
    return raw;
  }

  // Handle UiTreeSnapshot — truncate raw field if too large
  if (
    typeof raw === 'object' &&
    raw !== null &&
    'raw' in raw &&
    typeof (raw as Record<string, unknown>).raw === 'string'
  ) {
    const snapshot = raw as Record<string, unknown>;
    const rawText = snapshot.raw as string;
    if (rawText.length > MAX_RAW_SIZE) {
      return {
        ...(safeSerialize(raw) as Record<string, unknown>),
        raw: `${rawText.slice(0, MAX_RAW_SIZE)}... [truncated: ${rawText.length - MAX_RAW_SIZE} chars omitted]`,
        truncated: true,
        truncationReason: `UI tree raw content exceeded ${MAX_RAW_SIZE} chars (R5: explicit truncation)`,
      };
    }
    return raw;
  }

  // Generic truncation for large string/number outputs
  try {
    const serialized = typeof raw === 'string' ? raw : JSON.stringify(raw);
    if (serialized.length > MAX_OUTPUT_SIZE) {
      return {
        value: typeof raw === 'string' ? `${raw.slice(0, MAX_OUTPUT_SIZE)}...` : raw,
        truncated: true,
        truncationReason: `Output exceeded ${MAX_OUTPUT_SIZE} chars (R5: explicit truncation)`,
        originalSize: serialized.length,
      };
    }
  } catch {
    // JSON.stringify failed (circular ref / non-serializable) — fall through to safeSerialize
  }

  // Ensure JSON-serializable (handles circular refs gracefully)
  return safeSerialize(raw);
}

function normalizeError(error: unknown): { error: string; cause?: string } {
  if (error instanceof Error) {
    return {
      error: error.message,
      cause: error.cause ? String(error.cause) : undefined,
    };
  }
  return { error: String(error) };
}

// ─── ToolDispatcher ────────────────────────────────────────────

/**
 * ToolDispatcher — implements the full ADR-010 dispatch chain.
 *
 * Usable directly as the `toolExecutor` callback for AiSdkAgentRuntime:
 *   const dispatcher = new ToolDispatcher({ permissionEngine, backendSelector });
 *   const runtime = new AiSdkAgentRuntime({ ..., toolExecutor: (call) => dispatcher.dispatch(call) });
 */
export class ToolDispatcher {
  private permissionEngine: PermissionEngine;
  private backendSelector: BackendSelector;
  private targetKind: TargetKind;
  private onEvent: EventEmitter | undefined;
  private signal: AbortSignal | undefined;

  constructor(options: ToolDispatcherOptions) {
    this.permissionEngine = options.permissionEngine;
    this.backendSelector = options.backendSelector;
    this.targetKind = options.targetKind ?? 'physical';
    this.onEvent = options.onEvent;
    this.signal = options.signal;
  }

  /**
   * Dispatch a tool call through the full chain.
   *
   * @returns ToolResult with status 'ok' or 'error'.
   */
  async dispatch(call: { id: string; name: string; arguments: Record<string, unknown> }): Promise<{
    callId: string;
    status: 'ok' | 'error';
    output: unknown;
    artifacts?: ArtifactRef[];
  }> {
    const callId = call.id;
    const startedAt = Date.now();

    // 0. Abort check
    if (this.signal?.aborted) {
      return this.errorResult(callId, 'Tool call aborted before execution', 'aborted');
    }

    // 1. Zod parse ToolCall
    let parsedCall: { id: string; name: string; arguments: Record<string, unknown> };
    try {
      parsedCall = parseToolCall(call);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return this.errorResult(callId, `Invalid tool call: ${msg}`, 'validation_error');
    }

    // 2. Look up tool mapping
    const mapping = TOOL_REGISTRY[parsedCall.name];
    if (!mapping) {
      return this.errorResult(
        callId,
        `Unknown tool: "${parsedCall.name}". Available tools: ${Object.keys(TOOL_REGISTRY).join(', ')}`,
        'unknown_tool',
      );
    }

    // 3. Zod parse tool arguments
    let parsedArgs: unknown;
    try {
      parsedArgs = mapping.parseParams(parsedCall.arguments);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return this.errorResult(
        callId,
        `Invalid arguments for ${parsedCall.name}: ${msg}`,
        'invalid_arguments',
      );
    }

    // 4. Permission gate
    const resource = deriveResource(mapping.action, parsedCall.arguments);

    const permissionResult = await this.checkPermission(callId, mapping.action, resource);
    if (permissionResult.denied) {
      return this.errorResult(
        callId,
        permissionResult.reason ?? `Permission denied: ${mapping.action} on ${resource}`,
        'permission_denied',
      );
    }

    // 5. Backend selection
    const selectResult = this.backendSelector.select(
      this.targetKind,
      undefined,
      typeof parsedCall.arguments.deviceId === 'string' ? parsedCall.arguments.deviceId : undefined,
    );

    if (!selectResult.success || !selectResult.backend) {
      return this.errorResult(
        callId,
        selectResult.error ?? 'No backend available',
        selectResult.errorCode ?? 'blocked.target_unsupported',
      );
    }

    const backend = selectResult.backend;

    // 6. Emit tool.started
    this.emit({
      type: 'tool.started',
      callId,
      name: parsedCall.name,
      backend: backend.name,
    });

    // 7. Execute backend method
    try {
      // Abort check before execution
      if (this.signal?.aborted) {
        this.emit({
          type: 'tool.failed',
          callId,
          error: { code: 'backend.error', message: 'Tool call aborted' },
        });
        return this.errorResult(callId, 'Tool call aborted mid-execution', 'aborted');
      }

      const method = backend[mapping.method] as (...args: unknown[]) => Promise<unknown>;
      const rawResult = await method.call(backend, parsedArgs);

      // 8. Collect artifacts
      const artifacts: ArtifactRef[] = [];
      if (rawResult && typeof rawResult === 'object') {
        const resultObj = rawResult as Record<string, unknown>;
        // DeviceBackend methods returning ArtifactRef directly
        if ('id' in resultObj && 'type' in resultObj && 'path' in resultObj) {
          const artRef = resultObj as unknown as ArtifactRef;
          artifacts.push(artRef);
          this.emit({
            type: 'artifact.created',
            artifact: artRef,
          });
        }
      }

      // 9. Normalize output
      const normalized = normalizeOutput(rawResult);

      // 10. Emit tool.completed
      this.emit({
        type: 'tool.completed',
        callId,
        result: {
          callId,
          status: 'ok' as const,
          output: normalized,
        },
      });

      return {
        callId,
        status: 'ok',
        output: normalized,
        ...(artifacts.length > 0 ? { artifacts } : {}),
      };
    } catch (err: unknown) {
      // 11. Normalize error (R5: never silent)
      const errorInfo = normalizeError(err);

      this.emit({
        type: 'tool.failed',
        callId,
        error: {
          code: 'backend.error',
          message: errorInfo.error,
        },
      });

      return {
        callId,
        status: 'error',
        output: {
          error: errorInfo.error,
          cause: errorInfo.cause,
          tool: parsedCall.name,
          backend: backend.name,
        },
      };
    }
  }

  // ─── Private helpers ─────────────────────────────────────────

  private async checkPermission(
    callId: string,
    action: string,
    resource: string,
  ): Promise<{ denied: boolean; reason?: string }> {
    const gate = this.permissionEngine.check(action, resource);

    if (gate === 'allow') {
      return { denied: false };
    }

    if (gate === 'deny') {
      return { denied: true, reason: `Permission denied: ${action} on ${resource}` };
    }

    // gate === 'ask' — emit event and block for user resolution
    this.emit({
      type: 'permission.requested',
      callId,
      action,
      resource,
    });

    try {
      const result = await this.permissionEngine.requestPermission(callId, action, resource);

      this.emit({
        type: 'permission.resolved',
        callId,
        effect: result.effect,
      });

      if (result.effect === 'deny') {
        return { denied: true, reason: `Permission denied by user: ${action} on ${resource}` };
      }
      return { denied: false };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);

      this.emit({
        type: 'permission.resolved',
        callId,
        effect: 'deny',
      });

      return { denied: true, reason: `Permission timeout: ${message}` };
    }
  }

  private errorResult(
    callId: string,
    error: string,
    code?: string,
  ): { callId: string; status: 'error'; output: unknown } {
    return {
      callId,
      status: 'error',
      output: { error, ...(code ? { code } : {}) },
    };
  }

  private emit(event: AgentEvent): void {
    if (this.onEvent) {
      this.onEvent(event);
    }
  }
}
