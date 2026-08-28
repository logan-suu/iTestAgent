import { describe, expect, it } from 'bun:test';
import { analyzeInstruction } from '../src/analysis/instruction-analyzer.js';

describe('analyzeInstruction', () => {
  it('classifies an explore request', () => {
    expect(analyzeInstruction('explore the login flow').intent).toBe('explore');
  });
  it('classifies a smoke request', () => {
    expect(analyzeInstruction('run smoke test').intent).toBe('smoke');
  });
});
