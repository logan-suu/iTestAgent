import { createOpenAI } from '@ai-sdk/openai';
import { generateText } from 'ai';
import { assertProviderUrl, redactValue } from 'itestagent-engine';

export interface ProviderValidationInput {
  readonly baseURL: string;
  readonly model: string;
  readonly apiKey: string;
}

export type ProviderValidationErrorCode =
  | 'authentication_failed'
  | 'insufficient_balance'
  | 'model_unavailable'
  | 'rate_limited'
  | 'provider_unavailable'
  | 'network_error';

export type ProviderValidationResult =
  | { readonly ok: true }
  | {
      readonly ok: false;
      readonly error: {
        readonly code: ProviderValidationErrorCode;
        readonly message: string;
      };
    };

export interface ProviderValidationDependencies {
  readonly probe?: (input: ProviderValidationInput) => Promise<void>;
}

export const DEFAULT_PROVIDER_BASE_URL = 'https://api.deepseek.com';
export const DEFAULT_PROVIDER_MODEL = 'deepseek-v4-flash';

export interface ProviderValidationTransition {
  readonly setupStep: 0 | 1 | 2 | 3;
  readonly error: string;
  readonly providerValidated: boolean;
  readonly clearSessionApiKey: boolean;
}

const MASKED_CREDENTIAL_PATTERNS = [
  /(?:your\s+)?api\s*key\s*:\s*\*+[a-z0-9_-]*/gi,
  /\*{3,}[a-z0-9_-]{2,}/gi,
];

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : null;
}

function statusCodeOf(error: unknown, depth = 0): number | undefined {
  if (depth > 3) return undefined;
  const value = record(error);
  if (!value) return undefined;
  if (typeof value.statusCode === 'number') return value.statusCode;
  if (typeof value.status === 'number') return value.status;
  const response = record(value.response);
  if (response && typeof response.status === 'number') return response.status;
  return statusCodeOf(value.cause, depth + 1);
}

function messageOf(error: unknown, depth = 0): string {
  if (depth > 3) return '';
  if (error instanceof Error) {
    return `${error.message} ${messageOf(error.cause, depth + 1)}`.trim();
  }
  const value = record(error);
  if (value && typeof value.message === 'string') {
    return `${value.message} ${messageOf(value.cause, depth + 1)}`.trim();
  }
  return typeof error === 'string' ? error : '';
}

export function classifyProviderValidationError(error: unknown): ProviderValidationResult {
  const status = statusCodeOf(error);
  const message = messageOf(error).toLowerCase();

  if (
    status === 401 ||
    /authentication\s+fails?|invalid\s+(?:api\s*)?key|incorrect\s+(?:api\s*)?key|unauthorized/.test(
      message,
    )
  ) {
    return {
      ok: false,
      error: {
        code: 'authentication_failed',
        message:
          'Provider authentication failed. Re-enter an API key issued for the configured endpoint.',
      },
    };
  }
  if (status === 402 || /insufficient\s+(?:balance|quota)|payment\s+required/.test(message)) {
    return {
      ok: false,
      error: {
        code: 'insufficient_balance',
        message: 'Provider authentication succeeded, but the account has insufficient balance.',
      },
    };
  }
  if (
    status === 404 ||
    status === 422 ||
    /model.*(?:not\s+found|does\s+not\s+exist|unavailable|invalid)/.test(message)
  ) {
    return {
      ok: false,
      error: {
        code: 'model_unavailable',
        message:
          'The configured model is unavailable for this provider. Enter a supported model name.',
      },
    };
  }
  if (status === 429 || /rate\s*limit|too\s+many\s+requests/.test(message)) {
    return {
      ok: false,
      error: {
        code: 'rate_limited',
        message: 'The provider rate limit prevented validation. Wait briefly and retry.',
      },
    };
  }
  if ((status !== undefined && status >= 500) || /server\s+(?:error|overloaded)/.test(message)) {
    return {
      ok: false,
      error: {
        code: 'provider_unavailable',
        message: 'The provider is temporarily unavailable. Retry without changing the credential.',
      },
    };
  }
  return {
    ok: false,
    error: {
      code: 'network_error',
      message:
        'Provider validation could not reach the configured endpoint. Check the URL and network.',
    },
  };
}

async function runProviderProbe(input: ProviderValidationInput): Promise<void> {
  const provider = createOpenAI({ baseURL: input.baseURL, apiKey: input.apiKey });
  await generateText({
    model: provider.chat(input.model),
    prompt: 'Reply with OK.',
    maxOutputTokens: 1,
    abortSignal: AbortSignal.timeout(20_000),
  });
}

/** Validate endpoint, credential, and model before setup is allowed to complete. */
export async function validateProviderAccess(
  input: ProviderValidationInput,
  dependencies: ProviderValidationDependencies = {},
): Promise<ProviderValidationResult> {
  try {
    assertProviderUrl(input.baseURL);
    await (dependencies.probe ?? runProviderProbe)(input);
    return { ok: true };
  } catch (error: unknown) {
    return classifyProviderValidationError(error);
  }
}

export function resolveProviderValidationTransition(
  result: ProviderValidationResult,
): ProviderValidationTransition {
  if (result.ok) {
    return {
      setupStep: 3,
      error: '',
      providerValidated: true,
      clearSessionApiKey: false,
    };
  }
  if (result.error.code === 'authentication_failed') {
    return {
      setupStep: 1,
      error: result.error.message,
      providerValidated: false,
      clearSessionApiKey: true,
    };
  }
  if (result.error.code === 'network_error') {
    return {
      setupStep: 0,
      error: result.error.message,
      providerValidated: false,
      clearSessionApiKey: true,
    };
  }
  return {
    setupStep: 2,
    error: result.error.message,
    providerValidated: false,
    clearSessionApiKey: false,
  };
}

/** Remove provider-supplied credential fragments from errors shown by the TUI. */
export function sanitizeProviderErrorMessage(message: string): string {
  const classified = classifyProviderValidationError(new Error(message));
  if (!classified.ok && classified.error.code === 'authentication_failed') {
    return classified.error.message;
  }
  return redactValue(message, MASKED_CREDENTIAL_PATTERNS);
}
