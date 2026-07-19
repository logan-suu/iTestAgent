import { describe, expect, it } from 'bun:test';
import { join } from 'node:path';
import { createXcodeProjAnalyzerBackend } from '../src/index';

const FIXTURE_ROOT = join(import.meta.dir, 'fixtures', 'sample-project');

describe('createXcodeProjAnalyzerBackend', () => {
  it('creates a backend with all required methods', () => {
    const backend = createXcodeProjAnalyzerBackend();

    expect(backend.discover).toBeDefined();
    expect(typeof backend.discover).toBe('function');

    expect(backend.graph).toBeDefined();
    expect(typeof backend.graph).toBe('function');

    expect(backend.buildSettings).toBeDefined();
    expect(typeof backend.buildSettings).toBe('function');

    expect(backend.scanSources).toBeDefined();
    expect(typeof backend.scanSources).toBe('function');

    expect(backend.scanResources).toBeDefined();
    expect(typeof backend.scanResources).toBe('function');
  });

  it('scanSources returns SourceFacts with correct shape (task 2.2)', async () => {
    const backend = createXcodeProjAnalyzerBackend();
    const result = await backend.scanSources({ root: FIXTURE_ROOT });

    expect(typeof result.swiftFiles).toBe('number');
    expect(result.swiftFiles).toBeGreaterThan(0);
    expect(typeof result.objcFiles).toBe('number');
    expect(Array.isArray(result.viewControllers)).toBe(true);
    expect(Array.isArray(result.protocols)).toBe(true);
    expect(Array.isArray(result.storyboardRefs)).toBe(true);
    expect(Array.isArray(result.xibRefs)).toBe(true);
  });

  it('scanResources returns ResourceFacts with correct shape (task 2.2)', async () => {
    const backend = createXcodeProjAnalyzerBackend();
    const result = await backend.scanResources({ root: FIXTURE_ROOT });

    expect(typeof result.assetCatalogs).toBe('number');
    expect(result.assetCatalogs).toBeGreaterThan(0);
    expect(Array.isArray(result.fontFiles)).toBe(true);
    expect(Array.isArray(result.localizedStrings)).toBe(true);
    expect(Array.isArray(result.infoPlistKeys)).toBe(true);
    expect(result.infoPlistKeys.length).toBeGreaterThan(0);
  });
});
