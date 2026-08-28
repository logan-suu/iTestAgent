import { describe, expect, it } from 'bun:test';
import { resolveRunnerPorts } from '../src/memory-profile-runner-ports.js';

describe('resolveRunnerPorts', () => {
  it('resolves a sensible default', () => {
    const result = resolveRunnerPorts({});
    expect(result).toBeDefined();
  });
});
