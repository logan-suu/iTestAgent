/**
 * InteractiveRecorder — human-in-the-loop recording orchestrator.
 *
 * Task 3.13: Interactive Recording — Agent suggests next step + user confirms/corrects.
 * US-8.2 AC1-AC3: Agent suggestion → user confirm/modify/skip → execute → record RunStep.
 *
 * Architecture:
 *   The InteractiveRecorder coordinates between:
 *   - AgentRuntime (AI suggestions via streamTurn)
 *   - ToolDispatcher (executing confirmed actions)
 *   - RunStepRecorder (recording executed steps)
 *   - TUI (via callback-based events for user interaction)
 *
 *   It does NOT directly call DeviceBackend — all execution goes through ToolDispatcher
 *   to ensure PermissionEngine gating and proper event emission.
 */

import type { AgentRuntime, AgentTurnInput } from 'itestagent-contracts';
import type {
  RecordingEvent,
  RecordingResult,
  RecordingSessionConfig,
  RecordingSessionState,
  RecordingStep,
  SuggestedAction,
  UserResponse,
} from './types.js';

// ─── Callback Interface ──────────────────────────────────────────

/**
 * Callbacks for communicating recording events to the TUI/consumer layer.
 *
 * The implementor (TUI) subscribes to these to update the RecordingPanel.
 */
export interface RecordingCallbacks {
  /** Called when recording state changes */
  onStateChange: (event: { state: RecordingSessionState }) => void;
  /** Called when the Agent produces a suggestion for user review */
  onSuggestion: (event: { suggestion: SuggestedAction; stepIndex: number }) => void;
  /** Called when a step has been executed and recorded */
  onStepRecorded: (event: { step: RecordingStep; stepIndex: number }) => void;
  /** Called when a UI tree snapshot is available */
  onUiTreeUpdated: (event: { uiTree: string }) => void;
  /** Called when an error occurs */
  onError: (event: { message: string; recoverable: boolean }) => void;
}

// ─── Helper Types ────────────────────────────────────────────────

/** Function to fetch the current UI tree from the device. */
type UiTreeFetcher = () => Promise<string>;

/**
 * Function to execute a confirmed action on the device.
 * Returns a RunStep-compatible result.
 */
type ActionExecutor = (action: SuggestedAction) => Promise<{
  stepId: string;
  result: unknown;
  artifacts: string[];
}>;

/** Internal pause/resume mechanism. */
interface PauseState {
  resolve: (response: UserResponse) => void;
  reject: (error: Error) => void;
}

// ─── InteractiveRecorder ──────────────────────────────────────────

export class InteractiveRecorder {
  // ── Configuration ──
  private readonly config: RecordingSessionConfig;
  private readonly callbacks: RecordingCallbacks;
  private readonly agentRuntime: AgentRuntime;
  private readonly uiTreeFetcher: UiTreeFetcher;
  private readonly actionExecutor: ActionExecutor;

  // ── State ──
  private state: RecordingSessionState = 'idle';
  private steps: RecordingStep[] = [];
  private sessionId: string;
  private startedAt = '';
  private completedAt?: string;
  private cancelled = false;
  private currentSuggestedAction: SuggestedAction | null = null;

  // ── Pause / Stop ──
  private pauseState: PauseState | null = null;
  private stopRequested = false;
  private abortController: AbortController = new AbortController();

  // ── Counters ──
  private confirmedCount = 0;
  private skippedCount = 0;
  private stepIndex = 0;

  // ── System prompt ──
  private systemPromptBuilder:
    | ((context: {
        featureName: string;
        uiTree: string;
        historySteps: Array<{ action: string; target: string; status: string }>;
      }) => string)
    | null = null;

  constructor(options: {
    config: RecordingSessionConfig;
    callbacks: RecordingCallbacks;
    agentRuntime: AgentRuntime;
    uiTreeFetcher: UiTreeFetcher;
    actionExecutor: ActionExecutor;
    systemPromptBuilder?: (context: {
      featureName: string;
      uiTree: string;
      historySteps: Array<{ action: string; target: string; status: string }>;
    }) => string;
  }) {
    this.config = options.config;
    this.callbacks = options.callbacks;
    this.agentRuntime = options.agentRuntime;
    this.uiTreeFetcher = options.uiTreeFetcher;
    this.actionExecutor = options.actionExecutor;
    this.systemPromptBuilder = options.systemPromptBuilder ?? null;
    this.sessionId = this.generateSessionId();
  }

  // ── Public API ──────────────────────────────────────────────────

  /** Start the interactive recording loop. */
  async start(): Promise<RecordingResult> {
    if (this.state !== 'idle') {
      throw new Error(`Cannot start recording: current state is ${this.state}`);
    }

    this.startedAt = new Date().toISOString();
    this.abortController = new AbortController();
    this.state = 'suggesting';
    this.emitStateChange();

    try {
      while (!this.stopRequested) {
        // Check max steps
        if (this.config.maxSteps && this.stepIndex >= this.config.maxSteps) {
          this.complete();
          break;
        }

        // Step 1: Get UI tree snapshot
        const uiTree = await this.uiTreeFetcher();
        this.callbacks.onUiTreeUpdated({ uiTree });

        // Step 2: Ask Agent for next suggestion
        this.state = 'suggesting';
        this.emitStateChange();

        const suggestion = await this.getAgentSuggestion(uiTree);
        if (!suggestion) {
          // Agent has no more suggestions — recording complete
          this.complete();
          break;
        }

        this.currentSuggestedAction = suggestion;

        // Step 3: Present suggestion to user, wait for response
        this.state = 'awaiting_confirmation';
        this.emitStateChange();
        this.callbacks.onSuggestion({ suggestion, stepIndex: this.stepIndex });

        const response = await this.waitForUserResponse();

        // Step 4: Handle user response
        const shouldContinue = await this.handleUserResponse(response, suggestion);
        if (!shouldContinue) {
          break;
        }
      }
    } catch (error) {
      this.handleLoopError(error);
    }

    return this.buildResult();
  }

  /** Pause the recording. */
  pause(): void {
    if (this.state !== 'awaiting_confirmation') {
      return;
    }
    this.state = 'paused';
    this.emitStateChange();
  }

  /** Resume a paused recording with the previous suggestion still active. */
  resume(): void {
    if (this.state !== 'paused' || !this.pauseState) {
      return;
    }
    this.state = 'awaiting_confirmation';
    this.emitStateChange();

    // Re-emit the current suggestion so TUI can re-render
    if (this.currentSuggestedAction) {
      this.callbacks.onSuggestion({
        suggestion: this.currentSuggestedAction,
        stepIndex: this.stepIndex,
      });
    }
  }

  /** Cancel the recording immediately. */
  cancel(): void {
    this.cancelled = true;
    this.stopRequested = true;
    this.abortController.abort();

    // Resolve any pending user response waiter
    if (this.pauseState) {
      this.pauseState.resolve({ type: 'cancel' });
      this.pauseState = null;
    }

    this.completedAt = new Date().toISOString();
    this.state = 'cancelled';
    this.emitStateChange();
  }

  /**
   * Provide a user response to the current Agent suggestion.
   *
   * Must be called when state is 'awaiting_confirmation' or 'paused'.
   * Resolves the internal waiter so the recording loop can continue.
   */
  respondToSuggestion(response: UserResponse): void {
    if (!this.pauseState) {
      return;
    }
    this.pauseState.resolve(response);
    this.pauseState = null;
  }

  /** Get the current recording state. */
  getState(): RecordingSessionState {
    return this.state;
  }

  /** Get all recorded steps so far. */
  getSteps(): RecordingStep[] {
    return [...this.steps];
  }

  /** Get the current step index. */
  getStepIndex(): number {
    return this.stepIndex;
  }

  // ── Internal: Agent Suggestion ──────────────────────────────────

  /**
   * Ask the Agent to suggest the next action based on the current UI tree
   * and recording history.
   */
  private async getAgentSuggestion(uiTree: string): Promise<SuggestedAction | null> {
    const systemPrompt = this.buildSystemPrompt(uiTree);

    const turnInput: AgentTurnInput = {
      messages: [
        {
          role: 'user',
          content: 'Analyze the current screen and suggest the NEXT single action to record.',
        },
      ],
      system: systemPrompt,
      maxSteps: 1, // Only one tool call per suggestion round
    };

    try {
      const events: unknown[] = [];
      for await (const event of this.agentRuntime.streamTurn(turnInput)) {
        events.push(event);
        // Check for abort mid-stream
        if (this.abortController.signal.aborted) {
          break;
        }
      }

      // Parse the Agent's response to extract the SuggestedAction
      return this.parseSuggestionFromEvents(events);
    } catch (error) {
      if (this.abortController.signal.aborted) {
        return null;
      }
      throw error;
    }
  }

  /**
   * Build the system prompt for the Agent.
   *
   * Uses the injected systemPromptBuilder if available, otherwise
   * constructs a basic prompt inline.
   */
  private buildSystemPrompt(uiTree: string): string {
    if (this.systemPromptBuilder) {
      return this.systemPromptBuilder({
        featureName: this.config.featureName,
        uiTree,
        historySteps: this.steps
          .filter((s) => !s.skipped && s.step !== null)
          .map((s) => ({
            action: s.step?.action ?? 'unknown',
            target: s.step?.target ?? 'unknown',
            status: 'completed',
          })),
      });
    }

    // Fallback basic prompt
    const history = this.steps
      .filter((s) => !s.skipped && s.step !== null)
      .map((s) => `- ${s.step?.action}: ${s.step?.target ?? 'unknown'}`)
      .join('\n');

    return [
      'You are an iOS test recording assistant.',
      `You are recording the "${this.config.featureName}" feature.`,
      '',
      'PREVIOUSLY RECORDED STEPS:',
      history || '(none — this is the first step)',
      '',
      'CURRENT SCREEN UI TREE:',
      '```',
      uiTree.slice(0, 4000), // Truncate to prevent context overflow
      '```',
      '',
      'Suggest the NEXT single action to record.',
      'Respond with a JSON object:',
      '{',
      '  "action": "tap"|"swipe"|"input"|"screenshot"|"wait"|"launch",',
      '  "target": "human-readable description of the element to interact with",',
      '  "reasoning": "why this action is the logical next step",',
      '  "confidence": 0.0-1.0,',
      '  "text": "(for input action only) the text to type",',
      '  "direction": "(for swipe action only) up|down|left|right",',
      '  "waitMs": "(for wait action only) milliseconds to wait",',
      '  "bundleId": "(for launch action only) app bundle id"',
      '}',
      '',
      'If the flow appears complete, respond with {"action": "done", "reasoning": "..."}.',
    ].join('\n');
  }

  /**
   * Parse the Agent's streamed response events to extract a SuggestedAction.
   *
   * Looks for assistant text deltas and attempts to parse JSON from them.
   */
  private parseSuggestionFromEvents(events: unknown[]): SuggestedAction | null {
    // Collect all text deltas from the stream
    const textParts: string[] = [];
    for (const event of events) {
      const ev = event as Record<string, unknown>;
      if (ev.type === 'assistant.delta') {
        const content =
          typeof ev.text === 'string' ? ev.text : typeof ev.delta === 'string' ? ev.delta : '';
        if (content) {
          textParts.push(content);
        }
      }
    }

    const fullText = textParts.join('');

    // Try to find a JSON object in the response
    const jsonMatch = fullText.match(/\{[\s\S]*"action"[\s\S]*\}/);
    if (!jsonMatch) {
      // Check for "done" action without JSON
      if (fullText.includes('"done"') || fullText.toLowerCase().includes('complete')) {
        return null; // Flow complete
      }
      return null; // Could not parse
    }

    try {
      const parsed = JSON.parse(jsonMatch[0]);

      // Validate required fields
      if (!parsed.action || !parsed.target || !parsed.reasoning) {
        return null;
      }

      // Handle "done" action
      if (parsed.action === 'done') {
        return null;
      }

      return {
        action: parsed.action,
        target: parsed.target,
        text: parsed.text,
        direction: parsed.direction,
        waitMs: parsed.waitMs,
        bundleId: parsed.bundleId,
        reasoning: parsed.reasoning,
        confidence: typeof parsed.confidence === 'number' ? parsed.confidence : Number.NaN,
        suggestedLocator: parsed.suggestedLocator,
      };
    } catch {
      return null;
    }
  }

  // ── Internal: User Response Handling ────────────────────────────

  /**
   * Wait for the user to respond to a suggestion.
   *
   * Returns a promise that resolves when the user confirms, modifies, skips,
   * pauses, or cancels. The TUI calls handleUserResponse() to resolve this.
   */
  private waitForUserResponse(): Promise<UserResponse> {
    return new Promise<UserResponse>((resolve, reject) => {
      this.pauseState = { resolve, reject };

      // Auto-resolve on abort
      this.abortController.signal.addEventListener('abort', () => {
        resolve({ type: 'cancel' });
      });
    });
  }

  /**
   * Process the user's response to a suggestion.
   *
   * Returns true if the recording loop should continue, false if it should stop.
   */
  private async handleUserResponse(
    response: UserResponse,
    originalSuggestion: SuggestedAction,
  ): Promise<boolean> {
    // Clear the pause state (consumed)
    this.pauseState = null;

    switch (response.type) {
      case 'confirm': {
        await this.executeAndRecord(originalSuggestion, false);
        return true;
      }

      case 'modify': {
        await this.executeAndRecord(response.modifiedAction, true);
        return true;
      }

      case 'skip': {
        await this.recordSkip(originalSuggestion, response.reason);
        return true;
      }

      case 'pause': {
        this.pause();
        // The loop will resume when resume() is called externally,
        // which re-emits the suggestion. We wait for the next response.
        const nextResponse = await this.waitForUserResponse();
        if (nextResponse.type === 'cancel') {
          this.cancel();
          return false;
        }
        // Recursively handle the response to the re-emitted suggestion
        return this.handleUserResponse(nextResponse, originalSuggestion);
      }

      case 'cancel': {
        this.cancel();
        return false;
      }

      case 'add_comment': {
        // Add a comment-only step (no execution)
        const commentStep: RecordingStep = {
          step: null,
          originalSuggestion,
          userModified: false,
          skipped: true,
          skipReason: `User comment: ${response.comment}`,
          userComment: response.comment,
        };
        this.steps.push(commentStep);
        this.stepIndex++;
        this.skippedCount++;
        this.callbacks.onStepRecorded({ step: commentStep, stepIndex: this.stepIndex - 1 });
        return true;
      }

      default:
        return true;
    }
  }

  // ── Internal: Execution & Recording ─────────────────────────────

  /**
   * Execute a confirmed action on the device and record the step.
   */
  private async executeAndRecord(action: SuggestedAction, userModified: boolean): Promise<void> {
    this.state = 'executing';
    this.emitStateChange();

    try {
      const startMs = Date.now();
      const execResult = await this.actionExecutor(action);
      const duration = Date.now() - startMs;

      const step: RecordingStep = {
        step: {
          stepId: execResult.stepId,
          backend: this.config.backend,
          action: action.action,
          target: action.target,
          input: action.text ?? action.direction ?? null,
          result: execResult.result,
          artifacts: execResult.artifacts,
          startedAt: new Date().toISOString(),
          durationMs: duration,
        },
        originalSuggestion: action,
        userModified,
        skipped: false,
      };

      this.steps.push(step);
      this.stepIndex++;
      this.confirmedCount++;
      this.callbacks.onStepRecorded({ step, stepIndex: this.stepIndex - 1 });

      // Settle delay
      if (this.config.settleMs && this.config.settleMs > 0) {
        await this.sleep(this.config.settleMs);
      }
    } catch (error) {
      // Record failed step
      const startMs = Date.now();
      const errorMsg = error instanceof Error ? error.message : String(error);
      const duration = Date.now() - startMs;

      const step: RecordingStep = {
        step: {
          stepId: `error-${this.stepIndex}`,
          backend: this.config.backend,
          action: action.action,
          target: action.target,
          input: action.text ?? action.direction ?? null,
          result: { error: errorMsg },
          artifacts: [],
          startedAt: new Date().toISOString(),
          durationMs: duration,
        },
        originalSuggestion: action,
        userModified,
        skipped: false,
      };

      this.steps.push(step);
      this.stepIndex++;
      this.confirmedCount++;
      this.callbacks.onStepRecorded({ step, stepIndex: this.stepIndex - 1 });
      this.callbacks.onError({ message: errorMsg, recoverable: true });
    }
  }

  /**
   * Record a skipped step (user chose not to execute).
   */
  private async recordSkip(suggestion: SuggestedAction, reason?: string): Promise<void> {
    const step: RecordingStep = {
      step: null,
      originalSuggestion: suggestion,
      userModified: false,
      skipped: true,
      skipReason: reason ?? 'User skipped',
    };

    this.steps.push(step);
    this.stepIndex++;
    this.skippedCount++;
    this.callbacks.onStepRecorded({ step, stepIndex: this.stepIndex - 1 });
  }

  // ── Internal: Completion ────────────────────────────────────────

  /** Mark the recording as completed normally. */
  private complete(): void {
    this.stopRequested = true;
    this.completedAt = new Date().toISOString();
    this.state = 'completed';
    this.emitStateChange();
  }

  /** Handle an error during the recording loop. */
  private handleLoopError(error: unknown): void {
    const message = error instanceof Error ? error.message : String(error);
    this.callbacks.onError({ message, recoverable: false });
    this.cancelled = true;
    this.stopRequested = true;
    this.completedAt = new Date().toISOString();
    this.state = 'cancelled';
    this.emitStateChange();
  }

  /** Build the final RecordingResult. */
  private buildResult(): RecordingResult {
    return {
      sessionId: this.sessionId,
      featureName: this.config.featureName,
      backend: this.config.backend,
      device: {
        udid: this.config.deviceId,
        targetKind: this.config.targetKind,
      },
      app: {
        bundleId: this.config.bundleId,
      },
      endState: this.state as RecordingResult['endState'],
      steps: this.steps,
      startedAt: this.startedAt,
      completedAt: this.completedAt,
      confirmedCount: this.confirmedCount,
      skippedCount: this.skippedCount,
      cancelled: this.cancelled,
    };
  }

  // ── Internal: Utilities ─────────────────────────────────────────

  private emitStateChange(): void {
    this.callbacks.onStateChange({ state: this.state });
  }

  private generateSessionId(): string {
    const ts = Date.now().toString(36);
    const rand = Math.random().toString(36).slice(2, 8);
    return `rec-${ts}-${rand}`;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
