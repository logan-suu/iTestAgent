import { describe, expect, it } from 'bun:test';
import { join } from 'node:path';
import type { ResourceFacts } from 'itestagent-contracts';
import { scanResources } from '../src/scan-resources';

const FIXTURE_ROOT = join(import.meta.dir, 'fixtures', 'sample-project');

describe('scanResources', () => {
  it('detects asset catalogs (.xcassets directories)', async () => {
    const result = await scanResources({ root: FIXTURE_ROOT });

    expect(result.assetCatalogs).toBeGreaterThanOrEqual(1);
  });

  it('detects font files (.ttf and .otf)', async () => {
    const result = await scanResources({ root: FIXTURE_ROOT });

    expect(result.fontFiles.length).toBeGreaterThanOrEqual(2);

    const fontPaths = result.fontFiles.map((f) => f.replace(/\\/g, '/'));
    const ttfCount = fontPaths.filter((f) => f.endsWith('.ttf')).length;
    const otfCount = fontPaths.filter((f) => f.endsWith('.otf')).length;

    expect(ttfCount).toBeGreaterThanOrEqual(1);
    expect(otfCount).toBeGreaterThanOrEqual(1);
  });

  it('detects localized strings (.strings files)', async () => {
    const result = await scanResources({ root: FIXTURE_ROOT });

    expect(result.localizedStrings.length).toBeGreaterThanOrEqual(1);

    const stringPaths = result.localizedStrings.map((f) => f.replace(/\\/g, '/'));
    const enStrings = stringPaths.filter((f) => f.includes('en.lproj/Localizable.strings'));
    const zhStrings = stringPaths.filter((f) => f.includes('zh-Hans.lproj/Localizable.strings'));

    // At least one EN strings file should be found
    expect(enStrings.length).toBeGreaterThanOrEqual(1);
  });

  it('parses entitlements keys', async () => {
    const result = await scanResources({ root: FIXTURE_ROOT });

    // entitlements should be defined since we have a .entitlements file
    expect(result.entitlements).toBeDefined();

    if (result.entitlements) {
      const keys = Object.keys(result.entitlements);
      expect(keys).toContain('aps-environment');
      expect(keys).toContain('com.apple.developer.associated-domains');
      expect(keys).toContain('com.apple.security.application-groups');
    }
  });

  it('parses Info.plist keys', async () => {
    const result = await scanResources({ root: FIXTURE_ROOT });

    expect(result.infoPlistKeys.length).toBeGreaterThan(0);
    expect(result.infoPlistKeys).toContain('CFBundleName');
    expect(result.infoPlistKeys).toContain('CFBundleIdentifier');
    expect(result.infoPlistKeys).toContain('CFBundleVersion');
    expect(result.infoPlistKeys).toContain('CFBundleShortVersionString');
    expect(result.infoPlistKeys).toContain('UILaunchStoryboardName');
    expect(result.infoPlistKeys).toContain('UISupportedInterfaceOrientations');
    expect(result.infoPlistKeys).toContain('NSAppTransportSecurity');
  });

  it('sorts Info.plist keys alphabetically', async () => {
    const result = await scanResources({ root: FIXTURE_ROOT });

    const sorted = [...result.infoPlistKeys].sort();
    expect(result.infoPlistKeys).toEqual(sorted);
  });

  it('returns zero assetCatalogs for empty directory', async () => {
    const result = await scanResources({ root: '/nonexistent/path' });

    expect(result.assetCatalogs).toBe(0);
    expect(result.fontFiles).toEqual([]);
    expect(result.localizedStrings).toEqual([]);
    expect(result.entitlements).toBeUndefined();
    expect(result.infoPlistKeys).toEqual([]);
  });

  it('returns ResourceFacts shape matching schema', async () => {
    const result = await scanResources({ root: FIXTURE_ROOT });

    expect(typeof result.assetCatalogs).toBe('number');
    expect(Number.isInteger(result.assetCatalogs)).toBe(true);
    expect(result.assetCatalogs).toBeGreaterThanOrEqual(0);

    expect(Array.isArray(result.fontFiles)).toBe(true);
    expect(Array.isArray(result.localizedStrings)).toBe(true);

    if (result.entitlements) {
      expect(typeof result.entitlements).toBe('object');
    }

    expect(Array.isArray(result.infoPlistKeys)).toBe(true);

    // All keys should be strings
    for (const key of result.infoPlistKeys) {
      expect(typeof key).toBe('string');
    }
  });

  it('respects .gitignore: does not scan DerivedData', async () => {
    const result = await scanResources({ root: FIXTURE_ROOT });

    // No file paths should contain DerivedData
    for (const file of result.fontFiles) {
      expect(file).not.toContain('DerivedData');
    }
    for (const file of result.localizedStrings) {
      expect(file).not.toContain('DerivedData');
    }
  });
});
