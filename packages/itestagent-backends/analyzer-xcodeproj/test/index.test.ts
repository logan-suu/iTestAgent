import { describe, expect, it } from 'bun:test';
import { createXcodeProjAnalyzerBackend } from '../src/index';

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

  it('throws "not implemented" for scanSources (deferred to 2.2)', async () => {
    const backend = createXcodeProjAnalyzerBackend();

    await expect(backend.scanSources({ root: '/fake' })).rejects.toThrow('not yet implemented');
  });

  it('throws "not implemented" for scanResources (deferred to 2.2)', async () => {
    const backend = createXcodeProjAnalyzerBackend();

    await expect(backend.scanResources({ root: '/fake' })).rejects.toThrow('not yet implemented');
  });
});
