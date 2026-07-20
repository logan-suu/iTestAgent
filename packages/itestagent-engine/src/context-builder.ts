import type { AgentTurnInput, Intent, RunState, RunStep, TestPlan } from 'itestagent-contracts';
import type { ProjectProfile } from 'itestagent-project-analyzer';

// ─── Types ─────────────────────────────────────────────────

/** Input for building the system prompt (ADR-010 §7). */
export interface BuildContextInput {
  projectProfile: ProjectProfile;
  intent?: Intent;
  testPlan?: TestPlan;
  runState: RunState;
  previousSteps?: RunStep[];
}

/** Options for ContextBuilder construction. */
export interface ContextBuilderOptions {
  /**
   * Maximum characters before evidence is truncated.
   * Default: 4096.
   */
  maxEvidenceChars?: number;
  /**
   * Custom patterns to detect secrets in text.
   * Default patterns cover API keys, tokens, passwords, credentials.
   */
  secretPatterns?: RegExp[];
  /**
   * Replacement string substituted for matched secrets.
   * Default: '[REDACTED]'.
   */
  secretPlaceholder?: string;
}

// ─── Constants ─────────────────────────────────────────────

const DEFAULT_MAX_EVIDENCE_CHARS = 4096;
const DEFAULT_SECRET_PLACEHOLDER = '[REDACTED]';

/**
 * Default patterns matching common secret formats.
 *
 * Matches:
 *   - `sk-...` (OpenAI-style keys)
 *   - `Bearer eyJ...` (JWTs)
 *   - `token=` / `token:` style
 *   - `password=` / `password:` / `secret=` / `apikey=` / `credential=` style
 *   - `x-api-key:` / `authorization:` headers
 */
const DEFAULT_SECRET_PATTERNS: RegExp[] = [
  /\bsk-[a-zA-Z0-9_-]{20,}\b/g,
  /\bBearer\s+[a-zA-Z0-9._\-=+/]{20,}\b/gi,
  /\b(?:token|password|secret|api[_-]?key|credential)\s*[=:]\s*["']?[^\s"']{8,}["']?/gi,
  /\b(?:x-api-key|authorization)\s*:\s*["']?[^\s"']{8,}["']?/gi,
];

// ─── ContextBuilder ────────────────────────────────────────

/**
 * ContextBuilder — assembles sanitized LLM context from project + run state.
 *
 * Implements ADR-010 §7 ContextBuilder:
 *   - Input: ProjectProfile / Intent / TestPlan / Run state
 *   - Output: sanitized system prompt + AgentTurnInput
 *   - Secret plaintext MUST NOT enter model context (R6)
 *   - Oversized raw evidence MUST be truncated (ADR-010 §7)
 *
 * Usage:
 *   const cb = new ContextBuilder();
 *   const systemPrompt = cb.buildSystemPrompt(input);
 *   const turn = cb.buildTurn(input);
 *
 * @see ADR-010-agent-harness-runtime-boundary.md §7
 * @see AGENTS.md R6 — sensitive data never in logs/reports/commit
 */
export class ContextBuilder {
  private readonly maxEvidenceChars: number;
  private readonly secretPatterns: RegExp[];
  private readonly secretPlaceholder: string;

  constructor(options?: ContextBuilderOptions) {
    this.maxEvidenceChars = options?.maxEvidenceChars ?? DEFAULT_MAX_EVIDENCE_CHARS;
    this.secretPlaceholder = options?.secretPlaceholder ?? DEFAULT_SECRET_PLACEHOLDER;
    this.secretPatterns = [...DEFAULT_SECRET_PATTERNS, ...(options?.secretPatterns ?? [])];
  }

  // ─── System Prompt Assembly ──────────────────────────────

  /**
   * Build a sanitized system prompt from project context and run state.
   *
   * The prompt is structured as markdown with these sections:
   *   1. Project Profile (app, targets, features, test assets)
   *   2. Intent (user goal, scope, target hints)
   *   3. Test Plan (device, execution strategy, assertions)
   *   4. Run State (current state, previous step count)
   *
   * All text embedded in the prompt passes through sanitizeText()
   * to prevent secrets from leaking into model context.
   */
  buildSystemPrompt(input: BuildContextInput): string {
    const sections: string[] = [
      '# iTestAgent — Test Execution Context',
      '',
      this.buildProfileSection(input.projectProfile),
      this.buildIntentSection(input.intent),
      this.buildTestPlanSection(input.testPlan),
      this.buildRunStateSection(input.runState, input.previousSteps),
    ];

    const raw = sections.join('\n');
    return this.sanitizeText(raw);
  }

  // ─── Secret Sanitization ─────────────────────────────────

  /**
   * Sanitize text by replacing secret patterns with a placeholder.
   *
   * Applies all configured secretPatterns and substitutes matches
   * with the configured placeholder (default: '[REDACTED]').
   *
   * This method is idempotent — running it twice on already-sanitized
   * text produces the same result.
   *
   * @see ADR-010 §7 — secret plaintext MUST NOT enter model context
   * @see AGENTS.md R6
   */
  sanitizeText(text: string): string {
    let result = text;
    for (const pattern of this.secretPatterns) {
      result = result.replace(pattern, this.secretPlaceholder);
    }
    return result;
  }

  // ─── Evidence Truncation ─────────────────────────────────

  /**
   * Truncate oversized evidence text to a safe maximum length.
   *
   * When text exceeds maxLength, preserves the first half and second half
   * of the content, inserting a truncation notice in the middle.
   *
   * This prevents large raw evidence (e.g., screenshots encoded as base64,
   * full UITree dumps) from consuming the model's context window.
   *
   * @param text - The evidence text to potentially truncate.
   * @param maxLength - Maximum characters. Defaults to the instance's maxEvidenceChars.
   * @returns The original text if within limits, or a truncated version.
   *
   * @see ADR-010 §7 — large raw evidence MUST be truncated
   */
  truncateEvidence(text: string, maxLength?: number): string {
    const limit = maxLength ?? this.maxEvidenceChars;

    if (text.length <= limit) {
      return text;
    }

    const half = Math.floor(limit / 2);
    const head = text.slice(0, half);
    const tail = text.slice(text.length - half);
    const truncated = text.length - head.length - tail.length;
    const notice = `\n\n... [${truncated} characters truncated] ...\n\n`;

    return head + notice + tail;
  }

  // ─── Turn Assembly ───────────────────────────────────────

  /**
   * Build a complete AgentTurnInput with system prompt and optional user messages.
   *
   * @param input - The build context (profile, intent, plan, state).
   * @param userMessages - Previous conversation messages to append after system prompt.
   * @returns AgentTurnInput suitable for AgentRuntime.streamTurn().
   *
   * @see ADR-010 §4 AgentRuntime interface
   */
  buildTurn(input: BuildContextInput, userMessages?: unknown[]): AgentTurnInput {
    const systemPrompt = this.buildSystemPrompt(input);
    const messages: unknown[] = [{ role: 'system', content: systemPrompt }];

    if (userMessages && userMessages.length > 0) {
      messages.push(...userMessages.map((m) => this.sanitizeMessage(m)));
    }

    return { messages };
  }

  // ─── Private: Helpers ────────────────────────────────────

  /**
   * Sanitize a message object's content field if it contains a string.
   * Preserves message structure and fields while redacting secrets.
   */
  private sanitizeMessage(message: unknown): unknown {
    if (
      typeof message === 'object' &&
      message !== null &&
      'content' in message &&
      typeof (message as { content: unknown }).content === 'string'
    ) {
      return {
        ...(message as Record<string, unknown>),
        content: this.sanitizeText((message as { content: string }).content),
      };
    }
    return message;
  }

  // ─── Private: Section Builders ───────────────────────────

  private buildProfileSection(profile: ProjectProfile): string {
    const lines: string[] = ['## Project Profile', ''];

    // App identity
    const app = profile.app;
    const appDesc: string[] = [];
    if (app.name) appDesc.push(app.name);
    if (app.bundleId) appDesc.push(`(${app.bundleId})`);
    if (appDesc.length > 0) {
      lines.push(`- **App**: ${appDesc.join(' ')}`);
    }
    if (app.scheme) lines.push(`- **Scheme**: ${app.scheme}`);
    if (app.workspace) lines.push(`- **Workspace**: ${app.workspace}`);

    // Targets
    if (profile.targets.length > 0) {
      const targetList = profile.targets.map((t) => `\`${t.name}\` (${t.type})`).join(', ');
      lines.push(`- **Targets** (${profile.targets.length}): ${targetList}`);
    }

    // Test assets
    const ta = profile.testAssets;
    lines.push(`- **XCUITest Available**: ${ta.hasXCUITest ? 'Yes' : 'No'}`);
    if (ta.testTargets && ta.testTargets.length > 0) {
      lines.push(`- **Test Targets**: ${ta.testTargets.join(', ')}`);
    }

    // Confirmed features
    const confirmedFeatures = profile.features.filter((f) => f.confirmed);
    if (confirmedFeatures.length > 0) {
      lines.push('- **Confirmed Features**:');
      for (const f of confirmedFeatures) {
        lines.push(`  - ${f.name} (confidence: ${(f.confidence * 100).toFixed(0)}%)`);
      }
    }

    // Suggested smoke
    if (profile.suggestedSmoke.length > 0) {
      lines.push(`- **Suggested Smoke**: ${profile.suggestedSmoke.join(', ')}`);
    }

    lines.push('');
    return lines.join('\n');
  }

  private buildIntentSection(intent?: Intent): string {
    const lines: string[] = ['## Intent', ''];

    if (!intent) {
      lines.push('_No explicit intent provided._');
      lines.push('');
      return lines.join('\n');
    }

    lines.push(`- **Goal**: ${intent.goal}`);
    lines.push(`- **Scope**: ${intent.scope}`);
    if (intent.targetKind) {
      lines.push(`- **Target Kind**: ${intent.targetKind}`);
    }
    if (intent.deviceHint) {
      lines.push(`- **Device Hint**: ${intent.deviceHint}`);
    }
    if (intent.targetHint) {
      lines.push(`- **Target Hint**: ${intent.targetHint}`);
    }
    if (intent.features.length > 0) {
      lines.push(`- **Requested Features**: ${intent.features.join(', ')}`);
    }
    lines.push(`- **Metrics Requested**: ${intent.metricsRequested ? 'Yes' : 'No'}`);
    lines.push('');
    return lines.join('\n');
  }

  private buildTestPlanSection(testPlan?: TestPlan): string {
    const lines: string[] = ['## Test Plan', ''];

    if (!testPlan) {
      lines.push('_No test plan compiled yet._');
      lines.push('');
      return lines.join('\n');
    }

    // Device
    lines.push(`- **Target Kind**: ${testPlan.device.kind}`);
    lines.push(
      `- **Execution Mode**: ${testPlan.execution.prefer} (fallback: ${testPlan.execution.fallback})`,
    );

    // Features
    if (testPlan.execution.features.length > 0) {
      lines.push(`- **Execution Features**: ${testPlan.execution.features.join(', ')}`);
    }

    // Backend preference
    const bp = testPlan.backendPreference;
    if (bp.device && bp.device.length > 0) {
      lines.push(`- **Device Backend**: ${bp.device.join(' > ')}`);
    }

    // Assertion
    lines.push(`- **Assertion Policy**: ${testPlan.execution.assertion.policy}`);

    // Metrics
    if (testPlan.execution.metrics && testPlan.execution.metrics.length > 0) {
      lines.push(`- **Metrics to Collect**: ${testPlan.execution.metrics.join(', ')}`);
    }

    // Artifacts
    if (testPlan.artifacts.collect.length > 0) {
      lines.push(`- **Artifacts to Collect**: ${testPlan.artifacts.collect.join(', ')}`);
    }

    // Safety
    lines.push(`- **Permission Default**: ${testPlan.safety.defaultMode}`);

    lines.push('');
    return lines.join('\n');
  }

  private buildRunStateSection(state: RunState, previousSteps?: RunStep[]): string {
    const lines: string[] = ['## Run State', ''];

    lines.push(`- **Current State**: \`${state}\``);

    if (previousSteps && previousSteps.length > 0) {
      lines.push(`- **Previous Steps** (${previousSteps.length}):`);
      for (const step of previousSteps) {
        const gate = step.safetyGate ? ` [${step.safetyGate}]` : '';
        const duration = `${step.durationMs}ms`;
        lines.push(
          `  - \`${step.action}\` (${step.stepId}) on \`${step.backend}\` (${duration})${gate}`,
        );
      }
    } else {
      lines.push('- **Previous Steps**: _none_');
    }

    lines.push('');
    return lines.join('\n');
  }
}
