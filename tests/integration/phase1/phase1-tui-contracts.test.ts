/**
 * phase1-tui-contracts.test.ts — TUI state + data contracts cross-validation.
 *
 * Cross-package: TuiShell (itestagent-tui) → Zod schemas (itestagent-contracts)
 * Verifies TUI state machine aligns with contract-level data types.
 */

import { describe, expect, test } from 'bun:test';
import {
  AgentErrorCodeSchema,
  AgentErrorSchema,
  ArtifactRefSchema,
  PermissionEffectSchema,
  RunResultSchema,
  RunStateSchema,
  RunStepSchema,
  isTerminalState,
  isValidTransition,
  parseArtifactRef,
  parsePermissionRule,
} from 'itestagent-contracts';
import type { AgentEvent, RunResult } from 'itestagent-contracts';
import { RunStateMachine } from 'itestagent-engine';
import { SSEHub, SessionManager } from 'itestagent-server';
import { createInitialState, tuiShellReducer } from 'itestagent-tui';
import type { TuiShellEvent } from 'itestagent-tui';

describe('Phase 1 Integration: TUI State + Contracts Alignment', () => {
  describe('TuiShell state machine', () => {
    test('createInitialState defaults', () => {
      const s = createInitialState('/ws');
      expect(s.workspace).toBe('/ws');
      expect(s.deviceStatus).toBe('no_device');
      expect(s.messages).toHaveLength(0);
      expect(s.inputDraft).toBe('');
      expect(s.running).toBe(true);
    });

    test('reducer input → submit → clear', () => {
      let s = createInitialState('/ws');
      s = tuiShellReducer(s, { type: 'input', text: 'hello' } as TuiShellEvent);
      s = tuiShellReducer(s, { type: 'submit' });
      expect(s.messages).toHaveLength(1);
      expect(s.messages[0]?.text).toBe('hello');
      expect(s.inputDraft).toBe('');
    });

    test('reducer empty submit is ignored', () => {
      expect(tuiShellReducer(createInitialState('/ws'), { type: 'submit' }).messages).toHaveLength(
        0,
      );
    });

    test('reducer system_msg / device_status / quit', () => {
      let s = createInitialState('/ws');
      s = tuiShellReducer(s, { type: 'system_message', text: 'ready' } as TuiShellEvent);
      expect(s.messages[0]?.type).toBe('system');
      s = tuiShellReducer(s, { type: 'device_status_updated', status: 'healthy' } as TuiShellEvent);
      expect(s.deviceStatus).toBe('healthy');
      expect(tuiShellReducer(s, { type: 'quit' }).running).toBe(false);
    });

    test('reducer is pure', () => {
      const s = createInitialState('/ws');
      tuiShellReducer(s, { type: 'input', text: 'test' } as TuiShellEvent);
      expect(s.inputDraft).toBe('');
    });
  });

  describe('RunState transitions', () => {
    const forwards = [
      'created',
      'planning',
      'awaiting_confirm',
      'preparing_device',
      'building_installing',
      'executing',
      'collecting',
      'parsing',
      'explaining',
      'reported',
      'done',
    ];
    const exceptions = ['cancelled', 'blocked', 'infra_failed', 'failed'] as const;

    test('all forward states parse', () => {
      for (const s of forwards) expect(() => RunStateSchema.parse(s)).not.toThrow();
    });
    test('all exception states parse', () => {
      for (const s of exceptions) expect(() => RunStateSchema.parse(s)).not.toThrow();
    });

    test('isValidTransition forward chain', () => {
      expect(isValidTransition('created', 'planning')).toBe(true);
      expect(isValidTransition('planning', 'awaiting_confirm')).toBe(true);
      expect(isValidTransition('executing', 'collecting')).toBe(true);
    });

    test('isValidTransition exception from any forward', () => {
      expect(isValidTransition('executing', 'cancelled')).toBe(true);
      expect(isValidTransition('created', 'failed')).toBe(true);
    });

    test('isValidTransition rejects invalid', () => {
      expect(isValidTransition('done', 'created')).toBe(false);
      expect(isValidTransition('created', 'executing')).toBe(false);
    });

    test('isTerminalState', () => {
      for (const s of ['cancelled', 'blocked', 'infra_failed', 'failed', 'done'] as const)
        expect(isTerminalState(s)).toBe(true);
      expect(isTerminalState('executing')).toBe(false);
    });
  });

  describe('AgentError codes', () => {
    const codes = [
      'blocked.security',
      'blocked.setup',
      'blocked.no_device_available',
      'blocked.cross_target_fallback',
      'blocked.target_unsupported',
      'blocked.privacy',
      'blocked.safety',
      'capability.missing',
      'backend.error',
      'artifact.error',
      'app_state.unexpected',
      'timeout.flaky',
      'not_exportable',
      'inconclusive',
    ];
    test('all codes parse', () => {
      for (const c of codes) expect(() => AgentErrorCodeSchema.parse(c)).not.toThrow();
    });
    test('AgentErrorSchema full object', () => {
      expect(AgentErrorSchema.parse({ code: 'timeout.flaky', message: 'timed out' }).code).toBe(
        'timeout.flaky',
      );
    });
  });

  describe('Permission', () => {
    test('PermissionEffectSchema allow/deny/ask', () => {
      expect(() => PermissionEffectSchema.parse('allow')).not.toThrow();
      expect(() => PermissionEffectSchema.parse('deny')).not.toThrow();
      expect(() => PermissionEffectSchema.parse('ask')).not.toThrow();
    });
    test('parsePermissionRule', () => {
      expect(
        parsePermissionRule({ action: 'tap', resource: 'com.example', effect: 'ask' }).effect,
      ).toBe('ask');
    });
  });

  describe('RunStep schema', () => {
    test('validates complete step', () => {
      const s = {
        stepId: 's1',
        backend: 'appium',
        action: 'tap',
        target: 'btn',
        input: { x: 0.5, y: 0.5 },
        result: { status: 'ok' },
        artifacts: ['a1'],
        startedAt: '2026-07-19T12:00:00Z',
        durationMs: 500,
      };
      expect(RunStepSchema.parse(s).stepId).toBe('s1');
    });
  });

  describe('ArtifactRef', () => {
    test('round-trip', () => {
      const r = {
        id: 'a1',
        type: 'screenshot',
        path: '/tmp/x.png',
        mimeType: 'image/png',
        redactionStatus: 'raw-local-only',
      };
      expect(ArtifactRefSchema.parse(r).type).toBe('screenshot');
      expect(parseArtifactRef(r).id).toBe('a1');
    });
  });

  describe('RunResult', () => {
    test('full round-trip', () => {
      const r: RunResult = {
        schemaVersion: '2.0.0',
        runId: 'run_1',
        status: 'passed',
        projectProfileRef: '/tmp/profile.json',
        device: {
          udid: 'UDID',
          name: 'iPhone',
          model: 'iPhone15,3',
          osVersion: '18.2',
          targetKind: 'physical',
        },
        execution: {
          totalSteps: 5,
          completedSteps: 5,
          failedSteps: 0,
          skippedSteps: 0,
          durationMs: 300000,
          startTime: '2026-07-19T12:00:00Z',
          endTime: '2026-07-19T12:05:00Z',
          targetKind: 'physical',
          backendUsed: 'appium',
          deviceId: 'UDID',
        },
        cases: [],
        metrics: {},
        environment: {
          targetKind: 'physical',
          representativeOfPhysicalDevice: true,
          comparisonScope: 'physical_only',
        },
        artifactRefs: [],
      };
      expect(RunResultSchema.parse(r).runId).toBe('run_1');
    });
  });

  describe('Cross-package: TUI intent → SessionManager → RSM → SSE broadcast', () => {
    test('user submits "run login test" → creates session → RSM enters created', () => {
      const rsm = new RunStateMachine();
      const sseHub = new SSEHub();

      const db = {
        insert() {
          return {
            values() {
              const p = Promise.resolve() as Promise<unknown> & {
                onConflictDoNothing: () => Promise<unknown>;
              };
              p.onConflictDoNothing = () => Promise.resolve();
              return p;
            },
          };
        },
        update() {
          return {
            set() {
              const p = Promise.resolve() as Promise<unknown> & {
                where: () => Promise<unknown>;
              };
              p.where = () => Promise.resolve();
              return p;
            },
          };
        },
      } as unknown as ReturnType<typeof import('itestagent-store').createDb>;

      const sm = new SessionManager({ sseHub, db, runStateMachine: rsm });

      let tuiState = createInitialState('/tmp/ios-project');
      tuiState = tuiShellReducer(tuiState, {
        type: 'input',
        text: 'run login test',
      } as TuiShellEvent);
      tuiState = tuiShellReducer(tuiState, { type: 'submit' });

      expect(tuiState.messages).toHaveLength(1);
      expect(tuiState.messages[0]?.text).toBe('run login test');

      const session = sm.createSession({
        workspace: tuiState.workspace,
        targetKind: 'physical',
      });

      expect(session.sessionId).toStartWith('ses_');
      expect(session.status).toBe('active');

      const state = rsm.transition(session.runId, 'created', 'planning');
      expect(state).toBe('planning');
    });

    test('SSE broadcast of run.state.changed after RSM transition', () => {
      const rsm = new RunStateMachine({ onEvent: () => {} });
      const sseHub = new SSEHub();

      const db = {
        insert() {
          return {
            values() {
              const p = Promise.resolve() as Promise<unknown> & {
                onConflictDoNothing: () => Promise<unknown>;
              };
              p.onConflictDoNothing = () => Promise.resolve();
              return p;
            },
          };
        },
        update() {
          return {
            set() {
              const p = Promise.resolve() as Promise<unknown> & {
                where: () => Promise<unknown>;
              };
              p.where = () => Promise.resolve();
              return p;
            },
          };
        },
      } as unknown as ReturnType<typeof import('itestagent-store').createDb>;

      const sm = new SessionManager({ sseHub, db, runStateMachine: rsm });
      const session = sm.createSession({ workspace: '/tmp/x', targetKind: 'physical' });
      const reader = sseHub.subscribe(session.sessionId).getReader();

      rsm.transition(session.runId, 'created', 'planning');

      sseHub.broadcast(session.sessionId, {
        type: 'run.state.changed',
        runId: session.runId,
        from: 'created',
        to: 'planning',
      } as unknown as AgentEvent);

      const result = reader.read();
      result.then(({ done, value }) => {
        expect(done).toBe(false);
        if (value) {
          expect(new TextDecoder().decode(value)).toContain('run.state.changed');
        }
      });

      reader.releaseLock();
    });
  });
});
