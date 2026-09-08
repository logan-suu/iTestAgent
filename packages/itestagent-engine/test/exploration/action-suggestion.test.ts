import { describe, expect, it } from 'bun:test';
import type { RunStep, UserAssertion } from 'itestagent-contracts';
import { z } from 'zod';
import {
  ActionSuggestionFormatError,
  type ActionSuggestionOptions,
  ActionSuggestionSchema,
  suggestExplorationAction,
} from '../../src/exploration/action-suggestion.js';
import type { ExplorationAction } from '../../src/exploration/types.js';

function options(
  generate: ActionSuggestionOptions['generate'],
  overrides: Partial<ActionSuggestionOptions> = {},
): ActionSuggestionOptions {
  return {
    generate,
    caseId: 'Validation',
    goal: 'Tap the observed button, then confirm Count: 1 is visible.',
    uiTree: '<App><Button name="tap_button" label="Tap Me"/></App>',
    history: [],
    ...overrides,
  };
}

describe('action suggestion contract', () => {
  const valid: [string, ExplorationAction | 'done'][] = [
    ['{"action":"tap","target":"tap_button"}', { action: 'tap', target: 'tap_button' }],
    [
      '{"action":"input","target":"name_field","text":"Test"}',
      { action: 'input', target: 'name_field', text: 'Test' },
    ],
    [
      '{"action":"swipe","direction":"up"}',
      { action: 'swipe', target: 'swipe_up', direction: 'up' },
    ],
    ['{"action":"swipe"}', { action: 'swipe', target: 'swipe_down' }],
    ['{"action":"screenshot"}', { action: 'screenshot', target: 'screenshot' }],
    ['{"action":"wait"}', { action: 'wait', target: 'wait_1000ms' }],
    ['{"action":"wait","waitMs":250.9}', { action: 'wait', target: 'wait_250ms', waitMs: 250 }],
    ['{"action":"wait","waitMs":-1}', { action: 'wait', target: 'wait_1ms', waitMs: 1 }],
    [
      '{"action":"wait","target":"settle","waitMs":20}',
      { action: 'wait', target: 'settle', waitMs: 20 },
    ],
    ['{"action":"done"}', 'done'],
    [
      '```json\n{"action":"tap","target":"tap_button"}\n```',
      { action: 'tap', target: 'tap_button' },
    ],
    ['```\n{"action":"done"}\n```', 'done'],
    [
      ' {"action":"tap","accessibilityId":" tap_button "} ',
      { action: 'tap', target: 'tap_button' },
    ],
    ['{"action":"tap","label":"Tap Me"}', { action: 'tap', target: 'Tap Me' }],
    [
      '{"action":"tap","target":" Tap Me ","accessibilityId":"Tap Me","label":"Tap Me"}',
      { action: 'tap', target: 'Tap Me' },
    ],
  ];

  for (const [response, expected] of valid) {
    it(`accepts the explicit contract: ${response}`, async () => {
      let calls = 0;
      const result = await suggestExplorationAction(
        options(async () => {
          calls += 1;
          return response;
        }),
      );
      expect(result).toEqual(expected);
      expect(calls).toBe(1);
    });
  }

  it('generates the model schema from the runtime contract and includes explicit examples', async () => {
    let prompt = '';
    await suggestExplorationAction(
      options(async (value) => {
        prompt = value;
        return '{"action":"done"}';
      }),
    );
    expect(prompt).toContain(JSON.stringify(z.toJSONSchema(ActionSuggestionSchema)));
    expect(prompt).toContain('target MUST be a non-empty top-level string');
    expect(prompt).toContain('Do not use a nested target object');
    expect(prompt).toContain('{"action":"tap","target":"observed_button_id"}');
    expect(prompt).toContain('GOAL: Tap the observed button');
  });

  const invalid = [
    ['{"action":"tap"}', 'target_required'],
    ['{"action":"input","text":"Test"}', 'target_required'],
    ['{"action":"tap","target":{ "label":"Tap Me" }}', 'target_type'],
    ['{"action":"tap","arguments":{ "target":"Tap Me" }}', 'target_required'],
    ['{"action":"tap","target":"Tap Me","arguments":{}}', 'invalid_fields'],
    ['{"action":"tap","target":null}', 'target_type'],
    ['{"action":"tap","target":123}', 'target_type'],
    ['{"action":"tap","target":["Tap Me"]}', 'target_type'],
    ['{"action":"tap","target":"   "}', 'target_type'],
    ['{"action":"tap","target":{},"label":"Tap Me"}', 'target_type'],
    ['{"action":"tap","target":"Tap Me","label":"Delete account"}', 'target_conflict'],
    ['{"action":"tap","accessibilityId":"tap_button","label":"Tap Me"}', 'target_conflict'],
    ['{"action":"tap","x":20,"y":30}', 'target_required'],
    ['{"action":"tap","target":"Tap Me","x":20,"y":30}', 'invalid_fields'],
    ['{"action":"input","target":"name_field"}', 'invalid_fields'],
    ['{"action":"input","target":"name_field","text":123}', 'invalid_fields'],
    ['{"action":"input","target":"name_field","text":""}', 'invalid_fields'],
    ['{"action":"swipe","direction":"diagonal"}', 'invalid_fields'],
    ['{"action":"wait","waitMs":"500"}', 'invalid_fields'],
    ['{"action":"wait","waitMs":1e999}', 'invalid_fields'],
    ['{"action":"done","target":"Tap Me"}', 'invalid_fields'],
    ['{"action":"done","reason":"unvalidated"}', 'invalid_fields'],
    ['{}', 'action_required'],
    ['{"action":1}', 'action_required'],
    ['null', 'object_required'],
    ['[]', 'object_required'],
    ['"tap"', 'object_required'],
    ['{"action":"tap"', 'invalid_json'],
    ['Here is {"action":"done"}', 'invalid_json'],
    ['{"action":"done"}{"action":"wait"}', 'invalid_json'],
    ['```json\n{"action":"done"}\n``` trailing prose', 'invalid_json'],
  ] as const;

  for (const [response, code] of invalid) {
    it(`fails closed after one correction: ${response}`, async () => {
      const prompts: string[] = [];
      const progress: unknown[] = [];
      const failure = await suggestExplorationAction(
        options(
          async (prompt) => {
            prompts.push(prompt);
            return response;
          },
          { onProgress: (event) => progress.push(event) },
        ),
      ).catch((error: unknown) => error);
      expect(failure).toBeInstanceOf(ActionSuggestionFormatError);
      expect((failure as ActionSuggestionFormatError).code).toBe(code);
      expect((failure as Error).message).toContain('One format correction was attempted');
      expect((failure as Error).message).toContain('This suggestion was not executed');
      expect(prompts).toHaveLength(2);
      expect(prompts[1]).toStartWith(`${prompts[0]}\nFORMAT CORRECTION (one attempt only):`);
      expect(progress).toHaveLength(1);
      expect(progress[0]).toMatchObject({ stage: 'repairing_action' });
    });
  }

  it('accepts one corrected flat action without guessing the rejected nested target', async () => {
    const responses = [
      '{"action":"tap","target":{"label":"WRONG"}}',
      '{"action":"tap","target":"tap_button"}',
    ];
    const prompts: string[] = [];
    const result = await suggestExplorationAction(
      options(async (prompt) => {
        prompts.push(prompt);
        return responses[prompts.length - 1] ?? '';
      }),
    );
    expect(result).toEqual({ action: 'tap', target: 'tap_button' });
    expect(prompts).toHaveLength(2);
    expect(prompts[1]).not.toContain('WRONG');
  });

  it('retains sensitive corrected actions for the caller permission gate', async () => {
    let calls = 0;
    const result = await suggestExplorationAction(
      options(async () => {
        calls += 1;
        return calls === 1 ? '{"action":"tap"}' : '{"action":"tap","label":"Delete account"}';
      }),
    );
    expect(result).toEqual({ action: 'tap', target: 'Delete account' });
    expect(calls).toBe(2);
  });

  it('blocks unsupported actions without a correction or raw action disclosure', async () => {
    let calls = 0;
    const error = await suggestExplorationAction(
      options(async () => {
        calls += 1;
        return '{"action":"delete_secret_marker"}';
      }),
    ).catch((failure: unknown) => failure);
    expect(calls).toBe(1);
    expect((error as Error).message).toContain('exploration_suggestion_blocked');
    expect((error as Error).message).not.toContain('secret_marker');
  });

  it('blocks an unsupported correction without requesting a third action', async () => {
    let calls = 0;
    await expect(
      suggestExplorationAction(
        options(async () => {
          calls += 1;
          return calls === 1 ? '{"action":"tap"}' : '{"action":"launch"}';
        }),
      ),
    ).rejects.toThrow('exploration_suggestion_blocked');
    expect(calls).toBe(2);
  });

  it('does not leak rejected response text into repair prompts, errors, or progress', async () => {
    const prompts: string[] = [];
    const progress: unknown[] = [];
    const secret = 'UNTRUSTED_RESPONSE_SECRET_SENTINEL';
    const result = await suggestExplorationAction(
      options(
        async (prompt) => {
          prompts.push(prompt);
          return `{"action":"tap","target":{"label":"${secret}"}}`;
        },
        { onProgress: (event) => progress.push(event) },
      ),
    ).catch((error: unknown) => error);
    expect(
      `${prompts.join('\n')} ${JSON.stringify(progress)} ${(result as Error).stack}`,
    ).not.toContain(secret);
  });

  it('redacts every model context field and keeps the same safe context for correction', async () => {
    const prompts: string[] = [];
    const assertions = [
      { conditions: [{ description: 'OTP 654321 is hidden' }] },
    ] as UserAssertion[];
    const history = [
      { action: 'tap', target: 'person@example.com', status: 'completed' },
    ] as RunStep[];
    await suggestExplorationAction(
      options(
        async (prompt) => {
          prompts.push(prompt);
          return prompts.length === 1 ? '{"action":"tap"}' : '{"action":"done"}';
        },
        {
          caseId: 'private@example.com',
          goal: 'Check OTP 123456 and password=secret-password',
          uiTree:
            '<Button name="safe"/><SecureTextField type="SecureTextField" value="secret-password"/>',
          assertions,
          history,
        },
      ),
    );
    expect(prompts).toHaveLength(2);
    for (const prompt of prompts) {
      for (const secret of [
        'private@example.com',
        'person@example.com',
        '123456',
        '654321',
        'secret-password',
      ]) {
        expect(prompt).not.toContain(secret);
      }
      expect(prompt).toContain('[REDACTED]');
    }
  });
});

describe('action suggestion lifecycle', () => {
  it('does not generate when already aborted', async () => {
    const controller = new AbortController();
    const reason = new Error('cancelled');
    controller.abort(reason);
    let calls = 0;
    const result = await suggestExplorationAction(
      options(
        async () => {
          calls += 1;
          return '{"action":"done"}';
        },
        { signal: controller.signal },
      ),
    ).catch((error: unknown) => error);
    expect(result).toBe(reason);
    expect(calls).toBe(0);
  });

  it('checks cancellation after each generation even when the provider ignores the signal', async () => {
    for (const abortAt of [1, 2]) {
      const controller = new AbortController();
      const reason = new Error('cancelled');
      let calls = 0;
      const signals: (AbortSignal | undefined)[] = [];
      const result = await suggestExplorationAction(
        options(
          async (_prompt, signal) => {
            calls += 1;
            signals.push(signal);
            if (calls === abortAt) controller.abort(reason);
            return calls === 1 ? '{"action":"tap"}' : '{"action":"tap","target":"tap_button"}';
          },
          { signal: controller.signal },
        ),
      ).catch((error: unknown) => error);
      expect(result).toBe(reason);
      expect(calls).toBe(abortAt);
      expect(signals.every((signal) => signal === controller.signal)).toBe(true);
    }
  });

  it('does not generate a correction after the progress observer cancels', async () => {
    const controller = new AbortController();
    const reason = new Error('cancelled');
    let calls = 0;
    const result = await suggestExplorationAction(
      options(
        async () => {
          calls += 1;
          return '{"action":"tap"}';
        },
        {
          signal: controller.signal,
          onProgress: () => controller.abort(reason),
        },
      ),
    ).catch((error: unknown) => error);
    expect(result).toBe(reason);
    expect(calls).toBe(1);
  });

  it('propagates provider failures without treating them as format failures', async () => {
    for (const failAt of [1, 2]) {
      const failure = new Error('provider unavailable');
      let calls = 0;
      const result = await suggestExplorationAction(
        options(async () => {
          calls += 1;
          if (calls === failAt) throw failure;
          return '{"action":"tap"}';
        }),
      ).catch((error: unknown) => error);
      expect(result).toBe(failure);
      expect(calls).toBe(failAt);
    }
  });
});
