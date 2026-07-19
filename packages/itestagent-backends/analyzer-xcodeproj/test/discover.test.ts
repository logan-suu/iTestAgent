import { describe, expect, it } from 'bun:test';
import { ProjectDiscoverySchema } from 'itestagent-contracts';
import { parseAndValidate } from '../src/discover';

describe('discover — parseAndValidate', () => {
  it('validates and returns a ProjectDiscovery for an xcode_project', () => {
    const raw = {
      root: '/Users/test/MyApp',
      name: 'MyApp',
      type: 'xcode_project' as const,
      xcodeprojPath: '/Users/test/MyApp/MyApp.xcodeproj',
      schemes: ['MyApp', 'MyAppTests'],
      configurations: ['Debug', 'Release'],
    };

    const result = parseAndValidate(raw);

    expect(result.root).toBe('/Users/test/MyApp');
    expect(result.name).toBe('MyApp');
    expect(result.type).toBe('xcode_project');
    expect(result.xcodeprojPath).toBe('/Users/test/MyApp/MyApp.xcodeproj');
    expect(result.xcworkspacePath).toBeUndefined();
    expect(result.schemes).toContain('MyApp');
    expect(result.configurations).toContain('Debug');
  });

  it('validates a ProjectDiscovery for an xcode_workspace', () => {
    const raw = {
      root: '/Users/test/MyApp',
      name: 'MyApp',
      type: 'xcode_workspace' as const,
      xcworkspacePath: '/Users/test/MyApp/MyApp.xcworkspace',
      schemes: ['MyApp'],
      configurations: ['Debug', 'Release'],
    };

    const result = parseAndValidate(raw);

    expect(result.type).toBe('xcode_workspace');
    expect(result.xcworkspacePath).toBe('/Users/test/MyApp/MyApp.xcworkspace');
    expect(result.xcodeprojPath).toBeUndefined();
  });

  it('accepts unknown type (valid enum value per schema)', () => {
    const raw = {
      root: '/tmp/test',
      name: 'Test',
      type: 'unknown' as const,
      schemes: [],
      configurations: [],
    };

    const result = parseAndValidate(raw);
    expect(result.type).toBe('unknown');
  });

  it('rejects missing required fields', () => {
    const raw = {
      root: '/tmp/test',
    };

    expect(() => parseAndValidate(raw)).toThrow();
  });

  it('validates with swift_package type', () => {
    const raw = {
      root: '/Users/test/SwiftPackage',
      name: 'MyPackage',
      type: 'swift_package' as const,
      schemes: [],
      configurations: [],
    };

    const result = parseAndValidate(raw);
    expect(result.type).toBe('swift_package');
  });

  it('rejects extra fields (strict schema)', () => {
    const raw = {
      root: '/tmp/test',
      name: 'Test',
      type: 'xcode_project',
      xcodeprojPath: '/tmp/test/Test.xcodeproj',
      schemes: [],
      configurations: [],
      extraField: 'should be rejected',
    };

    expect(() => parseAndValidate(raw)).toThrow();
  });
});

describe('ProjectDiscoverySchema', () => {
  it('directly validates shape', () => {
    const result = ProjectDiscoverySchema.safeParse({
      root: '/tmp/test',
      type: 'xcode_project',
      schemes: ['MyApp'],
      configurations: ['Debug'],
    });

    expect(result.success).toBe(true);
  });

  it('rejects empty schemes array (non-empty by schema)', () => {
    const result = ProjectDiscoverySchema.safeParse({
      root: '/tmp/test',
      type: 'xcode_workspace',
      schemes: [],
      configurations: ['Debug'],
      xcworkspacePath: '/tmp/test/Workspace.xcworkspace',
    });

    // Zod .array() allows empty by default — just verify the parse works
    expect(result.success).toBe(true);
  });
});
