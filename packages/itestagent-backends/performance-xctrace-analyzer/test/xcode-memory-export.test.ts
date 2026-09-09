import { expect, test } from 'bun:test';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { verifyMemoryExport } from '../src/xcode-memory-export.js';
import { MemorySessionProtocol } from '../src/xcode-memory-session.js';

const target = {
  deviceId: 'fixture',
  bundleId: 'example.fixture',
  buildReference: 'fixture-build',
  executable: '/fixture/app',
};
function preparedExport() {
  const protocol = new MemorySessionProtocol(randomUUID(), target);
  for (const [i, state] of ['preparing', 'prepared', 'capturing', 'exported'].entries()) {
    protocol.accept(
      JSON.stringify({ protocolVersion: 2, sessionId: protocol.sessionId, sequence: i + 1, state }),
      { status: 'verified', identity: { ...target, pid: 42, generation: 'fixture-only' } },
    );
  }
  return protocol;
}
test('binds a private new export to an acknowledged capture interval without exposing bytes', async () => {
  const directory = realpathSync(mkdtempSync(join(tmpdir(), 'memory-export-')));
  try {
    const started = Date.now() - 100;
    writeFileSync(join(directory, 'snapshot.memgraph'), 'fixture-content', {
      flag: 'wx',
      mode: 0o600,
    });
    const input = {
      directory,
      fileName: 'snapshot.memgraph',
      captureStartedAt: started,
      captureEndedAt: Date.now(),
      protocol: preparedExport(),
    };
    const result = await verifyMemoryExport(input);
    expect(result.bytes).toBe(15);
    expect(result.sha256).toHaveLength(64);
    const cancelled = preparedExport();
    cancelled.cancel();
    await expect(verifyMemoryExport({ ...input, protocol: cancelled })).rejects.toThrow(
      'cancelled',
    );
    expect(JSON.stringify(result)).not.toContain('fixture-content');
    await expect(
      verifyMemoryExport({ ...input, captureStartedAt: Date.now() + 1 }),
    ).rejects.toThrow('capture_interval_invalid');
    await expect(
      verifyMemoryExport({ ...input, protocol: new MemorySessionProtocol(randomUUID(), target) }),
    ).rejects.toThrow('export_unconfirmed');
    await expect(verifyMemoryExport({ ...input, signal: AbortSignal.abort() })).rejects.toThrow(
      'cancelled',
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
test('rejects old files, traversal, links and empty output', async () => {
  const directory = realpathSync(mkdtempSync(join(tmpdir(), 'memory-export-')));
  try {
    writeFileSync(join(directory, 'empty.memgraph'), '', { mode: 0o600 });
    symlinkSync(join(directory, 'empty.memgraph'), join(directory, 'linked.memgraph'));
    const input = {
      directory,
      fileName: 'empty.memgraph',
      captureStartedAt: Date.now() - 100,
      captureEndedAt: Date.now(),
      protocol: preparedExport(),
    };
    await expect(verifyMemoryExport(input)).rejects.toThrow('export_invalid');
    await expect(verifyMemoryExport({ ...input, fileName: '../outside.memgraph' })).rejects.toThrow(
      'export_path_invalid',
    );
    await expect(verifyMemoryExport({ ...input, fileName: 'linked.memgraph' })).rejects.toThrow();
    writeFileSync(join(directory, 'old.memgraph'), 'fixture', { mode: 0o600 });
    const future = Date.now() + 30;
    await Bun.sleep(40);
    await expect(
      verifyMemoryExport({
        ...input,
        fileName: 'old.memgraph',
        captureStartedAt: future,
        captureEndedAt: Date.now(),
      }),
    ).rejects.toThrow('export_invalid');
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
