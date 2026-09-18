import { expect, test } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, renameSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { MemoryResourceClosure } from '../src/xcode-memory-resource-closure.js';
import {
  type MemoryProcessIdentity,
  reserveXcodeMemoryLease,
} from '../src/xcode-memory-session.js';
const identity: MemoryProcessIdentity = {
  deviceId: 'fixture-device',
  bundleId: 'com.itestagent.fixture',
  buildReference: 'fixture-build',
  executable: 'fixture',
  pid: 123,
  generation: 'fixture-generation',
};
const target = {
  deviceId: identity.deviceId,
  bundleId: identity.bundleId,
  buildReference: identity.buildReference,
  executable: identity.executable,
};
test('owner-local early failure proof releases only its exact lease once', () => {
  const root = mkdtempSync('/private/tmp/itestagent-ledger-');
  try {
    const lease = reserveXcodeMemoryLease(root);
    const helper = lease.resources.begin('helper');
    const instance = {};
    let exited = false;
    lease.resources.acquired(
      helper,
      instance,
      () => true,
      () => exited,
    );
    expect(() => lease.resources.prove()).toThrow();
    expect(() =>
      lease.releaseResources({ protocolVersion: 3, sessionId: lease.sessionId }),
    ).toThrow();
    exited = true;
    lease.resources.closed(helper, instance);
    const proof = lease.resources.prove();
    expect(() => lease.releaseResources({ ...proof })).toThrow();
    lease.releaseResources(proof);
    expect(existsSync(join(root, 'xcode-memory-session.lock'))).toBe(false);
    expect(() => lease.releaseResources(proof)).toThrow();
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
for (const resource of ['launcher', 'helper', 'xcode', 'document', 'debugger', 'aut'] as const)
  test(`pending ${resource} cannot be relabeled not-created`, () => {
    const ledger = new MemoryResourceClosure(crypto.randomUUID());
    const ticket = ledger.begin(resource);
    expect(() => ledger.begin(resource)).toThrow();
    expect(() => ledger.prove()).toThrow();
    ledger.unknown(ticket);
    expect(() => ledger.prove()).toThrow();
    expect(() =>
      ledger.acquired(
        ticket,
        {},
        () => true,
        () => true,
      ),
    ).toThrow();
  });
test('physical identity must match the expected target, original instance and full resource closure', () => {
  const ledger = new MemoryResourceClosure(crypto.randomUUID(), target);
  expect(() => ledger.bindIdentity({ ...identity, deviceId: 'other' })).toThrow();
  ledger.bindIdentity(identity);
  expect(() => ledger.bindIdentity({ ...identity, generation: 'replacement' })).toThrow();
  expect(() => ledger.prove()).toThrow();
  for (const resource of ['launcher', 'helper', 'xcode', 'document', 'debugger', 'aut'] as const) {
    const ticket = ledger.begin(resource);
    const instance = {};
    ledger.acquired(
      ticket,
      instance,
      () => true,
      () => true,
    );
    expect(() => ledger.closed(ticket, {}, identity)).toThrow();
    ledger.closed(ticket, instance, identity);
  }
  const proof = ledger.prove();
  ledger.consume(proof);
  expect(() => ledger.consume(proof)).toThrow();
});
test('unverified exits and missing physical generation retain the reservation', () => {
  for (const mode of ['unobserved', 'no-identity', 'wrong-identity']) {
    const ledger = new MemoryResourceClosure(crypto.randomUUID(), target);
    const resource = mode === 'unobserved' ? 'helper' : 'aut';
    const ticket = ledger.begin(resource);
    const instance = {};
    ledger.acquired(
      ticket,
      instance,
      () => true,
      () => mode !== 'unobserved',
    );
    if (mode === 'wrong-identity') ledger.bindIdentity(identity);
    expect(() =>
      ledger.closed(
        ticket,
        instance,
        mode === 'wrong-identity' ? { ...identity, generation: 'wrong' } : undefined,
      ),
    ).toThrow();
    expect(ledger.snapshot()[resource]).toBe('unknown');
    expect(() => ledger.prove()).toThrow();
  }
});
test('resource proof cannot delete a replaced lease', () => {
  const root = mkdtempSync('/private/tmp/itestagent-ledger-');
  try {
    const lease = reserveXcodeMemoryLease(root);
    const proof = lease.resources.prove();
    const path = join(root, 'xcode-memory-session.lock');
    renameSync(path, `${path}.original`);
    mkdirSync(path, { mode: 0o700 });
    expect(() => lease.releaseResources(proof)).toThrow('lease_changed');
    expect(existsSync(path)).toBe(true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

for (const pending of ['debugger', 'aut'] as const) {
  test(`owner and documents closed do not prove ${pending} exit`, () => {
    const ledger = new MemoryResourceClosure(crypto.randomUUID());
    const unresolved = ledger.begin(pending);
    for (const resource of ['xcode', 'document'] as const) {
      const ticket = ledger.begin(resource);
      const instance = {};
      ledger.acquired(
        ticket,
        instance,
        () => true,
        () => true,
      );
      ledger.closed(ticket, instance);
    }
    expect(ledger.snapshot().document).toBe('closed');
    expect(() => ledger.prove()).toThrow('closure.incomplete');
    ledger.unknown(unresolved);
    expect(() => ledger.prove()).toThrow('closure.incomplete');
  });
}
