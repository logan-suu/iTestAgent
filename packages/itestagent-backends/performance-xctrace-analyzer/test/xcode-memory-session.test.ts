import { describe, expect, test } from 'bun:test';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  type MemoryIdentityObservation,
  MemorySessionProtocol,
  metadataMemoryIdentity,
  reserveXcodeMemoryLease,
} from '../src/xcode-memory-session.js';

const target = {
  deviceId: 'fixture-device',
  bundleId: 'example.fixture',
  buildReference: 'fixture-build',
  executable: '/fixture/app',
};
const proof: MemoryIdentityObservation = {
  status: 'verified',
  identity: {
    deviceId: 'fixture-device',
    bundleId: 'example.fixture',
    buildReference: 'fixture-build',
    executable: '/fixture/app',
    pid: 42,
    generation: 'fixture-generation',
  },
};
function fixture() {
  const protocol = new MemorySessionProtocol(randomUUID(), target);
  const event = (sequence: number, state: string, extra = {}) =>
    JSON.stringify({
      protocolVersion: 2,
      sessionId: protocol.sessionId,
      sequence,
      state,
      ...extra,
    });
  return { protocol, event };
}

describe('memory session protocol', () => {
  test('requires generation evidence before prepared; missing proof does not consume sequence', () => {
    const { protocol, event } = fixture();
    protocol.accept(event(1, 'preparing'));
    expect(() => protocol.accept(event(2, 'prepared'), metadataMemoryIdentity())).toThrow(
      'target_identity_unverifiable',
    );
    expect(protocol.state).toBe('preparing');
    protocol.accept(event(2, 'prepared'), proof);
    expect(protocol.state).toBe('prepared');
  });
  test('rejects PID reuse and target drift before export', () => {
    const { protocol, event } = fixture();
    protocol.accept(event(1, 'preparing'));
    protocol.accept(event(2, 'prepared'), proof);
    if (proof.status !== 'verified') throw new Error('fixture');
    for (const change of [
      { generation: 'reused' },
      { pid: 43 },
      { deviceId: 'other' },
      { buildReference: 'other' },
    ]) {
      expect(() =>
        protocol.verifyTarget({ status: 'verified', identity: { ...proof.identity, ...change } }),
      ).toThrow('target_changed');
    }
    protocol.accept(event(3, 'capturing'), proof);
    expect(() => protocol.accept(event(4, 'exported'))).toThrow('target_identity_unverifiable');
    expect(protocol.state).toBe('capturing');
  });
  test('rejects stale, repeated, out-of-order and raw payloads', () => {
    const { protocol, event } = fixture();
    for (const raw of [
      event(2, 'preparing'),
      event(1, 'exported'),
      event(1, 'preparing', { rawAX: 'private' }),
      '{}',
      'x'.repeat(1025),
      event(1, 'preparing', { sessionId: randomUUID() }),
    ]) {
      expect(() => protocol.accept(raw)).toThrow();
      expect(protocol.state).toBe('preflight');
    }
    protocol.accept(event(1, 'preparing'));
    expect(() => protocol.accept(event(1, 'preparing'))).toThrow('protocol_invalid');
  });
  test('cancellation allows only teardown; output alone never proves cleanup', () => {
    const { protocol, event } = fixture();
    protocol.accept(event(1, 'preparing'));
    protocol.accept(event(2, 'prepared'), proof);
    protocol.cancel();
    expect(() => protocol.accept(event(3, 'capturing'), proof)).toThrow('cancelled');
    expect(() => protocol.verifyTarget(proof)).toThrow('cancelled');
    protocol.accept(event(3, 'closing'));
    expect(() => protocol.accept(event(4, 'closed'))).toThrow('protocol_invalid');
    protocol.accept(event(4, 'closed', { cleanupVerified: false }));
    expect(protocol.cleanupVerified).toBe(false);
    expect(() => protocol.accept(event(5, 'preparing'))).toThrow();
  });
  test('successful export still requires verified terminal teardown', () => {
    const { protocol, event } = fixture();
    for (const [i, state] of [
      'preparing',
      'prepared',
      'capturing',
      'exported',
      'closing',
    ].entries())
      protocol.accept(event(i + 1, state), proof);
    expect(protocol.cleanupVerified).toBe(false);
    protocol.accept(event(6, 'closed', { cleanupVerified: true }));
    expect(protocol.cleanupVerified).toBe(true);
  });
});

describe('global Xcode lease', () => {
  test('blocks concurrent versions, retains uncertain cleanup and releases only matched owner', () => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), 'memory-session-')));
    try {
      const lease = reserveXcodeMemoryLease(root);
      const protocol = new MemorySessionProtocol(lease.sessionId, target);
      expect(() => reserveXcodeMemoryLease(root)).toThrow('instance_conflict');
      expect(() => lease.release(protocol)).toThrow('cleanup_unverified');
      for (const [i, state] of ['closing', 'closed'].entries())
        protocol.accept(
          JSON.stringify({
            protocolVersion: 2,
            sessionId: lease.sessionId,
            sequence: i + 1,
            state,
            ...(state === 'closed' ? { cleanupVerified: true } : {}),
          }),
        );
      expect(() => lease.release(new MemorySessionProtocol(randomUUID(), target))).toThrow(
        'cleanup_unverified',
      );
      lease.release(protocol);
      expect(existsSync(join(root, 'xcode-memory-session.lock'))).toBe(false);
      lease.release(protocol);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
  test('never deletes a changed owner marker', () => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), 'memory-session-')));
    try {
      const lease = reserveXcodeMemoryLease(root);
      const protocol = new MemorySessionProtocol(lease.sessionId, target);
      protocol.accept(
        JSON.stringify({
          protocolVersion: 2,
          sessionId: lease.sessionId,
          sequence: 1,
          state: 'closing',
        }),
      );
      protocol.accept(
        JSON.stringify({
          protocolVersion: 2,
          sessionId: lease.sessionId,
          sequence: 2,
          state: 'closed',
          cleanupVerified: true,
        }),
      );
      writeFileSync(join(root, 'xcode-memory-session.lock/owner.json'), '{}');
      expect(() => lease.release(protocol)).toThrow('lease_changed');
      expect(() => reserveXcodeMemoryLease(root)).toThrow('instance_conflict');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
