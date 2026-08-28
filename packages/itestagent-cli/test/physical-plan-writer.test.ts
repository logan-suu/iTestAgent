import { describe, expect, it } from 'bun:test';
import { writePhysicalPlan } from '../src/physical-plan-writer.js';

describe('writePhysicalPlan', () => {
  it('writes the plan yaml through injected fs', async () => {
    const written = new Map<string, string>();
    const plan = await writePhysicalPlan(
      '/fixture',
      { runId: 'run-x' },
      {
        writeFile: async (p, c) => {
          written.set(p, c);
        },
      },
    );
    expect(plan.path.endsWith('plan.yaml')).toBe(true);
    expect(written.size).toBe(1);
  });
});
