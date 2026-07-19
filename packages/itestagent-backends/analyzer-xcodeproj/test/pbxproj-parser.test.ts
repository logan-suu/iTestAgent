import { describe, expect, it } from 'bun:test';
import { readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { classifyProductType, isUnitTest, isXCUITest, parsePbxproj } from '../src/pbxproj-parser';

const FIXTURE_DIR = resolve(import.meta.dir, 'fixtures');

describe('parsePbxproj', () => {
  it('parses a valid project.pbxproj and extracts target info', () => {
    const pbxprojPath = resolve(FIXTURE_DIR, 'project.pbxproj');
    const result = parsePbxproj(pbxprojPath);

    expect(result).not.toBeNull();
    if (!result) return;

    // rootObject is defined in the fixture — verify it's a non-empty 24-char hex string
    expect(result.rootObject).toMatch(/^[0-9A-F]{24}$/);
    expect(result.targets).toHaveLength(3);

    // MyApp
    const appTarget = result.targets.find((t) => t.name === 'MyApp');
    expect(appTarget).toBeDefined();
    if (appTarget) {
      expect(appTarget.productType).toBe('com.apple.product-type.application');
      expect(appTarget.dependencyTargetNames).toEqual([]);
    }

    // MyAppTests
    const testTarget = result.targets.find((t) => t.name === 'MyAppTests');
    expect(testTarget).toBeDefined();
    if (testTarget) {
      expect(testTarget.productType).toBe('com.apple.product-type.bundle.unit-test');
      // Should resolve PBXTargetDependency → MyApp
      expect(testTarget.dependencyTargetNames).toContain('MyApp');
    }

    // MyAppUITests
    const uiTestTarget = result.targets.find((t) => t.name === 'MyAppUITests');
    expect(uiTestTarget).toBeDefined();
    if (uiTestTarget) {
      expect(uiTestTarget.productType).toBe('com.apple.product-type.bundle.ui-testing');
      expect(uiTestTarget.dependencyTargetNames).toContain('MyApp');
    }
  });

  it('returns null for non-existent file', () => {
    const result = parsePbxproj('/non/existent/path/project.pbxproj');
    expect(result).toBeNull();
  });

  it('returns empty targets when pbxproj has no PBXNativeTarget section', () => {
    const pbxprojWithNoTargets =
      '// !$*UTF8*$!\n{\n\tarchiveVersion = 1;\n\tobjects = {\n};\n\trootObject = 7627B99262ADE7B14DDB4D37;\n}\n';
    const tmpPath = resolve(FIXTURE_DIR, 'empty-project.pbxproj');
    writeFileSync(tmpPath, pbxprojWithNoTargets, 'utf-8');

    try {
      const result = parsePbxproj(tmpPath);
      expect(result).not.toBeNull();
      if (result) {
        expect(result.targets).toEqual([]);
        expect(result.rootObject).toBe('7627B99262ADE7B14DDB4D37');
      }
    } finally {
      unlinkSync(tmpPath);
    }
  });
});

describe('classifyProductType', () => {
  it('classifies app product type', () => {
    expect(classifyProductType('com.apple.product-type.application')).toBe('app');
    expect(classifyProductType('com.apple.product-type.application.watchapp2')).toBe('app');
  });

  it('classifies framework product type', () => {
    expect(classifyProductType('com.apple.product-type.framework')).toBe('framework');
    expect(classifyProductType('com.apple.product-type.library.static')).toBe('framework');
  });

  it('classifies test product type', () => {
    expect(classifyProductType('com.apple.product-type.bundle.unit-test')).toBe('test');
    expect(classifyProductType('com.apple.product-type.bundle.ui-testing')).toBe('test');
  });

  it('classifies bundle product type', () => {
    expect(classifyProductType('com.apple.product-type.bundle')).toBe('bundle');
    expect(classifyProductType('com.apple.product-type.app-extension')).toBe('bundle');
  });

  it('classifies unknown as other', () => {
    expect(classifyProductType('com.apple.product-type.tool')).toBe('other');
    expect(classifyProductType('')).toBe('other');
  });
});

describe('isXCUITest', () => {
  it('returns true for UI testing product type', () => {
    expect(isXCUITest('com.apple.product-type.bundle.ui-testing')).toBe(true);
  });

  it('returns false for other types', () => {
    expect(isXCUITest('com.apple.product-type.bundle.unit-test')).toBe(false);
    expect(isXCUITest('com.apple.product-type.application')).toBe(false);
  });
});

describe('isUnitTest', () => {
  it('returns true for unit testing product type', () => {
    expect(isUnitTest('com.apple.product-type.bundle.unit-test')).toBe(true);
  });

  it('returns false for other types', () => {
    expect(isUnitTest('com.apple.product-type.bundle.ui-testing')).toBe(false);
    expect(isUnitTest('com.apple.product-type.application')).toBe(false);
  });
});
