import { describe, expect, it } from 'bun:test';
import { ProjectGraphSchema } from 'itestagent-contracts';
import type { ProjectGraph } from 'itestagent-contracts';

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
