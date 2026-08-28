import { describe, expect, it } from 'bun:test';
import { summarizeProjectAssets } from '../src/analysis/project-analyzer.js';

describe('summarizeProjectAssets', () => {
  it('flags whether xcuitest is present', () => {
    expect(summarizeProjectAssets({ hasXCUITests: true }).hasXcuitest).toBe(true);
    expect(summarizeProjectAssets({ hasXCUITests: false }).hasXcuitest).toBe(false);
  });
});
