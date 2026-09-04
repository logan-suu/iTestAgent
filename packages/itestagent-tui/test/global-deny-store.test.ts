import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  listGlobalDeniedRules,
  persistGlobalDeniedRule,
  revokeGlobalDeniedRule,
} from '../src/global-deny-store.js';

const homes: string[] = [];

afterEach(async () => {
  await Promise.all(homes.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

async function tempHome(): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), 'itestagent-deny-store-'));
  homes.push(path);
  return path;
}

describe('global deny store', () => {
  test('persists, deduplicates, lists, and revokes an exact deny rule', async () => {
    const home = await tempHome();
    const rule = { action: 'uninstall_app', resource: 'com.example', effect: 'deny' } as const;
    await persistGlobalDeniedRule(rule, home);
    await persistGlobalDeniedRule(rule, home);
    expect(await listGlobalDeniedRules(home)).toEqual([rule]);
    expect(await revokeGlobalDeniedRule(rule.action, rule.resource, home)).toBe(true);
    expect(await listGlobalDeniedRules(home)).toEqual([]);
    expect(await revokeGlobalDeniedRule(rule.action, rule.resource, home)).toBe(false);
  });

  test('rejects an allow rule', async () => {
    const home = await tempHome();
    await expect(
      persistGlobalDeniedRule({ action: 'uninstall_app', resource: '*', effect: 'allow' }, home),
    ).rejects.toThrow('Only deny rules');
  });
});
