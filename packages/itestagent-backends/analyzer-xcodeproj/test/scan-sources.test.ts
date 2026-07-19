import { describe, expect, it } from 'bun:test';
import { join } from 'node:path';
import type { SourceFacts } from 'itestagent-contracts';
import { scanSources } from '../src/scan-sources';

const FIXTURE_ROOT = join(import.meta.dir, 'fixtures', 'sample-project');

describe('scanSources', () => {
  it('returns correct swift and objc file counts', async () => {
    const result = await scanSources({ root: FIXTURE_ROOT, includeTestFiles: true });

    expect(result.swiftFiles).toBeGreaterThanOrEqual(3); // 3 Swift source files
    expect(result.objcFiles).toBeGreaterThanOrEqual(1); // 1 ObjC source file
  });

  it('excludes test files by default (AC3: exclude test dirs)', async () => {
    const result = await scanSources({ root: FIXTURE_ROOT });

    // Should NOT include test directory files
    expect(result.swiftFiles).toBeGreaterThanOrEqual(2); // Only app Swift files, not test files
    // Verify no test files are in viewControllers
    const testVCs = result.viewControllers.filter((vc) => vc.file.includes('Tests'));
    expect(testVCs).toHaveLength(0);
  });

  it('includes test files when includeTestFiles is true', async () => {
    const result = await scanSources({ root: FIXTURE_ROOT, includeTestFiles: true });

    expect(result.swiftFiles).toBeGreaterThanOrEqual(3); // Including test files
  });

  it('detects ViewController subclasses (UIKit)', async () => {
    const result = await scanSources({ root: FIXTURE_ROOT });

    const vcNames = result.viewControllers.map((vc) => vc.name);

    expect(vcNames).toContain('LoginViewController');
    expect(vcNames).toContain('SettingsViewController');
    expect(vcNames).toContain('HomeViewController');
    expect(vcNames).toContain('ProfileViewController');
    expect(vcNames).toContain('DetailViewController');
    // Should also detect ObjC VCs
    expect(vcNames).toContain('LegacyViewController');
  });

  it('detects SwiftUI View structs', async () => {
    const result = await scanSources({ root: FIXTURE_ROOT });

    const vcNames = result.viewControllers.map((vc) => vc.name);
    expect(vcNames).toContain('ContentView');
    expect(vcNames).toContain('SettingsView');
  });

  it('detects protocol declarations', async () => {
    const result = await scanSources({ root: FIXTURE_ROOT });

    expect(result.protocols).toContain('ProfileDelegate');
    expect(result.protocols).toContain('DataFetching');
    expect(result.protocols).toContain('DetailDelegate');
  });

  it('detects storyboard references from UIStoryboard calls', async () => {
    const result = await scanSources({ root: FIXTURE_ROOT });

    expect(result.storyboardRefs).toContain('Main.storyboard');
  });

  it('detects XIB references from UINib calls', async () => {
    const result = await scanSources({ root: FIXTURE_ROOT });

    expect(result.xibRefs).toContain('DetailView.xib');
  });

  it('filters by target directories when specified', async () => {
    const result = await scanSources({
      root: FIXTURE_ROOT,
      targets: ['SampleApp'],
      includeTestFiles: true,
    });

    // Should still include SampleApp/ files
    const vcNames = result.viewControllers.map((vc) => vc.name);
    expect(vcNames).toContain('LoginViewController');
  });

  it('returns empty results for non-existent root', async () => {
    const result = await scanSources({ root: '/nonexistent/path' });

    expect(result).toEqual({
      swiftFiles: 0,
      objcFiles: 0,
      viewControllers: [],
      protocols: [],
      storyboardRefs: [],
      xibRefs: [],
    } satisfies SourceFacts);
  });

  it('respects .gitignore: excludes DerivedData', async () => {
    // The DerivedData directory contains a test file that should be excluded
    const result = await scanSources({ root: FIXTURE_ROOT, includeTestFiles: true });

    // No files from DerivedData should appear
    const derivedDataVCs = result.viewControllers.filter((vc) => vc.file.includes('DerivedData'));
    expect(derivedDataVCs).toHaveLength(0);
  });

  it('returns SourceFacts shape matching schema', async () => {
    const result = await scanSources({ root: FIXTURE_ROOT });

    expect(typeof result.swiftFiles).toBe('number');
    expect(typeof result.objcFiles).toBe('number');
    expect(Array.isArray(result.viewControllers)).toBe(true);
    expect(Array.isArray(result.protocols)).toBe(true);
    expect(Array.isArray(result.storyboardRefs)).toBe(true);
    expect(Array.isArray(result.xibRefs)).toBe(true);

    // ViewControllers have correct shape
    for (const vc of result.viewControllers) {
      expect(typeof vc.name).toBe('string');
      expect(typeof vc.file).toBe('string');
      expect(vc.name.length).toBeGreaterThan(0);
      expect(vc.file.length).toBeGreaterThan(0);
    }
  });

  it('deduplicates ViewControllers within the same file', async () => {
    const result = await scanSources({ root: FIXTURE_ROOT });

    // LoginViewController should appear only once
    const loginVCs = result.viewControllers.filter((vc) => vc.name === 'LoginViewController');
    expect(loginVCs).toHaveLength(1);
  });

  it('sorts protocols alphabetically', async () => {
    const result = await scanSources({ root: FIXTURE_ROOT });

    // Protocols should be sorted
    const sorted = [...result.protocols].sort();
    expect(result.protocols).toEqual(sorted);
  });
});
