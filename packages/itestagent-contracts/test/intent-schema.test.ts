import { describe, expect, it } from 'bun:test';
import {
  ClarificationSchema,
  CompleteResultSchema,
  IncompleteResultSchema,
  IntentParseResultSchema,
  IntentSchema,
  ScopeSchema,
  parseIntentResult,
} from '../src/intent-schema.js';

describe('ScopeSchema', () => {
  it('accepts valid scope values', () => {
    expect(ScopeSchema.parse('smoke')).toBe('smoke');
    expect(ScopeSchema.parse('explore')).toBe('explore');
    expect(ScopeSchema.parse('full')).toBe('full');
    expect(ScopeSchema.parse('perf')).toBe('perf');
    expect(ScopeSchema.parse('custom')).toBe('custom');
  });

  it('rejects invalid scope values', () => {
    expect(() => ScopeSchema.parse('regression')).toThrow();
    expect(() => ScopeSchema.parse('')).toThrow();
    expect(() => ScopeSchema.parse(42)).toThrow();
  });
});

describe('IntentSchema', () => {
  it('parses a complete intent with all optional fields', () => {
    const raw = {
      goal: '跑一下登录 smoke 并分析失败原因',
      targetKind: 'physical',
      deviceHint: '本机 iPhone',
      features: ['login'],
      metricsRequested: true,
      scope: 'smoke',
      sourceText: '帮我用本机 iPhone 跑一下登录 smoke 并分析失败原因',
    };
    const intent = IntentSchema.parse(raw);
    expect(intent.goal).toBe('跑一下登录 smoke 并分析失败原因');
    expect(intent.targetKind).toBe('physical');
    expect(intent.deviceHint).toBe('本机 iPhone');
    expect(intent.features).toEqual(['login']);
    expect(intent.metricsRequested).toBe(true);
    expect(intent.scope).toBe('smoke');
  });

  it('parses a minimal intent with only required fields', () => {
    const raw = {
      goal: 'explore the app',
      features: [],
      metricsRequested: false,
      scope: 'explore',
      sourceText: 'explore the app',
    };
    const intent = IntentSchema.parse(raw);
    expect(intent.targetKind).toBeUndefined();
    expect(intent.deviceHint).toBeUndefined();
  });

  it('rejects intent missing required fields', () => {
    expect(() => IntentSchema.parse({ goal: 'test' })).toThrow();
    expect(() => IntentSchema.parse({})).toThrow();
  });

  it('rejects invalid targetKind', () => {
    expect(() =>
      IntentSchema.parse({
        goal: 'test',
        targetKind: 'cloud',
        features: [],
        metricsRequested: false,
        scope: 'smoke',
        sourceText: 'test',
      }),
    ).toThrow();
  });

  it('rejects invalid scope', () => {
    expect(() =>
      IntentSchema.parse({
        goal: 'test',
        features: [],
        metricsRequested: false,
        scope: 'regression',
        sourceText: 'test',
      }),
    ).toThrow();
  });
});

describe('ClarificationSchema', () => {
  it('parses a clarification with options', () => {
    const raw = {
      question: '你想在什么设备上测试？',
      field: 'targetKind',
      options: ['真机 (iPhone)', '模拟器 (Simulator)'],
    };
    const clarification = ClarificationSchema.parse(raw);
    expect(clarification.question).toBe('你想在什么设备上测试？');
    expect(clarification.field).toBe('targetKind');
    expect(clarification.options).toEqual(['真机 (iPhone)', '模拟器 (Simulator)']);
  });

  it('parses a clarification without options', () => {
    const raw = {
      question: 'Which feature would you like to test?',
      field: 'features',
    };
    const clarification = ClarificationSchema.parse(raw);
    expect(clarification.options).toBeUndefined();
  });
});

describe('CompleteResultSchema', () => {
  it('parses a complete result', () => {
    const raw = {
      status: 'complete',
      intent: {
        goal: 'run login smoke test',
        features: ['login'],
        metricsRequested: true,
        scope: 'smoke',
        sourceText: 'run login smoke test with performance analysis',
      },
    };
    const result = CompleteResultSchema.parse(raw);
    expect(result.status).toBe('complete');
  });
});

describe('IncompleteResultSchema', () => {
  it('parses an incomplete result with clarifications', () => {
    const raw = {
      status: 'incomplete',
      intent: {
        goal: 'test the app',
        features: [],
        metricsRequested: false,
        scope: 'explore',
        sourceText: 'test the app',
      },
      clarificationsNeeded: [
        {
          question: '你想在什么设备上测试？',
          field: 'targetKind',
          options: ['真机 (iPhone)', '模拟器 (Simulator)'],
        },
        {
          question: '你想测试哪些功能？',
          field: 'features',
          options: ['login', 'settings', 'payment'],
        },
      ],
    };
    const result = IncompleteResultSchema.parse(raw);
    expect(result.status).toBe('incomplete');
    expect(result.clarificationsNeeded).toHaveLength(2);
  });
});

describe('IntentParseResultSchema (discriminated union)', () => {
  it('parses complete result', () => {
    const raw = {
      status: 'complete',
      intent: {
        goal: 'run login smoke test',
        targetKind: 'physical',
        deviceHint: 'iPhone',
        features: ['login'],
        metricsRequested: true,
        scope: 'smoke',
        sourceText: 'run login smoke test on iPhone',
      },
    };
    const result = IntentParseResultSchema.parse(raw);
    expect(result.status).toBe('complete');
    if (result.status === 'complete') {
      expect(result.intent.targetKind).toBe('physical');
    }
  });

  it('parses incomplete result', () => {
    const raw = {
      status: 'incomplete',
      intent: {
        goal: 'test the app',
        features: [],
        metricsRequested: false,
        scope: 'explore',
        sourceText: 'test the app',
      },
      clarificationsNeeded: [{ question: 'What device?', field: 'targetKind' }],
    };
    const result = IntentParseResultSchema.parse(raw);
    expect(result.status).toBe('incomplete');
    if (result.status === 'incomplete') {
      expect(result.clarificationsNeeded).toHaveLength(1);
    }
  });

  it('rejects invalid status', () => {
    expect(() => IntentParseResultSchema.parse({ status: 'partial', intent: {} })).toThrow();
  });
});

describe('parseIntentResult', () => {
  it('parses complete result', () => {
    const result = parseIntentResult({
      status: 'complete',
      intent: {
        goal: 'run login smoke test',
        features: ['login'],
        metricsRequested: true,
        scope: 'smoke',
        sourceText: 'run login smoke test',
      },
    });
    expect(result.status).toBe('complete');
  });

  it('throws on bad input', () => {
    expect(() => parseIntentResult({ status: 'complete' })).toThrow();
    expect(() => parseIntentResult(null)).toThrow();
    expect(() => parseIntentResult('nope')).toThrow();
  });
});
