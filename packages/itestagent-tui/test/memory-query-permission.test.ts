import { expect, test } from 'bun:test';
import { PermissionEngine } from 'itestagent-engine';
import type { TuiStatePatch } from '../src/agent-session.js';
import { createTuiMemoryQueryPermission } from '../src/memory-query-permission.js';

const resource = JSON.stringify({
  sessionId: crypto.randomUUID(),
  requestId: crypto.randomUUID(),
  strategy: 'pidReturn',
  commandSHA256: 'a'.repeat(64),
});
for (const mode of ['allow', 'deny', 'abort', 'timeout', 'publish-failure', 'resolved-failure'])
  test(`query UI clears one ask for ${mode}`, async () => {
    const engine = new PermissionEngine({ askTimeoutMs: 15 });
    const pendingIds = new Set<string>();
    const pending = new Map<string, { action: string; resource: string }>();
    const patches: TuiStatePatch[] = [];
    const controller = new AbortController();
    let id = '';
    const permission = createTuiMemoryQueryPermission({
      engine,
      pendingIds,
      pending,
      publish(patch) {
        patches.push(patch);
        if (mode === 'publish-failure' && patch.type === 'message_add')
          throw new Error('view unavailable');
        if (mode === 'resolved-failure' && patch.type === 'permission_resolved')
          throw new Error('view unavailable');
        if (patch.type === 'permission_request') {
          id = patch.payload.callId as string;
          expect(pendingIds.has(id)).toBe(true);
          if (mode === 'abort') controller.abort();
          else if (mode !== 'timeout')
            engine.resolve(id, mode === 'deny' ? 'deny' : 'allow', false);
        }
      },
    });
    const result = permission('interact_sensitive_ui', resource, controller.signal);
    if (mode === 'allow' || mode === 'deny') expect((await result).effect).toBe(mode);
    else await expect(result).rejects.toThrow();
    expect(pendingIds.size).toBe(0);
    expect(pending.size).toBe(0);
    expect(patches.filter((x) => x.type === 'permission_resolved')).toHaveLength(1);
    expect(patches.filter((x) => x.type === 'activity_update')).toHaveLength(1);
    if (id) {
      engine.resolve(id, 'allow', false);
      expect(pending.size).toBe(0);
    }
  });
