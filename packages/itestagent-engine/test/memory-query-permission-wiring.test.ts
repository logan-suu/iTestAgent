import { expect, test } from 'bun:test';
import { createMemoryQueryPermission } from '../src/memory-query-permission-wiring.js';
import { PermissionEngine } from '../src/permission-engine.js';

const resource = JSON.stringify({
  sessionId: '00000000-0000-4000-8000-000000000001',
  requestId: '00000000-0000-4000-8000-000000000002',
  strategy: 'pidReturn',
  commandSHA256: 'a'.repeat(64),
});
for (const effect of ['allow', 'deny'] as const)
  test(`query asks real engine once for ${effect}`, async () => {
    const engine = new PermissionEngine();
    let count = 0;
    const permission = createMemoryQueryPermission({
      engine,
      publishAsk: (ask) => {
        count++;
        expect(ask.summary).toContain('one Return pair');
        expect(ask.resource).toBe(resource);
        engine.resolve(ask.callId, effect, false);
      },
    });
    expect(await permission('interact_sensitive_ui', resource)).toEqual({
      effect,
      remembered: false,
    });
    expect(await permission('interact_sensitive_ui', resource)).toEqual({
      effect,
      remembered: false,
    });
    expect(count).toBe(2);
    expect(engine.getRules()).toEqual([]);
  });
for (const mode of ['before', 'during', 'publish', 'timeout'] as const)
  test(`query permission ${mode} clears its pending ask`, async () => {
    const engine = new PermissionEngine({ askTimeoutMs: 20 });
    const abort = new AbortController();
    let callId = '';
    let count = 0;
    if (mode === 'before') abort.abort();
    const permission = createMemoryQueryPermission({
      engine,
      publishAsk: (ask) => {
        count++;
        callId = ask.callId;
        if (mode === 'during') abort.abort();
        if (mode === 'publish') throw new Error('view unavailable');
      },
    });
    await expect(permission('interact_sensitive_ui', resource, abort.signal)).rejects.toThrow();
    expect(count).toBe(mode === 'before' ? 0 : 1);
    if (callId) {
      const pending = engine.requestPermission(callId, 'interact_sensitive_ui', resource);
      engine.resolve(callId, 'deny', false);
      expect(await pending).toEqual({ effect: 'deny', remembered: false });
    }
  });
test('persistent deny is quiet and an engine without high-risk asks cannot authorize query', async () => {
  for (const mode of ['deny', 'implicit-allow']) {
    const engine = new PermissionEngine(
      mode === 'implicit-allow' ? { highRiskActions: [] } : undefined,
    );
    if (mode === 'deny')
      engine.addRule({ action: 'interact_sensitive_ui', resource: '*', effect: 'deny' });
    let count = 0;
    const permission = createMemoryQueryPermission({
      engine,
      publishAsk: () => {
        count++;
      },
    });
    if (mode === 'deny')
      expect((await permission('interact_sensitive_ui', resource)).effect).toBe('deny');
    else
      await expect(permission('interact_sensitive_ui', resource)).rejects.toThrow('requires_ask');
    expect(count).toBe(0);
  }
});
