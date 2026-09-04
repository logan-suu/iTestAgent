import { createOpenAI } from '@ai-sdk/openai';
/**
 * Assertion suggester — LLM-generated tier-3 assertion suggestions (US-11.1
 * AC4 chain: exploration observations → suggestions → user confirmation).
 *
 * The LLM call is injected (`generate`) so the module is unit-testable and
 * provider-agnostic; the real implementation passes AI SDK generateText.
 * Parse failures NEVER fabricate suggestions (R5) — they return an empty
 * list with a reason.
 */
import { type LanguageModel, generateText } from 'ai';
import type { UserAssertion } from 'itestagent-contracts';
import { UserAssertionSchema } from 'itestagent-contracts';
import { redactUiTreeForModel } from '../context-builder.js';

export interface SuggestionContext {
  /** What the user wants to verify, in their words. */
  readonly goal: string;
  /** Raw UI tree XML captured after exploration. */
  readonly uiTree: string;
  /** Feature under test (optional, narrows suggestions). */
  readonly featureName?: string;
}

export interface SuggesterDeps {
  /** LLM completion function (e.g. AI SDK generateText on the configured model). */
  readonly generate: (prompt: string, signal?: AbortSignal) => Promise<string>;
}

export interface SuggestionResult {
  readonly suggestions: readonly UserAssertion[];
  readonly reason?: string;
}

const ALLOWED_CONDITION_TYPES = new Set(['element_visible', 'element_text', 'no_crash']);

function buildPrompt(ctx: SuggestionContext): string {
  const feature = ctx.featureName ? ` (feature: ${ctx.featureName})` : '';
  return [
    'You are a mobile test engineer. From the XCUITest UI tree below, propose 1-3',
    'assertions that verify the user goal. Respond with ONLY a JSON array, no prose.',
    'Schema per item: { "id": string, "caseId": string, "label": string,',
    '"source": "agent", "conditions": [{ "type": "element_visible" | "element_text" | "no_crash",',
    '"description": string, "target"?: string, "expected"?: string }],',
    '"evidence": string[] } — evidence entries MUST quote exact name/label strings',
    'found in the tree. Allowed condition types: element_visible, element_text, no_crash.',
    '',
    `User goal${feature}: ${ctx.goal}`,
    '',
    'UI tree:',
    redactUiTreeForModel(ctx.uiTree).slice(0, 8000),
  ].join('\n');
}

/**
 * Extracts the first complete JSON array from an LLM response (tolerates code
 * fences). Uses a quote-aware balanced-bracket scan so trailing bracketed
 * prose (e.g. "[1]", "[see notes]") cannot swallow a valid array the way a
 * naive lastIndexOf(']') would.
 */
export function extractJsonArray(text: string): unknown[] | null {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = (fenced?.[1] ?? text).trim();
  // Scan forward through candidate "[" positions: a non-JSON bracketed prefix
  // (e.g. "See [notes] before [...]) must not discard the valid array that
  // follows (CodeRabbit round 2).
  let start = candidate.indexOf('[');
  while (start !== -1) {
    let depth = 0;
    let inString = false;
    let escaped = false;
    let closed = false;
    for (let i = start; i < candidate.length; i++) {
      const ch = candidate[i] as string;
      if (inString) {
        if (escaped) {
          escaped = false;
        } else if (ch === '\\') {
          escaped = true;
        } else if (ch === '"') {
          inString = false;
        }
        continue;
      }
      if (ch === '"') {
        inString = true;
      } else if (ch === '[') {
        depth++;
      } else if (ch === ']') {
        depth--;
        if (depth === 0) {
          closed = true;
          try {
            const parsed = JSON.parse(candidate.slice(start, i + 1)) as unknown;
            if (Array.isArray(parsed)) return parsed;
          } catch {
            // Not JSON — advance to the next "[" candidate.
          }
          break;
        }
      }
    }
    if (!closed) break; // Unbalanced tail — nothing further can parse.
    start = candidate.indexOf('[', start + 1);
  }
  return null;
}

/**
 * Suggest tier-3 assertions from the captured UI tree.
 * Invalid entries are dropped individually (schema-safeParse); a completely
 * unparseable response returns an empty list with the reason (R5).
 */
export async function suggestAssertions(
  ctx: SuggestionContext,
  deps: SuggesterDeps,
  signal?: AbortSignal,
): Promise<SuggestionResult> {
  let response: string;
  try {
    response = await deps.generate(buildPrompt(ctx), signal);
  } catch (err) {
    return {
      suggestions: [],
      reason: `LLM call failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  const arr = extractJsonArray(response);
  if (arr === null) {
    return { suggestions: [], reason: 'LLM response contained no parseable JSON array' };
  }

  const suggestions: UserAssertion[] = [];
  const dropped: string[] = [];
  for (const [index, entry] of arr.entries()) {
    const parsed = UserAssertionSchema.safeParse({
      ...(entry as Record<string, unknown>),
      source: 'agent',
    });
    if (!parsed.success) {
      dropped.push(`#${index}`);
      continue;
    }
    const value = parsed.data;
    const conditionsOk = value.conditions.every((c) => ALLOWED_CONDITION_TYPES.has(c.type));
    if (!conditionsOk) {
      dropped.push(`#${index}`);
      continue;
    }
    suggestions.push(value);
  }

  if (suggestions.length === 0) {
    return {
      suggestions: [],
      reason: `all ${arr.length} suggestions invalid (${dropped.join(', ')})`,
    };
  }
  return dropped.length > 0
    ? { suggestions, reason: `dropped invalid: ${dropped.join(', ')}` }
    : { suggestions };
}

/** Real LLM provider — AI SDK generateText wrapped as the suggester's generate fn. */
export function createAiSdkGenerateFn(
  model: LanguageModel,
): (prompt: string, signal?: AbortSignal) => Promise<string> {
  return async (prompt: string, signal?: AbortSignal) => {
    const { text } = await generateText({ model, prompt, abortSignal: signal });
    return text;
  };
}

/** Model config from the three-layer configuration (US-18.2). */
export interface SuggesterModelConfig {
  /** OpenAI-compatible base URL (e.g. https://api.openai.com/v1). */
  baseUrl: string;
  /** API key — resolved from the keychain by the caller (R6: memory-only). */
  apiKey: string;
  /** Model identifier (e.g. gpt-4o-mini). */
  model: string;
}

/**
 * Config-driven provider factory: builds the generate fn from the merged
 * three-layer config (US-18.2). The API key stays in memory (R6) — callers
 * resolve it from the keychain via CredentialManager.
 */
export function createConfiguredGenerateFn(
  config: SuggesterModelConfig,
): (prompt: string, signal?: AbortSignal) => Promise<string> {
  assertProviderUrl(config.baseUrl);
  const openai = createOpenAI({ baseURL: config.baseUrl, apiKey: config.apiKey });
  return createAiSdkGenerateFn(openai(config.model));
}

/**
 * Refuse provider URLs that would carry the API key in cleartext (CWE-319):
 * https: anywhere, or http: on loopback only. @ai-sdk/openai does not
 * enforce this itself (verified for 4.0.17 — CodeRabbit round 3).
 */
export function assertProviderUrl(baseUrl: string): void {
  let parsed: URL;
  try {
    parsed = new URL(baseUrl);
  } catch {
    throw new Error(`Invalid provider URL: ${baseUrl}`);
  }
  if (parsed.protocol === 'https:') return;
  const host = parsed.hostname;
  const loopback = host === '127.0.0.1' || host === 'localhost' || host === '::1';
  if (parsed.protocol === 'http:' && loopback) return;
  throw new Error(
    `Refusing to send the API key over non-HTTPS: ${baseUrl} (use https: or a loopback http: URL)`,
  );
}
