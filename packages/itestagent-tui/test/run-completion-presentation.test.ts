import { describe, expect, it } from 'bun:test';
import { presentRunCompletion } from '../src/run-completion-presentation.js';

describe('presentRunCompletion', () => {
  it('presents a passed run summary', () => {
    expect(presentRunCompletion({ status: 'passed' }).status).toBe('passed');
  });
});
