import { describe, expect, it } from 'bun:test';
import {
  DEFAULT_PROVIDER_BASE_URL,
  DEFAULT_PROVIDER_MODEL,
  classifyProviderValidationError,
  resolveProviderValidationTransition,
  sanitizeProviderErrorMessage,
  validateProviderAccess,
} from '../src/provider-validation.js';

const fakeCredential = ['not', 'a', 'real', 'credential'].join('-');

describe('provider validation', () => {
  it('uses the current documented DeepSeek endpoint and model as defaults', () => {
    expect(DEFAULT_PROVIDER_BASE_URL).toBe('https://api.deepseek.com');
    expect(DEFAULT_PROVIDER_MODEL).toBe('deepseek-v4-flash');
  });

  it('probes the exact endpoint, model, and memory-only credential', async () => {
    let observed: unknown;
    const result = await validateProviderAccess(
      {
        baseURL: 'https://provider.example/v1',
        model: 'model-1',
        apiKey: fakeCredential,
      },
      {
        probe: async (input) => {
          observed = input;
        },
      },
    );

    expect(result).toEqual({ ok: true });
    expect(observed).toEqual({
      baseURL: 'https://provider.example/v1',
      model: 'model-1',
      apiKey: fakeCredential,
    });
  });

  it('classifies HTTP 401 without returning provider credential fragments', async () => {
    const result = await validateProviderAccess(
      {
        baseURL: 'https://provider.example/v1',
        model: 'model-1',
        apiKey: fakeCredential,
      },
      {
        probe: async () => {
          throw Object.assign(
            new Error('Authentication Fails, Your api key: ****1234 is invalid'),
            {
              statusCode: 401,
            },
          );
        },
      },
    );

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('Expected provider validation to fail');
    expect(result.error.code).toBe('authentication_failed');
    expect(result.error.message).not.toContain('1234');
    expect(result.error.message).not.toContain(fakeCredential);
    expect(result.error.message).toContain('Re-enter');
  });

  it('distinguishes balance, model, rate-limit, provider, and network failures', () => {
    const cases = [
      [Object.assign(new Error('payment required'), { statusCode: 402 }), 'insufficient_balance'],
      [Object.assign(new Error('model not found'), { statusCode: 404 }), 'model_unavailable'],
      [Object.assign(new Error('too many requests'), { statusCode: 429 }), 'rate_limited'],
      [Object.assign(new Error('server overloaded'), { statusCode: 503 }), 'provider_unavailable'],
      [new Error('socket unavailable'), 'network_error'],
    ] as const;

    for (const [error, code] of cases) {
      const result = classifyProviderValidationError(error);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.code).toBe(code);
    }
  });

  it('finds status codes nested in provider error causes', () => {
    const result = classifyProviderValidationError(
      new Error('request failed', {
        cause: Object.assign(new Error('unauthorized'), { status: 401 }),
      }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('authentication_failed');
  });
});

describe('provider validation setup transition', () => {
  it('advances only a validated provider to credential storage', () => {
    expect(resolveProviderValidationTransition({ ok: true })).toEqual({
      setupStep: 3,
      error: '',
      providerValidated: true,
      clearSessionApiKey: false,
    });
  });

  it('clears a rejected credential and returns to hidden API-key input', () => {
    const transition = resolveProviderValidationTransition(
      classifyProviderValidationError(Object.assign(new Error('unauthorized'), { status: 401 })),
    );
    expect(transition).toMatchObject({
      setupStep: 1,
      providerValidated: false,
      clearSessionApiKey: true,
    });
    expect(transition.error).not.toContain('401');
  });

  it('keeps an authenticated credential in memory while the user corrects the model', () => {
    const transition = resolveProviderValidationTransition(
      classifyProviderValidationError(Object.assign(new Error('model not found'), { status: 404 })),
    );
    expect(transition).toMatchObject({
      setupStep: 2,
      providerValidated: false,
      clearSessionApiKey: false,
    });
  });
});

describe('provider error sanitization', () => {
  it('replaces a provider authentication response with an actionable safe message', () => {
    const output = sanitizeProviderErrorMessage(
      'Authentication Fails, Your api key: ****1234 is invalid',
    );
    expect(output).toBe(
      'Provider authentication failed. Re-enter an API key issued for the configured endpoint.',
    );
    expect(output).not.toContain('1234');
  });

  it('removes masked credential fragments from other provider errors', () => {
    const output = sanitizeProviderErrorMessage('Provider rejected api key: ****5678 temporarily');
    expect(output).not.toContain('5678');
    expect(output).toContain('[REDACTED]');
  });
});
