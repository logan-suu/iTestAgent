import { describe, expect, test } from 'bun:test';
import {
  DEFAULT_HIGH_RISK_ACTIONS,
  type PermissionEffect,
  PermissionEffectSchema,
  type PermissionRule,
  type SafetyGate,
} from 'itestagent-contracts';
import { PermissionEngine } from '../src/permission-engine.js';

// ─── Helpers ────────────────────────────────────────────────

function makeEngine(opts?: ConstructorParameters<typeof PermissionEngine>[0]): PermissionEngine {
  return new PermissionEngine(opts);
}

/** Assert that a Promise rejects within timeout with a message matching pattern. */
async function assertRejects(
  promise: Promise<unknown>,
  pattern: RegExp,
  timeoutMs = 5000,
): Promise<void> {
  const timeout = new Promise<never>((_, rej) =>
    setTimeout(
      () => rej(new Error(`Expected rejection but timed out after ${timeoutMs}ms`)),
      timeoutMs,
    ),
  );
  try {
    await Promise.race([promise, timeout]);
    throw new Error('Expected promise to reject but it resolved');
  } catch (e: unknown) {
    if (e instanceof Error && !pattern.test(e.message)) {
      throw new Error(`Rejection message "${e.message}" did not match ${pattern}`);
    }
  }
}

// ────────────────────────────────────────────────────────────
//  AC1: Rule model {action, resource, effect} + wildcard
// ────────────────────────────────────────────────────────────

describe('AC1: rule model + wildcard matching', () => {
  test('check returns allow for non-high-risk action with no rules', () => {
    const engine = makeEngine();
    expect(engine.check('tap_button', 'com.example.app')).toBe('allow');
  });

  test('check returns ask for high-risk action (clear_app_data)', () => {
    const engine = makeEngine();
    expect(engine.check('clear_app_data', 'com.example.app')).toBe('ask');
  });

  test('explicit allow rule overrides high-risk default', () => {
    const engine = makeEngine({
      preloadedRules: [{ action: 'clear_app_data', resource: 'com.example.app', effect: 'allow' }],
    });
    expect(engine.check('clear_app_data', 'com.example.app')).toBe('allow');
  });

  test('explicit deny rule overrides high-risk default', () => {
    const engine = makeEngine({
      preloadedRules: [{ action: 'clear_app_data', resource: 'com.example.app', effect: 'deny' }],
    });
    expect(engine.check('clear_app_data', 'com.example.app')).toBe('deny');
  });

  test('wildcard resource matches any resource for the same action', () => {
    const engine = makeEngine({
      preloadedRules: [{ action: 'uninstall_app', resource: '*', effect: 'deny' }],
    });
    expect(engine.check('uninstall_app', 'com.foo.app')).toBe('deny');
    expect(engine.check('uninstall_app', 'com.bar.app')).toBe('deny');
    expect(engine.check('uninstall_app', 'anything')).toBe('deny');
  });

  test('wildcard resource does not match different actions', () => {
    const engine = makeEngine({
      preloadedRules: [{ action: 'uninstall_app', resource: '*', effect: 'deny' }],
    });
    // Different action — should fall through to high-risk default
    expect(engine.check('write_project_file', 'anything')).toBe('ask');
  });

  test('exact resource match takes priority over wildcard', () => {
    const engine = makeEngine();
    engine.addRule({ action: 'write_project_file', resource: '*', effect: 'deny' });
    engine.addRule({ action: 'write_project_file', resource: 'src/special.ts', effect: 'allow' });

    // Exact match
    expect(engine.check('write_project_file', 'src/special.ts')).toBe('allow');
    // Wildcard fallback
    expect(engine.check('write_project_file', 'src/other.ts')).toBe('deny');
  });

  test('addRule and removeRule manage user-defined rules', () => {
    const engine = makeEngine();
    expect(engine.getRules()).toHaveLength(0);

    engine.addRule({ action: 'clear_app_data', resource: 'com.x', effect: 'allow' });
    expect(engine.getRules()).toHaveLength(1);
    expect(engine.check('clear_app_data', 'com.x')).toBe('allow');

    engine.removeRule('clear_app_data', 'com.x');
    expect(engine.getRules()).toHaveLength(0);
    expect(engine.check('clear_app_data', 'com.x')).toBe('ask');
  });

  test('clearRules removes all user-defined rules', () => {
    const engine = makeEngine();
    engine.addRule({ action: 'clear_app_data', resource: 'com.x', effect: 'allow' });
    engine.addRule({ action: 'uninstall_app', resource: '*', effect: 'deny' });
    expect(engine.getRules()).toHaveLength(2);

    engine.clearRules();
    expect(engine.getRules()).toHaveLength(0);
  });
});

// ────────────────────────────────────────────────────────────
//  AC2: High-risk operations default to ask
// ────────────────────────────────────────────────────────────

describe('AC2: high-risk operations default to ask', () => {
  test('all 9 DEFAULT_HIGH_RISK_ACTIONS return ask by default', () => {
    const engine = makeEngine();
    for (const action of DEFAULT_HIGH_RISK_ACTIONS) {
      expect(engine.check(action, 'com.example.app')).toBe('ask');
    }
  });

  test('non-high-risk action returns allow by default', () => {
    const engine = makeEngine();
    const safeActions = [
      'tap_button',
      'swipe',
      'screenshot',
      'get_ui_tree',
      'launch_app',
      'type_text',
      'press_home',
    ];
    for (const action of safeActions) {
      expect(engine.check(action, 'com.example.app')).toBe('allow');
    }
  });

  test('custom high-risk action list overrides defaults', () => {
    const engine = makeEngine({ highRiskActions: ['delete_database', 'format_device'] });
    expect(engine.check('delete_database', 'db/main.sqlite')).toBe('ask');
    expect(engine.check('format_device', 'iPhone')).toBe('ask');
    // Default high-risk that is NOT in custom list → allow
    expect(engine.check('clear_app_data', 'com.x')).toBe('allow');
  });

  test('empty high-risk list makes all actions safe', () => {
    const engine = makeEngine({ highRiskActions: [] });
    expect(engine.check('clear_app_data', 'com.x')).toBe('allow');
    expect(engine.check('uninstall_app', 'com.x')).toBe('allow');
  });

  test('getHighRiskActions returns the active list', () => {
    const engine = makeEngine();
    expect(engine.getHighRiskActions()).toEqual(DEFAULT_HIGH_RISK_ACTIONS);

    const custom = makeEngine({ highRiskActions: ['a', 'b'] });
    expect(custom.getHighRiskActions()).toEqual(['a', 'b']);
  });
});

// ────────────────────────────────────────────────────────────
//  AC3: ask blocks waiting for user confirmation
// ────────────────────────────────────────────────────────────

describe('AC3: ask blocks + always remember + persistence', () => {
  test('requestPermission returns allow after user resolves allow', async () => {
    const engine = makeEngine();
    const callId = 'call-1';

    const promise = engine.requestPermission(callId, 'clear_app_data', 'com.x');
    // Resolve while the promise is pending
    engine.resolve(callId, 'allow', false);

    const result = await promise;
    expect(result.effect).toBe('allow');
    expect(result.remembered).toBe(false);
  });

  test('requestPermission returns deny after user resolves deny', async () => {
    const engine = makeEngine();
    const callId = 'call-2';

    const promise = engine.requestPermission(callId, 'clear_app_data', 'com.x');
    engine.resolve(callId, 'deny', false);

    const result = await promise;
    expect(result.effect).toBe('deny');
    expect(result.remembered).toBe(false);
  });

  test('resolve with remember=true persists the rule', async () => {
    const engine = makeEngine();
    const callId = 'call-3';

    const promise = engine.requestPermission(callId, 'write_project_file', 'src/app.ts');
    engine.resolve(callId, 'allow', true);

    const result = await promise;
    expect(result.effect).toBe('allow');
    expect(result.remembered).toBe(true);

    // Subsequent check should now return allow due to persisted rule
    expect(engine.check('write_project_file', 'src/app.ts')).toBe('allow');
    expect(engine.getRules()).toHaveLength(1);
  });

  test('resolve with remember=true for deny persists the deny rule', async () => {
    const engine = makeEngine();
    const callId = 'call-deny';

    const promise = engine.requestPermission(callId, 'uninstall_app', 'com.x');
    engine.resolve(callId, 'deny', true);

    const result = await promise;
    expect(result.effect).toBe('deny');
    expect(result.remembered).toBe(true);
    expect(engine.check('uninstall_app', 'com.x')).toBe('deny');
  });

  test('allow without remember does not persist', async () => {
    const engine = makeEngine();
    const callId = 'call-4';

    const promise = engine.requestPermission(callId, 'clear_app_data', 'com.x');
    engine.resolve(callId, 'allow', false);

    await promise;
    // Should still be ask since rule not persisted
    expect(engine.check('clear_app_data', 'com.x')).toBe('ask');
    expect(engine.getRules()).toHaveLength(0);
  });

  test('multiple concurrent asks handle independently', async () => {
    const engine = makeEngine();

    const p1 = engine.requestPermission('c1', 'clear_app_data', 'com.a');
    const p2 = engine.requestPermission('c2', 'uninstall_app', 'com.b');
    const p3 = engine.requestPermission('c3', 'write_project_file', 'src/x.ts');

    engine.resolve('c1', 'allow', false);
    engine.resolve('c2', 'deny', true);
    engine.resolve('c3', 'allow', true);

    const [r1, r2, r3] = await Promise.all([p1, p2, p3]);
    expect(r1.effect).toBe('allow');
    expect(r2.effect).toBe('deny');
    expect(r3.effect).toBe('allow');
    expect(r2.remembered).toBe(true);
  });

  test('requestPermission blocks until resolved', async () => {
    const engine = makeEngine();
    const callId = 'call-block';

    let resolved = false;
    const promise = engine.requestPermission(callId, 'clear_app_data', 'com.x').then((r) => {
      resolved = true;
      return r;
    });

    // Give microtask queue time to run
    await new Promise((r) => setTimeout(r, 50));
    expect(resolved).toBe(false);

    engine.resolve(callId, 'allow', false);
    await promise;
    expect(resolved).toBe(true);
  });
});

// ────────────────────────────────────────────────────────────
//  AC4: deny prevents execution; user refusal stops loop
// ────────────────────────────────────────────────────────────

describe('AC4: deny prevents execution + stop loop', () => {
  test('resolve deny on high-risk action returns deny effect', async () => {
    const engine = makeEngine();
    const callId = 'call-reject';

    const promise = engine.requestPermission(callId, 'clear_app_data', 'com.x');
    engine.resolve(callId, 'deny', false);

    const result = await promise;
    expect(result.effect).toBe('deny');
  });

  test('cancel rejects with cancellation error', async () => {
    const engine = makeEngine();
    const callId = 'call-cancel';

    const promise = engine.requestPermission(callId, 'clear_app_data', 'com.x');
    engine.cancel(callId, 'user_aborted');

    await assertRejects(promise, /cancel|abort/i);
  });

  test('cancel with different callId does not affect other asks', async () => {
    const engine = makeEngine();

    const p1 = engine.requestPermission('c1', 'clear_app_data', 'com.a');
    const p2 = engine.requestPermission('c2', 'uninstall_app', 'com.b');

    engine.cancel('c1', 'user_aborted');
    await assertRejects(p1, /cancel|abort/i);

    // p2 should still be pending
    let p2Resolved = false;
    p2.then(() => {
      p2Resolved = true;
    });
    await new Promise((r) => setTimeout(r, 50));
    expect(p2Resolved).toBe(false);

    // Resolve p2 normally
    engine.resolve('c2', 'allow', false);
    await p2;
    expect(p2Resolved).toBe(true);
  });

  test('preloaded deny rule causes check to immediately return deny', () => {
    const engine = makeEngine({
      preloadedRules: [{ action: 'clear_app_data', resource: '*', effect: 'deny' }],
    });
    expect(engine.check('clear_app_data', 'any.app')).toBe('deny');
  });

  test('preloaded deny rule causes requestPermission to resolve immediately', async () => {
    const engine = makeEngine({
      preloadedRules: [{ action: 'clear_app_data', resource: '*', effect: 'deny' }],
    });

    // Should resolve immediately without blocking
    const result = await engine.requestPermission('call-fast', 'clear_app_data', 'any.app');
    expect(result.effect).toBe('deny');
  });

  test('preloaded allow rule causes requestPermission to resolve immediately', async () => {
    const engine = makeEngine({
      preloadedRules: [{ action: 'clear_app_data', resource: 'com.safe.app', effect: 'allow' }],
    });

    const result = await engine.requestPermission('call-fast2', 'clear_app_data', 'com.safe.app');
    expect(result.effect).toBe('allow');
  });

  test('cancel a non-existent callId is a no-op (no error)', () => {
    const engine = makeEngine();
    // Should not throw
    engine.cancel('nonexistent', 'test');
  });

  test('resolve a non-existent callId is a no-op (no error)', () => {
    const engine = makeEngine();
    // Should not throw
    engine.resolve('nonexistent', 'allow', false);
  });
});

// ────────────────────────────────────────────────────────────
//  ADR-010 §11: timeout + deadlock prevention
// ────────────────────────────────────────────────────────────

describe('timeout and deadlock prevention', () => {
  test('ask times out after configured timeoutMs (short)', async () => {
    const engine = makeEngine({ askTimeoutMs: 100 });

    const promise = engine.requestPermission('call-timeout', 'clear_app_data', 'com.x');
    await assertRejects(promise, /timed out/i, 2000);
  });

  test('ask times out after default timeoutMs (longer — use cancel to speed up)', async () => {
    const engine = makeEngine({ askTimeoutMs: 50 });

    const promise = engine.requestPermission('call-timeout2', 'write_project_file', 'src/x.ts');

    // Should reject with timeout
    let didReject = false;
    try {
      await promise;
    } catch {
      didReject = true;
    }
    expect(didReject).toBe(true);
  });

  test('timeout does not leave orphaned promise (no deadlock)', async () => {
    const engine = makeEngine({ askTimeoutMs: 30 });

    // Create and let it time out
    try {
      await engine.requestPermission('orphan-1', 'clear_app_data', 'com.x');
    } catch {
      // Expected
    }

    // Subsequent request on same engine should work fine (no deadlock)
    const promise = engine.requestPermission('orphan-2', 'clear_app_data', 'com.x');
    engine.resolve('orphan-2', 'allow', false);
    const result = await promise;
    expect(result.effect).toBe('allow');
  });

  test('resolve after timeout is a no-op (no error)', () => {
    const engine = makeEngine({ askTimeoutMs: 30 });
    // Don't await — let it time out
    engine.requestPermission('late-resolve', 'clear_app_data', 'com.x').catch(() => {});

    // Should not throw or affect other state
    engine.resolve('late-resolve', 'allow', false);
  });
});

// ────────────────────────────────────────────────────────────
//  Persistence: exportRules / fromRules
// ────────────────────────────────────────────────────────────

describe('persistence: exportRules / fromRules', () => {
  test('exportRules returns empty array for fresh engine', () => {
    const engine = makeEngine();
    expect(engine.exportRules()).toEqual([]);
  });

  test('exportRules returns all user-added rules', () => {
    const engine = makeEngine();
    engine.addRule({ action: 'clear_app_data', resource: 'com.x', effect: 'allow' });
    engine.addRule({ action: 'uninstall_app', resource: '*', effect: 'deny' });

    const exported = engine.exportRules();
    expect(exported).toHaveLength(2);
    expect(exported).toContainEqual({
      action: 'clear_app_data',
      resource: 'com.x',
      effect: 'allow',
    });
    expect(exported).toContainEqual({ action: 'uninstall_app', resource: '*', effect: 'deny' });
  });

  test('exportRules does not include remembered-through-resolve rules added by resolve (they are in addRule)', () => {
    // Rules added via resolve(remember=true) or addRule both appear in exportRules
    const engine = makeEngine();
    engine.addRule({ action: 'a', resource: 'r', effect: 'allow' });
    engine.addRule({ action: 'b', resource: '*', effect: 'deny' });

    expect(engine.exportRules()).toHaveLength(2);
  });

  test('fromRules restores engine with preloaded rules', () => {
    const rules: PermissionRule[] = [
      { action: 'clear_app_data', resource: '*', effect: 'deny' },
      { action: 'write_project_file', resource: 'src/ok.ts', effect: 'allow' },
    ];

    const engine = PermissionEngine.fromRules(rules);

    expect(engine.check('clear_app_data', 'any.app')).toBe('deny');
    expect(engine.check('write_project_file', 'src/ok.ts')).toBe('allow');
    expect(engine.check('write_project_file', 'src/other.ts')).toBe('ask'); // not matched
    expect(engine.getRules()).toHaveLength(2);
  });

  test('fromRules with custom high-risk actions', () => {
    const engine = PermissionEngine.fromRules([], { highRiskActions: ['custom_risk'] });
    expect(engine.check('custom_risk', 'x')).toBe('ask');
    expect(engine.check('clear_app_data', 'x')).toBe('allow'); // not in custom list
  });

  test('round-trip: exportRules → fromRules preserves behavior', () => {
    const engine1 = makeEngine();
    engine1.addRule({ action: 'clear_app_data', resource: '*', effect: 'deny' });
    engine1.addRule({ action: 'write_project_file', resource: 'src/safe.ts', effect: 'allow' });

    const exported = engine1.exportRules();
    const engine2 = PermissionEngine.fromRules(exported);

    expect(engine2.check('clear_app_data', 'any.app')).toBe('deny');
    expect(engine2.check('write_project_file', 'src/safe.ts')).toBe('allow');
    expect(engine2.check('write_project_file', 'src/unsafe.ts')).toBe('ask');
    expect(engine2.getRules()).toHaveLength(2);
  });
});

// ────────────────────────────────────────────────────────────
//  Edge cases
// ────────────────────────────────────────────────────────────

describe('edge cases', () => {
  test('duplicate rule (same action+resource): latest wins', () => {
    const engine = makeEngine();
    engine.addRule({ action: 'clear_app_data', resource: '*', effect: 'allow' });
    engine.addRule({ action: 'clear_app_data', resource: '*', effect: 'deny' });

    // Latest rule should win
    expect(engine.check('clear_app_data', 'any.app')).toBe('deny');
    expect(engine.getRules()).toHaveLength(2);
  });

  test('removeRule only removes exact action+resource match', () => {
    const engine = makeEngine();
    engine.addRule({ action: 'a', resource: 'r1', effect: 'allow' });
    engine.addRule({ action: 'a', resource: 'r2', effect: 'deny' });

    engine.removeRule('a', 'r1');

    expect(engine.check('a', 'r1')).toBe('allow'); // back to default (not high-risk)
    expect(engine.check('a', 'r2')).toBe('deny'); // still there
    expect(engine.getRules()).toHaveLength(1);
  });

  test('removeRule with wildcard resource removes wildcard rule', () => {
    const engine = makeEngine();
    engine.addRule({ action: 'clear_app_data', resource: '*', effect: 'deny' });
    engine.removeRule('clear_app_data', '*');

    expect(engine.check('clear_app_data', 'any.app')).toBe('ask');
    expect(engine.getRules()).toHaveLength(0);
  });

  test('SafetyGate type matches contract', () => {
    const engine = makeEngine();
    const gate: SafetyGate = engine.check('tap', 'x');
    expect(['allow', 'ask', 'deny'].includes(gate)).toBe(true);
  });
});
