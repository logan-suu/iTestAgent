import { afterEach, beforeEach, describe, expect, it } from 'bun:test';

import type { BaselineListFilter, BaselineRecord } from 'itestagent-contracts';
import { buildBaselineKey, parseBaselineKey } from 'itestagent-contracts';

import { type FileSystem, createBaselineStore } from '../src/baseline-store.js';

// ─── In-Memory FileSystem Mock ────────────────────────────────

interface MockFileSystem {
  files: Map<string, string>;
  dirs: Set<string>;
  fs: FileSystem;
}

function createMockFileSystem(): MockFileSystem {
  const files = new Map<string, string>();
  const dirs = new Set<string>();

  return {
    files,
    dirs,
    fs: {
      async readFile(path: string, _encoding: 'utf-8'): Promise<string> {
        const content = files.get(path);
        if (content === undefined) throw new Error(`ENOENT: ${path}`);
        return content;
      },

      async writeFile(path: string, data: string, _encoding: 'utf-8'): Promise<void> {
        files.set(path, data);
      },

      async mkdir(path: string, _options?: { recursive: boolean }): Promise<string | undefined> {
        dirs.add(path);
        return undefined;
      },

      async exists(_path: string): Promise<boolean> {
        return files.has(_path) || dirs.has(_path);
      },

      async readdir(path: string): Promise<string[]> {
        const prefix = path.endsWith('/') ? path : `${path}/`;
        const results: string[] = [];
        for (const [filePath] of files) {
          if (filePath.startsWith(prefix)) {
            const relative = filePath.slice(prefix.length);
            if (!relative.includes('/')) {
              results.push(relative);
            }
          }
        }
        if (results.length === 0) {
          throw new Error(`ENOENT: no such directory: ${path}`);
        }
        return results;
      },

      async unlink(path: string): Promise<void> {
        if (!files.has(path)) throw new Error(`ENOENT: ${path}`);
        files.delete(path);
      },
    },
  };
}

// ─── Fixture Helpers ──────────────────────────────────────────

/** Create a valid physical baseline record (can override any field). */
function makePhysicalRecord(overrides?: Partial<BaselineRecord>): BaselineRecord {
  return {
    schemaVersion: 2,
    key: buildBaselineKey({
      projectId: 'myapp',
      targetKind: 'physical',
      deviceModel: 'iPhone16,2',
      iosVersion: '18.2',
      scenario: 'login-smoke',
    }),
    targetKind: 'physical',
    launchDurationMs: 1200,
    memoryPeakMB: 256,
    hangCount: 2,
    fpsApproximate: 58.5,
    approximate: true,
    updatedFromRun: 'run-001',
    createdAt: '2026-07-01T10:00:00.000Z',
    updatedAt: '2026-07-01T10:00:00.000Z',
    reachableRuns: ['run-001'],
    ...overrides,
  } satisfies BaselineRecord;
}

/** Create a valid simulator baseline record (can override any field). */
function makeSimulatorRecord(overrides?: Partial<BaselineRecord>): BaselineRecord {
  return {
    schemaVersion: 2,
    key: buildBaselineKey({
      projectId: 'myapp',
      targetKind: 'simulator',
      deviceModel: 'iPhone16,2',
      iosVersion: '18.2',
      scenario: 'login-smoke',
    }),
    targetKind: 'simulator',
    launchDurationMs: 800,
    memoryPeakMB: 180,
    hangCount: 0,
    fpsApproximate: 59.5,
    approximate: true,
    updatedFromRun: 'run-002',
    createdAt: '2026-07-01T11:00:00.000Z',
    updatedAt: '2026-07-01T11:00:00.000Z',
    reachableRuns: ['run-002'],
    comparisonScope: 'simulator_only',
    representativeOfPhysicalDevice: false,
    hostFingerprint: 'macOS-15.2-arm64',
    xcodeVersion: '16.2',
    runtimeIdentifier: 'com.apple.CoreSimulator.SimRuntime.iOS-18-2',
    ...overrides,
  } satisfies BaselineRecord;
}

// ─── Tests ────────────────────────────────────────────────────

describe('BaselineStore', () => {
  const STORE_ROOT = '/tmp/test-store-root';
  let mock: MockFileSystem;
  let store: ReturnType<typeof createBaselineStore>;

  beforeEach(() => {
    mock = createMockFileSystem();
    // Pre-create baseline directories so readdir won't throw for listing tests
    mock.dirs.add(`${STORE_ROOT}/baselines/physical`);
    mock.dirs.add(`${STORE_ROOT}/baselines/simulator`);
    store = createBaselineStore(STORE_ROOT, mock.fs);
  });

  afterEach(() => {
    // No-op: in-memory mock doesn't need cleanup
  });

  // ─── Factory ───────────────────────────────────────────────

  describe('createBaselineStore', () => {
    it('creates with explicit store root', () => {
      const s = createBaselineStore('/custom-root', mock.fs);
      expect(s).toBeDefined();
      expect(s.get).toBeFunction();
      expect(s.save).toBeFunction();
      expect(s.list).toBeFunction();
      expect(s.delete).toBeFunction();
    });

    it('accepts injected fileSystem and uses it for all I/O', async () => {
      const record = makePhysicalRecord();
      await store.save(record);

      const filePath = `${STORE_ROOT}/baselines/physical/${record.key}.json`;
      expect(mock.files.has(filePath)).toBe(true);
    });

    it('uses resolveStoreRoot() when storeRoot is not provided', async () => {
      const originalEnv = process.env.ITESTAGENT_HOME;
      process.env.ITESTAGENT_HOME = '/tmp/test-default-root';
      try {
        // Pre-populate dirs so readdir doesn't throw on list()
        mock.dirs.add('/tmp/test-default-root/baselines/physical');
        mock.dirs.add('/tmp/test-default-root/baselines/simulator');

        const s = createBaselineStore(undefined, mock.fs);
        const record = makePhysicalRecord();
        await s.save(record);

        const filePath = `/tmp/test-default-root/baselines/physical/${record.key}.json`;
        expect(mock.files.has(filePath)).toBe(true);
      } finally {
        process.env.ITESTAGENT_HOME = originalEnv;
      }
    });
  });

  // ─── get(key) ──────────────────────────────────────────────

  describe('get', () => {
    it('returns null when no baseline exists for key', async () => {
      const key = buildBaselineKey({
        projectId: 'myapp',
        targetKind: 'physical',
        deviceModel: 'iPhone16,2',
        iosVersion: '18.2',
        scenario: 'nonexistent',
      });
      const result = await store.get(key);
      expect(result).toBeNull();
    });

    it('returns parsed BaselineRecord when file exists and is valid', async () => {
      const record = makePhysicalRecord();
      await store.save(record);

      const result = await store.get(record.key);
      expect(result).not.toBeNull();
      expect(result?.key).toBe(record.key);
      expect(result?.targetKind).toBe('physical');
      expect(result?.launchDurationMs).toBe(1200);
      expect(result?.memoryPeakMB).toBe(256);
      expect(result?.hangCount).toBe(2);
      expect(result?.fpsApproximate).toBe(58.5);
      expect(result?.schemaVersion).toBe(2);
      expect(result?.reachableRuns).toEqual(['run-001']);
    });

    it('returns simulator record with all simulator-specific fields', async () => {
      const record = makeSimulatorRecord();
      await store.save(record);

      const result = await store.get(record.key);
      expect(result).not.toBeNull();
      expect(result?.targetKind).toBe('simulator');
      expect(result?.comparisonScope).toBe('simulator_only');
      expect(result?.representativeOfPhysicalDevice).toBe(false);
      expect(result?.hostFingerprint).toBe('macOS-15.2-arm64');
      expect(result?.xcodeVersion).toBe('16.2');
      expect(result?.runtimeIdentifier).toBe('com.apple.CoreSimulator.SimRuntime.iOS-18-2');
    });

    it('returns null when file exists but fails schema validation (corrupted JSON)', async () => {
      const key = buildBaselineKey({
        projectId: 'myapp',
        targetKind: 'physical',
        deviceModel: 'iPhone16,2',
        iosVersion: '18.2',
        scenario: 'corrupted',
      });

      // Write corrupted data directly to the file path
      const filePath = `${STORE_ROOT}/baselines/physical/${key}.json`;
      mock.files.set(filePath, JSON.stringify({ key, targetKind: 'physical' })); // missing required fields
      // Ensure the physical dir is in the mock
      mock.dirs.add(`${STORE_ROOT}/baselines/physical`);

      const result = await store.get(key);
      expect(result).toBeNull();
    });

    it('returns null when file contains invalid JSON', async () => {
      const key = buildBaselineKey({
        projectId: 'myapp',
        targetKind: 'physical',
        deviceModel: 'iPhone16,2',
        iosVersion: '18.2',
        scenario: 'badjson',
      });

      const filePath = `${STORE_ROOT}/baselines/physical/${key}.json`;
      mock.files.set(filePath, 'not-json{{{');
      mock.dirs.add(`${STORE_ROOT}/baselines/physical`);

      const result = await store.get(key);
      expect(result).toBeNull();
    });

    it('returns null for invalid key format (wrong number of segments)', async () => {
      const result = await store.get('too|few|parts');
      expect(result).toBeNull();
    });

    it('returns null for key with invalid targetKind value', async () => {
      // parseBaselineKey returns null when targetKind is not 'physical' or 'simulator'
      const result = await store.get('proj|android|iPhone|18.2|scenario');
      expect(result).toBeNull();
    });

    it('throws when stored record targetKind does not match key targetKind (cross-domain guard)', async () => {
      // Create a physical key but store a record with simulator targetKind
      const key = buildBaselineKey({
        projectId: 'myapp',
        targetKind: 'physical',
        deviceModel: 'iPhone16,2',
        iosVersion: '18.2',
        scenario: 'mismatched',
      });

      // Write a simulator record under the physical key file path
      const simRecord = makeSimulatorRecord({ key });
      // Note: targetKind is still 'simulator' but stored in physical directory
      const filePath = `${STORE_ROOT}/baselines/physical/${key}.json`;
      mock.files.set(filePath, JSON.stringify(simRecord, null, 2));
      mock.dirs.add(`${STORE_ROOT}/baselines/physical`);

      // assertTargetKindMatch throws because key says physical but record says simulator
      expect(store.get(key)).rejects.toThrow();
    });
  });

  // ─── save(record) ──────────────────────────────────────────

  describe('save', () => {
    it('saves a valid physical baseline record', async () => {
      const record = makePhysicalRecord();
      await store.save(record);

      const filePath = `${STORE_ROOT}/baselines/physical/${record.key}.json`;
      expect(mock.files.has(filePath)).toBe(true);

      const raw = mock.files.get(filePath);
      expect(raw).toBeDefined();
      const written = JSON.parse(raw as string);
      expect(written.schemaVersion).toBe(2);
      expect(written.key).toBe(record.key);
      expect(written.targetKind).toBe('physical');
      expect(written.launchDurationMs).toBe(1200);
    });

    it('saves a valid simulator baseline record with extra simulator-only fields', async () => {
      const record = makeSimulatorRecord();
      await store.save(record);

      const filePath = `${STORE_ROOT}/baselines/simulator/${record.key}.json`;
      expect(mock.files.has(filePath)).toBe(true);

      const simRaw = mock.files.get(filePath);
      expect(simRaw).toBeDefined();
      const written = JSON.parse(simRaw as string);
      expect(written.comparisonScope).toBe('simulator_only');
      expect(written.representativeOfPhysicalDevice).toBe(false);
      expect(written.hostFingerprint).toBe('macOS-15.2-arm64');
      expect(written.xcodeVersion).toBe('16.2');
    });

    it('writes JSON with pretty-print (2-space indent)', async () => {
      const record = makePhysicalRecord();
      await store.save(record);

      const filePath = `${STORE_ROOT}/baselines/physical/${record.key}.json`;
      const raw = mock.files.get(filePath);
      if (!raw) throw new Error('expected file to exist');
      // Pretty-printed JSON starts with "{\n  "
      expect(raw).toStartWith('{\n  ');
      // Verify it contains indented fields
      expect(raw).toInclude('\n  "schemaVersion"');
    });

    it('stores physical records in baselines/physical/ subdirectory', async () => {
      const record = makePhysicalRecord();
      await store.save(record);

      const filePath = `${STORE_ROOT}/baselines/physical/${record.key}.json`;
      expect(mock.files.has(filePath)).toBe(true);
      expect(mock.dirs.has(`${STORE_ROOT}/baselines/physical`)).toBe(true);
    });

    it('stores simulator records in baselines/simulator/ subdirectory', async () => {
      const record = makeSimulatorRecord();
      await store.save(record);

      const filePath = `${STORE_ROOT}/baselines/simulator/${record.key}.json`;
      expect(mock.files.has(filePath)).toBe(true);
      expect(mock.dirs.has(`${STORE_ROOT}/baselines/simulator`)).toBe(true);
    });

    it('creates the targetKind subdirectory if it does not exist', async () => {
      // Remove pre-created dir
      mock.dirs.delete(`${STORE_ROOT}/baselines/physical`);

      const record = makePhysicalRecord();
      await store.save(record);

      expect(mock.dirs.has(`${STORE_ROOT}/baselines/physical`)).toBe(true);
    });

    it('overwrites an existing baseline record for the same key', async () => {
      const record = makePhysicalRecord();
      await store.save(record);

      const updated = makePhysicalRecord({
        launchDurationMs: 999,
        updatedAt: '2026-07-02T10:00:00.000Z',
      });
      await store.save(updated);

      const result = await store.get(record.key);
      expect(result?.launchDurationMs).toBe(999);
      expect(result?.updatedAt).toBe('2026-07-02T10:00:00.000Z');
    });

    // ─── Cross-domain guard (ADR-011) ─────────────────────────

    it('rejects record where key targetKind does not match record.targetKind (key=physical, record=simulator)', async () => {
      const physicalKey = buildBaselineKey({
        projectId: 'myapp',
        targetKind: 'physical',
        deviceModel: 'iPhone16,2',
        iosVersion: '18.2',
        scenario: 'mismatched',
      });
      const record = makeSimulatorRecord({ key: physicalKey });
      // record.targetKind is still 'simulator', but key says 'physical'

      expect(store.save(record)).rejects.toThrow();
    });

    it('rejects record where key targetKind does not match record.targetKind (key=simulator, record=physical)', async () => {
      const simKey = buildBaselineKey({
        projectId: 'myapp',
        targetKind: 'simulator',
        deviceModel: 'iPhone16,2',
        iosVersion: '18.2',
        scenario: 'mismatched',
      });
      const record = makePhysicalRecord({
        key: simKey,
        targetKind: 'physical',
      });

      expect(store.save(record)).rejects.toThrow();
    });

    it('rejects record with invalid key format (too few pipe segments)', async () => {
      const record = makePhysicalRecord({ key: 'too|few' });
      expect(store.save(record)).rejects.toThrow('Invalid baseline key format');
    });
  });

  // ─── list(filter?) ─────────────────────────────────────────

  describe('list', () => {
    it('lists all baselines when no filter is provided', async () => {
      const phys = makePhysicalRecord();
      const sim = makeSimulatorRecord();
      await store.save(phys);
      await store.save(sim);

      const results = await store.list();
      expect(results).toHaveLength(2);

      const keys = results.map((r) => r.key);
      expect(keys).toContain(phys.key);
      expect(keys).toContain(sim.key);
    });

    it('returns empty array when no baselines exist', async () => {
      // No records saved
      const results = await store.list();
      expect(results).toEqual([]);
    });

    it('filters by targetKind=physical — returns only physical baselines', async () => {
      const phys1 = makePhysicalRecord();
      const phys2 = makePhysicalRecord({
        key: buildBaselineKey({
          projectId: 'myapp',
          targetKind: 'physical',
          deviceModel: 'iPhone16,2',
          iosVersion: '18.2',
          scenario: 'checkout-flow',
        }),
        reachableRuns: ['run-checkout'],
      });
      const sim = makeSimulatorRecord();
      await store.save(phys1);
      await store.save(phys2);
      await store.save(sim);

      const results = await store.list({ targetKind: 'physical' });
      expect(results).toHaveLength(2);
      for (const r of results) {
        expect(r.targetKind).toBe('physical');
      }
    });

    it('filters by targetKind=simulator — returns only simulator baselines', async () => {
      const phys = makePhysicalRecord();
      const sim = makeSimulatorRecord();
      await store.save(phys);
      await store.save(sim);

      const results = await store.list({ targetKind: 'simulator' });
      expect(results).toHaveLength(1);
      expect(results[0]?.targetKind).toBe('simulator');
      expect(results[0]?.key).toBe(sim.key);
    });

    it('filters by projectId', async () => {
      const phys1 = makePhysicalRecord(); // projectId=myapp
      const phys2 = makePhysicalRecord({
        key: buildBaselineKey({
          projectId: 'other-app',
          targetKind: 'physical',
          deviceModel: 'iPhone16,2',
          iosVersion: '18.2',
          scenario: 'login-smoke',
        }),
        reachableRuns: ['run-other'],
      });
      await store.save(phys1);
      await store.save(phys2);

      const results = await store.list({ projectId: 'myapp' });
      expect(results).toHaveLength(1);
      expect(results[0]?.key).toBe(phys1.key);
    });

    it('filters by scenario', async () => {
      const phys1 = makePhysicalRecord(); // scenario=login-smoke
      const phys2 = makePhysicalRecord({
        key: buildBaselineKey({
          projectId: 'myapp',
          targetKind: 'physical',
          deviceModel: 'iPhone16,2',
          iosVersion: '18.2',
          scenario: 'checkout-flow',
        }),
        reachableRuns: ['run-checkout'],
      });
      await store.save(phys1);
      await store.save(phys2);

      const results = await store.list({ scenario: 'checkout-flow' });
      expect(results).toHaveLength(1);
      expect(results[0]?.key).toContain('checkout-flow');
    });

    it('returns empty array when no baselines match filter', async () => {
      const phys = makePhysicalRecord();
      await store.save(phys);

      const results = await store.list({ projectId: 'nonexistent-app' });
      expect(results).toEqual([]);
    });

    it('returns baselines sorted by updatedAt descending (most recent first)', async () => {
      const older = makePhysicalRecord({
        key: buildBaselineKey({
          projectId: 'myapp',
          targetKind: 'physical',
          deviceModel: 'iPhone16,2',
          iosVersion: '18.2',
          scenario: 'older',
        }),
        updatedAt: '2026-07-01T10:00:00.000Z',
        reachableRuns: ['run-older'],
      });
      const newer = makePhysicalRecord({
        key: buildBaselineKey({
          projectId: 'myapp',
          targetKind: 'physical',
          deviceModel: 'iPhone16,2',
          iosVersion: '18.2',
          scenario: 'newer',
        }),
        updatedAt: '2026-07-05T10:00:00.000Z',
        reachableRuns: ['run-newer'],
      });
      await store.save(older);
      await store.save(newer);

      const results = await store.list();
      expect(results).toHaveLength(2);
      expect(results[0]?.key).toBe(newer.key);
      expect(results[1]?.key).toBe(older.key);
    });

    it('skips corrupted files silently during listing', async () => {
      // Save a valid record
      const valid = makePhysicalRecord();
      await store.save(valid);

      // Inject a corrupted file directly into the mock
      const corruptedKey = buildBaselineKey({
        projectId: 'myapp',
        targetKind: 'physical',
        deviceModel: 'iPhone16,2',
        iosVersion: '18.2',
        scenario: 'corrupted',
      });
      const corruptedPath = `${STORE_ROOT}/baselines/physical/${corruptedKey}.json`;
      mock.files.set(corruptedPath, '{bad json');

      const results = await store.list();
      expect(results).toHaveLength(1);
      expect(results[0]?.key).toBe(valid.key);
    });

    it('skips records with wrong targetKind in their data during listing (cross-domain guard)', async () => {
      const valid = makePhysicalRecord();
      await store.save(valid);

      // Inject a record in physical directory but with targetKind='simulator'
      const mismatchKey = buildBaselineKey({
        projectId: 'myapp',
        targetKind: 'physical',
        deviceModel: 'iPhone16,2',
        iosVersion: '18.2',
        scenario: 'mismatch',
      });
      const mismatchPath = `${STORE_ROOT}/baselines/physical/${mismatchKey}.json`;
      mock.files.set(
        mismatchPath,
        JSON.stringify(makeSimulatorRecord({ key: mismatchKey, targetKind: 'simulator' }), null, 2),
      );

      const results = await store.list();
      expect(results).toHaveLength(1);
      expect(results[0]?.key).toBe(valid.key);
    });

    it('handles directory not existing gracefully for missing targetKind', async () => {
      // Remove simulator dir from mock
      mock.dirs.delete(`${STORE_ROOT}/baselines/simulator`);

      // Only save a physical record
      const phys = makePhysicalRecord();
      await store.save(phys);

      // list() iterates both physical and simulator — simulator dir missing → skip
      const results = await store.list();
      expect(results).toHaveLength(1);
      expect(results[0]?.key).toBe(phys.key);
    });
  });

  // ─── delete(key) ───────────────────────────────────────────

  describe('delete', () => {
    it('deletes an existing baseline', async () => {
      const record = makePhysicalRecord();
      await store.save(record);

      let result = await store.get(record.key);
      expect(result).not.toBeNull();

      await store.delete(record.key);

      result = await store.get(record.key);
      expect(result).toBeNull();
    });

    it('no-ops for non-existent key', async () => {
      const key = buildBaselineKey({
        projectId: 'myapp',
        targetKind: 'physical',
        deviceModel: 'iPhone16,2',
        iosVersion: '18.2',
        scenario: 'nonexistent',
      });

      // Should not throw
      await expect(store.delete(key)).resolves.toBeUndefined();
    });

    it('no-ops for invalid key format', async () => {
      // Should not throw
      await expect(store.delete('invalid-key')).resolves.toBeUndefined();
    });

    it('no-ops for key with invalid targetKind', async () => {
      // parseBaselineKey returns null → no-op
      await expect(store.delete('proj|android|iPhone|18.2|scenario')).resolves.toBeUndefined();
    });

    it('only deletes the specified baseline, leaving others intact', async () => {
      const record1 = makePhysicalRecord();
      const record2 = makePhysicalRecord({
        key: buildBaselineKey({
          projectId: 'myapp',
          targetKind: 'physical',
          deviceModel: 'iPhone16,2',
          iosVersion: '18.2',
          scenario: 'other-scenario',
        }),
        reachableRuns: ['run-other'],
      });
      await store.save(record1);
      await store.save(record2);

      await store.delete(record1.key);

      const results = await store.list();
      expect(results).toHaveLength(1);
      expect(results[0]?.key).toBe(record2.key);
    });
  });

  // ─── buildBaselineKey + parseBaselineKey Round-trip ────────

  describe('buildBaselineKey & parseBaselineKey', () => {
    it('round-trips: build → parse returns same components', () => {
      const components = {
        projectId: 'myapp',
        targetKind: 'physical' as const,
        deviceModel: 'iPhone16,2',
        iosVersion: '18.2',
        scenario: 'login-smoke',
      };

      const key = buildBaselineKey(components);
      const parsed = parseBaselineKey(key);

      expect(parsed).not.toBeNull();
      expect(parsed?.projectId).toBe(components.projectId);
      expect(parsed?.targetKind).toBe(components.targetKind);
      expect(parsed?.deviceModel).toBe(components.deviceModel);
      expect(parsed?.iosVersion).toBe(components.iosVersion);
      expect(parsed?.scenario).toBe(components.scenario);
    });

    it('round-trips with simulator targetKind', () => {
      const components = {
        projectId: 'myapp',
        targetKind: 'simulator' as const,
        deviceModel: 'iPhone16,2',
        iosVersion: '18.2',
        scenario: 'login-smoke',
      };

      const key = buildBaselineKey(components);
      const parsed = parseBaselineKey(key);

      expect(parsed).not.toBeNull();
      expect(parsed?.targetKind).toBe('simulator');
    });

    it('sanitizes pipe characters in components', () => {
      const key = buildBaselineKey({
        projectId: 'my|app',
        targetKind: 'physical',
        deviceModel: 'iPhone|16,2',
        iosVersion: '18.2',
        scenario: 'login|smoke',
      });

      expect(key).toBe('my-app|physical|iPhone-16,2|18.2|login-smoke');

      const parsed = parseBaselineKey(key);
      expect(parsed).not.toBeNull();
      expect(parsed?.projectId).toBe('my-app');
      expect(parsed?.deviceModel).toBe('iPhone-16,2');
      expect(parsed?.scenario).toBe('login-smoke');
    });

    it('parseBaselineKey returns null for wrong number of segments (too few)', () => {
      expect(parseBaselineKey('a|b')).toBeNull();
      expect(parseBaselineKey('a|b|c')).toBeNull();
      expect(parseBaselineKey('a|b|c|d')).toBeNull();
    });

    it('parseBaselineKey returns null for wrong number of segments (too many)', () => {
      expect(parseBaselineKey('a|b|c|d|e|f')).toBeNull();
      expect(parseBaselineKey('a|b|c|d|e|f|g')).toBeNull();
    });

    it('parseBaselineKey returns null for empty segments', () => {
      expect(parseBaselineKey('||iPhone|18.2|scenario')).toBeNull();
      expect(parseBaselineKey('myapp||iPhone|18.2|scenario')).toBeNull();
      expect(parseBaselineKey('myapp|physical||18.2|scenario')).toBeNull();
    });

    it('parseBaselineKey returns null for invalid targetKind value', () => {
      expect(parseBaselineKey('myapp|android|iPhone|18.2|scenario')).toBeNull();
      expect(parseBaselineKey('myapp|unknown|iPhone|18.2|scenario')).toBeNull();
    });
  });
});
