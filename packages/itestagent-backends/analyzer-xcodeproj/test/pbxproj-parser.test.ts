import { describe, expect, it } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { classifyProductType, isUnitTest, isXCUITest, parsePbxproj } from '../src/pbxproj-parser';

const FIXTURE_DIR = resolve(import.meta.dir, 'fixtures');

function withTempPbxproj(content: string, fn: (path: string) => void): void {
  const dir = mkdtempSync(resolve(tmpdir(), 'pbxproj-test-'));
  try {
    const path = resolve(dir, 'project.pbxproj');
    writeFileSync(path, content, 'utf-8');
    fn(path);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

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
      // Resolved through indirect targetProxy → PBXContainerItemProxy → remoteGlobalIDString
      expect(uiTestTarget.dependencyTargetNames).toContain('MyApp');
    }
  });

  it('resolves indirect dependencies via targetProxy → PBXContainerItemProxy → remoteGlobalIDString', () => {
    const pbxprojPath = resolve(FIXTURE_DIR, 'project.pbxproj');
    const result = parsePbxproj(pbxprojPath);

    expect(result).not.toBeNull();
    if (!result) return;

    // MyAppUITests uses B2C3D4E5F6789012345678A1 (indirect dependency)
    const uiTestTarget = result.targets.find((t) => t.name === 'MyAppUITests');
    expect(uiTestTarget).toBeDefined();
    if (uiTestTarget) {
      // Must resolve to 'MyApp' through the indirect chain
      expect(uiTestTarget.dependencyTargetNames).toContain('MyApp');
      expect(uiTestTarget.dependencyTargetNames).toHaveLength(1);
    }

    // MyAppTests uses C1FF1611A14380E6A332B5FA (direct dependency) — still works
    const testTarget = result.targets.find((t) => t.name === 'MyAppTests');
    expect(testTarget).toBeDefined();
    if (testTarget) {
      expect(testTarget.dependencyTargetNames).toContain('MyApp');
    }

    // MyApp has no dependencies
    const appTarget = result.targets.find((t) => t.name === 'MyApp');
    expect(appTarget).toBeDefined();
    if (appTarget) {
      expect(appTarget.dependencyTargetNames).toEqual([]);
    }
  });

  it('returns null for non-existent file', () => {
    const result = parsePbxproj('/non/existent/path/project.pbxproj');
    expect(result).toBeNull();
  });

  it('returns empty targets when pbxproj has no PBXNativeTarget section', () => {
    const pbxprojWithNoTargets =
      '// !$*UTF8*$!\n{\n\tarchiveVersion = 1;\n\tobjects = {\n};\n\trootObject = 7627B99262ADE7B14DDB4D37;\n}\n';
    withTempPbxproj(pbxprojWithNoTargets, (tmpPath) => {
      const result = parsePbxproj(tmpPath);
      expect(result).not.toBeNull();
      if (result) {
        expect(result.targets).toEqual([]);
        expect(result.rootObject).toBe('7627B99262ADE7B14DDB4D37');
      }
    });
  });

  it('returns empty rootObject when pbxproj has no rootObject key', () => {
    const pbxprojWithoutRoot = '// !$*UTF8*$!\n{\n\tarchiveVersion = 1;\n\tobjects = {\n};\n}\n';
    withTempPbxproj(pbxprojWithoutRoot, (tmpPath) => {
      const result = parsePbxproj(tmpPath);
      expect(result).not.toBeNull();
      if (result) {
        expect(result.rootObject).toBe('');
        expect(result.targets).toEqual([]);
      }
    });
  });

  it('returns null when the path is a directory (unreadable as file)', () => {
    const result = parsePbxproj(FIXTURE_DIR);
    expect(result).toBeNull();
  });

  it('resolves targets to no dependency names when dependency UUIDs are dangling', () => {
    const danglingDepPbxproj = `// !$*UTF8*$!
{
	archiveVersion = 1;
	objects = {
/* Begin PBXNativeTarget section */
		AABBCCDDEEFF001122334455 /* MyApp */ = {
			isa = PBXNativeTarget;
			name = MyApp;
			productName = MyApp;
			productType = "com.apple.product-type.application";
			dependencies = (
				EEEEFFFF0000111122223334 /* PBXTargetDependency */,
			);
		};
/* End PBXNativeTarget section */
	};
	rootObject = 7627B99262ADE7B14DDB4D37;
}
`;
    withTempPbxproj(danglingDepPbxproj, (tmpPath) => {
      const result = parsePbxproj(tmpPath);
      expect(result).not.toBeNull();
      if (result) {
        expect(result.targets).toHaveLength(1);
        expect(result.targets[0]?.name).toBe('MyApp');
        expect(result.targets[0]?.dependencyTargetNames).toEqual([]);
      }
    });
  });
});

describe('classifyProductType', () => {
  it('classifies app product type', () => {
    expect(classifyProductType('com.apple.product-type.application')).toBe('app');
    expect(classifyProductType('com.apple.product-type.application.watchapp2')).toBe('app');
    expect(classifyProductType('com.apple.product-type.application.watchapp')).toBe('app');
  });

  it('classifies framework product type', () => {
    expect(classifyProductType('com.apple.product-type.framework')).toBe('framework');
    expect(classifyProductType('com.apple.product-type.framework.static')).toBe('framework');
    expect(classifyProductType('com.apple.product-type.library.static')).toBe('framework');
    expect(classifyProductType('com.apple.product-type.library.dynamic')).toBe('framework');
  });

  it('classifies test product type', () => {
    expect(classifyProductType('com.apple.product-type.bundle.unit-test')).toBe('test');
    expect(classifyProductType('com.apple.product-type.bundle.ui-testing')).toBe('test');
  });

  it('classifies bundle product type', () => {
    expect(classifyProductType('com.apple.product-type.bundle')).toBe('bundle');
    expect(classifyProductType('com.apple.product-type.app-extension')).toBe('bundle');
    expect(classifyProductType('com.apple.product-type.watchkit2-extension')).toBe('bundle');
    expect(classifyProductType('com.apple.product-type.tv-app-extension')).toBe('bundle');
    expect(classifyProductType('com.apple.product-type.xcode-extension')).toBe('bundle');
  });

  it('classifies unknown as other', () => {
    expect(classifyProductType('com.apple.product-type.tool')).toBe('other');
    expect(classifyProductType('not-a-real-product-type')).toBe('other');
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
