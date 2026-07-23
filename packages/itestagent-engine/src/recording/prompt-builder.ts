/**
 * RecordingPromptBuilder — builds the LLM system prompt for interactive recording.
 *
 * Task 3.13: Interactive Recording — Agent suggests next step + user confirms/corrects.
 * US-8.2 AC1: Agent analyzes UI tree and suggests the next single action.
 *
 * The output prompt is fed to AgentRuntime.streamTurn() as the system prompt.
 * The Agent responds with a JSON suggestion that the InteractiveRecorder parses
 * and presents to the user for confirmation.
 *
 * Usage:
 *   const builder = new RecordingPromptBuilder();
 *   const prompt = builder.buildSuggestionPrompt({
 *     featureName: 'login',
 *     uiTree: '...',
 *     historySteps: [{ action: 'tap', target: 'Login button', status: 'done' }],
 *   });
 */

// ─── Types ─────────────────────────────────────────────────

/** A summary of a previously executed recording step. */
export interface HistoryStepSummary {
  /** Action type (tap, swipe, input, etc.) */
  action: string;
  /** Human-readable description of the target */
  target: string;
  /** Execution status (done, failed, skipped) */
  status: string;
}

/** Input context for building a recording suggestion prompt. */
export interface RecordingPromptContext {
  /** The feature or flow being recorded (e.g. "login", "checkout") */
  featureName: string;
  /** The current accessibility/AX tree of the app screen */
  uiTree: string;
  /** Summary of previously recorded steps */
  historySteps: HistoryStepSummary[];
  /** Optional project profile information for context */
  projectContext?: string;
  /** Optional user-provided guidance or hints */
  additionalHints?: string;
}

// ─── Constants ─────────────────────────────────────────────

/** Maximum characters of the UI tree to include in the prompt. */
const DEFAULT_MAX_UI_TREE_CHARS = 8000;

/** Available action types the Agent can suggest. */
const VALID_ACTIONS = ['tap', 'swipe', 'input', 'screenshot', 'wait', 'launch'] as const;

// ─── RecordingPromptBuilder ─────────────────────────────────

/**
 * Builds the LLM system prompt for interactive recording step suggestions.
 *
 * The prompt instructs the Agent to analyze the current UI tree and the
 * feature being recorded, then suggest the next single action to take.
 * The response format is a JSON object compatible with {@link SuggestedAction}.
 *
 * Design:
 *   - No external dependencies — pure string template building.
 *   - No AI SDK imports — the output is plain text consumed by AgentRuntime.
 *   - No markdown code fences in the prompt to avoid JSON parsing confusion.
 *   - UI tree is truncated to prevent context window overflow.
 *
 * @see RecordingPromptContext for input fields
 * @see SuggestedAction for the expected JSON response shape
 */
export class RecordingPromptBuilder {
  private readonly maxUiTreeChars: number;

  constructor(options?: { maxUiTreeChars?: number }) {
    this.maxUiTreeChars = options?.maxUiTreeChars ?? DEFAULT_MAX_UI_TREE_CHARS;
  }

  /**
   * Build the system prompt for suggesting the next recording step.
   *
   * The prompt contains five sections:
   *   1. ROLE — establishes the Agent's identity as an iOS test recording assistant.
   *   2. CURRENT UI — the current screen's accessibility tree.
   *   3. FEATURE — the feature being recorded.
   *   4. HISTORY — summary of previous steps already recorded.
   *   5. TASK — instructs the Agent to suggest the next single action.
   *
   * @param context - The recording context (feature name, UI tree, history, etc.).
   * @returns A formatted system prompt string ready for AgentRuntime.streamTurn().
   */
  buildSuggestionPrompt(context: RecordingPromptContext): string {
    const sections: string[] = [
      this.buildRoleSection(),
      this.buildUiTreeSection(context.uiTree),
      this.buildFeatureSection(context.featureName),
      this.buildHistorySection(context.historySteps),
      this.buildContextSection(context.projectContext, context.additionalHints),
      this.buildTaskSection(),
    ];

    return sections.join('\n');
  }

  // ─── Private: Section Builders ───────────────────────────

  /**
   * Build the ROLE section establishing Agent identity and constraints.
   */
  private buildRoleSection(): string {
    return [
      'You are an iOS test recording assistant.',
      'Your job is to analyze the current screen of an iOS app and suggest',
      'the next single action that a tester should perform to exercise the',
      'feature being recorded.',
      '',
      'You do NOT execute actions — you only suggest them.',
      'Your suggestions should be practical, follow typical user flows,',
      'and avoid destructive actions (delete, logout, clear data, uninstall)',
      'unless explicitly part of the feature being recorded.',
      '',
      'Always prefer interacting with visible, tappable UI elements.',
      'If the screen shows a loading state, suggest waiting.',
      'If the screen shows an error or unexpected state, suggest',
      'navigating back to a known state before continuing.',
    ].join('\n');
  }

  /**
   * Build the CURRENT UI section with the truncated accessibility tree.
   */
  private buildUiTreeSection(uiTree: string): string {
    const truncated = this.truncateUiTree(uiTree);

    return [
      '',
      '---',
      '',
      '## CURRENT UI',
      '',
      'Below is the accessibility tree of the current screen.',
      'Each line represents a visible UI element with its role, label, and position.',
      '',
      truncated,
    ].join('\n');
  }

  /**
   * Build the FEATURE section describing what is being recorded.
   */
  private buildFeatureSection(featureName: string): string {
    return [
      '',
      '---',
      '',
      '## FEATURE',
      '',
      `You are recording the feature: "${featureName}".`,
      'Each step you suggest should move the user closer to completing',
      'or exercising this feature end-to-end.',
      'If the feature appears to be complete (e.g., the user reached the',
      'expected final screen), suggest the "screenshot" action to capture',
      'the final state before finishing.',
    ].join('\n');
  }

  /**
   * Build the HISTORY section summarizing previously recorded steps.
   */
  private buildHistorySection(historySteps: HistoryStepSummary[]): string {
    const lines: string[] = ['', '---', '', '## HISTORY', ''];

    if (historySteps.length === 0) {
      lines.push('No steps have been recorded yet. This is the first action.');
      lines.push('Start from the initial screen of the feature.');
    } else {
      lines.push('The following steps have already been recorded:');
      lines.push('');

      historySteps.forEach((step, i) => {
        const statusIcon =
          step.status === 'done'
            ? '✓'
            : step.status === 'failed'
              ? '✗'
              : step.status === 'skipped'
                ? '⊘'
                : '?';
        lines.push(`  ${i + 1}. [${statusIcon}] ${step.action}: ${step.target}`);
      });

      lines.push('');
      lines.push('Suggest the action that logically follows these steps.');
    }

    return lines.join('\n');
  }

  /**
   * Build an optional CONTEXT section with project info and user hints.
   */
  private buildContextSection(projectContext?: string, additionalHints?: string): string {
    const parts: string[] = [];

    if (projectContext && projectContext.trim().length > 0) {
      parts.push('## PROJECT CONTEXT', '', projectContext, '');
    }

    if (additionalHints && additionalHints.trim().length > 0) {
      parts.push('## USER HINTS', '', additionalHints, '');
    }

    if (parts.length === 0) {
      return '';
    }

    return ['', '---', '', ...parts].join('\n');
  }

  /**
   * Build the TASK section with JSON output format instructions.
   *
   * The format description avoids markdown code fences (```json ... ```)
   * because the LLM might echo those fences in its response, breaking
   * JSON parsing downstream. Instead, the structure is described inline.
   */
  private buildTaskSection(): string {
    const actionList = VALID_ACTIONS.map((a) => `"${a}"`).join(', ');

    return [
      '',
      '---',
      '',
      '## TASK',
      '',
      'Based on the current UI, the feature being recorded, and the history',
      'of steps already taken, suggest the NEXT single action to perform.',
      '',
      'Consider:',
      '- What would a real user do next to progress through this feature?',
      '- Is there a button that needs to be tapped, a field that needs input,',
      '  or a screen that needs to be scrolled?',
      '- Is the feature complete? If so, suggest a screenshot to capture the',
      '  final state.',
      '- Avoid repeating actions that have already been recorded.',
      '- If stuck or unsure, prefer waiting over guessing.',
      '',
      'Respond with a JSON object (no markdown fences, no surrounding text)',
      'with these fields:',
      '',
      `  "action": one of ${actionList}`,
      '  "target": human-readable description of the element or goal',
      '  "reasoning": brief explanation of why this step makes sense now',
      '  "confidence": a number between 0 and 1',
      '',
      'Optional fields (include only when relevant to the action type):',
      '',
      '  "text": the text to type (only for "input" action)',
      '  "direction": "up" / "down" / "left" / "right" (only for "swipe" action)',
      '  "waitMs": milliseconds to wait (only for "wait" action)',
      '  "bundleId": the app bundle ID to launch (only for "launch" action)',
      '',
      'Example of a response for tapping a login button:',
      '',
      '{"action":"tap","target":"Login button in the center of the screen","reasoning":"The username and password fields appear to be filled; tapping Login should submit the form and advance the feature.","confidence":0.9}',
      '',
      'Example of a response for typing into a field:',
      '',
      '{"action":"input","target":"Username text field at the top of the form","reasoning":"The login form is visible and the username field is empty; entering the username is the first step.","confidence":0.95,"text":"testuser@example.com"}',
    ].join('\n');
  }

  // ─── Private: UI Tree Truncation ──────────────────────────

  /**
   * Truncate the UI tree string if it exceeds the configured character limit.
   *
   * When truncating, preserves the top portion of the tree (which typically
   * contains the most important structural elements) and appends a truncation
   * notice with the number of omitted characters.
   *
   * @param uiTree - The full accessibility tree string.
   * @returns The original or truncated tree string.
   */
  private truncateUiTree(uiTree: string): string {
    if (uiTree.length <= this.maxUiTreeChars) {
      return uiTree;
    }

    const cutoff = this.maxUiTreeChars;
    const notice = `\n\n... [${uiTree.length - cutoff} characters omitted from UI tree] ...`;

    return uiTree.slice(0, cutoff) + notice;
  }
}
