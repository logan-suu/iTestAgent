import { describe, expect, it } from 'bun:test';
import { createInitialState, tuiShellReducer } from '../src/tui-shell.js';
import type { TuiShellState } from '../src/tui-shell.js';

describe('TuiShell intent integration', () => {
  function makeState(overrides?: Partial<TuiShellState>): TuiShellState {
    return { ...createInitialState('/test/workspace'), ...overrides };
  }

  describe('intent_parsed event', () => {
    it('stores complete intent in state', () => {
      const state = makeState();
      const next = tuiShellReducer(state, {
        type: 'intent_parsed',
        result: {
          status: 'complete',
          intent: {
            goal: 'smoke test — features: Login',
            targetKind: 'physical',
            features: ['Login'],
            metricsRequested: true,
            scope: 'smoke',
            sourceText: '帮我用本机 iPhone 跑一下登录 smoke',
          },
        },
      });
      expect(next.currentIntent?.status).toBe('complete');
      if (next.currentIntent?.status === 'complete') {
        expect(next.currentIntent.intent.targetKind).toBe('physical');
        expect(next.currentIntent.intent.features).toEqual(['Login']);
      }
    });

    it('stores incomplete intent with clarifications', () => {
      const state = makeState();
      const next = tuiShellReducer(state, {
        type: 'intent_parsed',
        result: {
          status: 'incomplete',
          intent: {
            goal: 'smoke test',
            features: [],
            metricsRequested: false,
            scope: 'smoke',
            sourceText: 'run smoke test',
          },
          clarificationsNeeded: [
            {
              question: '你想在什么设备上测试？',
              field: 'targetKind',
              options: ['真机 (iPhone)', '模拟器 (Simulator)'],
            },
          ],
        },
      });
      expect(next.currentIntent?.status).toBe('incomplete');
    });

    it('appends system messages for each clarification', () => {
      const state = makeState();
      const next = tuiShellReducer(state, {
        type: 'intent_parsed',
        result: {
          status: 'incomplete',
          intent: {
            goal: 'smoke test',
            features: [],
            metricsRequested: false,
            scope: 'smoke',
            sourceText: 'run smoke test',
          },
          clarificationsNeeded: [
            { question: '设备？', field: 'targetKind', options: ['真机', '模拟器'] },
            { question: '功能？', field: 'features' },
          ],
        },
      });
      expect(next.messages).toHaveLength(2);
      expect(next.messages[0]?.type).toBe('system');
      expect(next.messages[0]?.text).toContain('设备？');
      expect(next.messages[1]?.text).toContain('功能？');
    });
  });

  describe('intent_clarify_response event', () => {
    it('clears current intent and adds user message on clarification response', () => {
      const state = makeState({
        currentIntent: {
          status: 'incomplete',
          intent: {
            goal: 'smoke test',
            features: [],
            metricsRequested: false,
            scope: 'smoke',
            sourceText: 'run smoke test',
          },
          clarificationsNeeded: [
            { question: '设备？', field: 'targetKind', options: ['真机', '模拟器'] },
          ],
        },
      });

      // When user selects "真机" as their answer
      const next = tuiShellReducer(state, {
        type: 'intent_clarify_response',
        text: '真机',
      });

      expect(next.currentIntent).toBeNull();
      expect(next.messages).toHaveLength(1);
      expect(next.messages[0]?.type).toBe('user');
      expect(next.messages[0]?.text).toBe('真机');
    });
  });

  describe('intent_cancel event', () => {
    it('clears current intent without messages', () => {
      const state = makeState({
        currentIntent: {
          status: 'incomplete',
          intent: {
            goal: 'smoke test',
            features: [],
            metricsRequested: false,
            scope: 'smoke',
            sourceText: 'run smoke test',
          },
          clarificationsNeeded: [{ question: '设备？', field: 'targetKind' }],
        },
      });

      const next = tuiShellReducer(state, { type: 'intent_cancel' });
      expect(next.currentIntent).toBeNull();
      expect(next.messages).toHaveLength(0);
    });
  });

  describe('submit during clarification', () => {
    it('clears intent and submits response when pending clarification', () => {
      const state = makeState({
        currentIntent: {
          status: 'incomplete',
          intent: {
            goal: 'smoke test',
            features: [],
            metricsRequested: false,
            scope: 'smoke',
            sourceText: 'run smoke test on iPhone',
          },
          clarificationsNeeded: [{ question: '功能？', field: 'features' }],
        },
        inputDraft: 'login',
      });

      const next = tuiShellReducer(state, { type: 'submit' });

      expect(next.currentIntent).toBeNull();
      expect(next.messages).toHaveLength(1);
      expect(next.messages[0]?.text).toBe('login');
      expect(next.inputDraft).toBe('');
    });
  });
});
