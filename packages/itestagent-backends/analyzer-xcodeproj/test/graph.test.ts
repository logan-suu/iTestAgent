import { describe, expect, it } from 'bun:test';
import { resolve } from 'node:path';
import { ProjectGraphSchema } from 'itestagent-contracts';
import type { ProjectDiscovery, ProjectGraph } from 'itestagent-contracts';
import { graph } from '../src/graph';

const FIXTURE_DIR = resolve(import.meta.dir, 'fixtures');

describe('graph — ProjectGraph schema', () => {
  it('validates a basic ProjectGraph', () => {
    const graph: ProjectGraph = {
      targets: [
        {
          name: 'MyApp',
          type: 'app',
          dependencies: [],
          sourceCount: 42,
        },
        {
          name: 'MyAppTests',
          type: 'test',
          dependencies: ['MyApp'],
          testCount: 5,
        },
        {
          name: 'MyAppUITests',
          type: 'test',
          dependencies: ['MyApp'],
          testCount: 3,
        },
      ],
      hasXCUITests: true,
      hasUnitTests: true,
    };

    const result = ProjectGraphSchema.safeParse(graph);
    expect(result.success).toBe(true);
  });

  it('validates a project with no tests', () => {
    const graph: ProjectGraph = {
      targets: [
        {
          name: 'MyApp',
          type: 'app',
          dependencies: [],
        },
      ],
      hasXCUITests: false,
      hasUnitTests: false,
    };

    const result = ProjectGraphSchema.safeParse(graph);
    expect(result.success).toBe(true);
  });

  it('validates framework target type', () => {
    const graph: ProjectGraph = {
      targets: [
        {
          name: 'MyFramework',
          type: 'framework',
          dependencies: [],
        },
      ],
      hasXCUITests: false,
      hasUnitTests: false,
    };

    const result = ProjectGraphSchema.safeParse(graph);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.targets[0]?.type).toBe('framework');
    }
  });

  it('rejects invalid target type', () => {
    const result = ProjectGraphSchema.safeParse({
      targets: [
        {
          name: 'BadTarget',
          type: 'invalid_type',
          dependencies: [],
        },
      ],
      hasXCUITests: false,
      hasUnitTests: false,
    });

    expect(result.success).toBe(false);
  });

  it('rejects missing required fields', () => {
    const result = ProjectGraphSchema.safeParse({
      targets: [],
    });

    expect(result.success).toBe(false);
  });

  it('rejects extra fields (strict schema)', () => {
    const result = ProjectGraphSchema.safeParse({
      targets: [],
      hasXCUITests: false,
      hasUnitTests: false,
      extraField: 'nope',
    });
    expect(result.success).toBe(false);
  });
});

describe('graph() integration', () => {
  it('resolves targets from real pbxproj fixture with both direct and indirect dependencies', async () => {
    const pbxprojDir = resolve(FIXTURE_DIR, '..', '..');
    // Create discovery pointing at the fixture as a direct xcodeproj
    const discovery: ProjectDiscovery = {
      root: pbxprojDir,
      name: 'MyApp',
      type: 'xcode_project',
      xcodeprojPath: FIXTURE_DIR,
      schemes: ['MyApp'],
      configurations: ['Debug', 'Release'],
    };

    const result = await graph(discovery);

    // Validate via schema
    const parsed = ProjectGraphSchema.safeParse(result);
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;

    // Check targets
    expect(result.targets).toHaveLength(3);
    const targetNames = result.targets.map((t) => t.name);
    expect(targetNames).toContain('MyApp');
    expect(targetNames).toContain('MyAppTests');
    expect(targetNames).toContain('MyAppUITests');

    // XCUITest detection
    expect(result.hasXCUITests).toBe(true);
    expect(result.hasUnitTests).toBe(true);

    // Direct dependency: MyAppTests → MyApp
    const testTarget = result.targets.find((t) => t.name === 'MyAppTests');
    expect(testTarget).toBeDefined();
    if (testTarget) {
      expect(testTarget.dependencies).toContain('MyApp');
    }

    // Indirect dependency: MyAppUITests → MyApp (via targetProxy)
    const uiTarget = result.targets.find((t) => t.name === 'MyAppUITests');
    expect(uiTarget).toBeDefined();
    if (uiTarget) {
      expect(uiTarget.dependencies).toContain('MyApp');
    }

    // App target has no dependencies
    const appTarget = result.targets.find((t) => t.name === 'MyApp');
    expect(appTarget).toBeDefined();
    if (appTarget) {
      expect(appTarget.dependencies).toEqual([]);
    }
  });

  it('throws when no .xcodeproj can be found', async () => {
    const discovery: ProjectDiscovery = {
      root: '/tmp/nonexistent-project',
      name: 'GhostApp',
      type: 'xcode_project',
      schemes: [],
      configurations: [],
    };

    await expect(graph(discovery)).rejects.toThrow('Cannot find project.pbxproj');
  });
});
