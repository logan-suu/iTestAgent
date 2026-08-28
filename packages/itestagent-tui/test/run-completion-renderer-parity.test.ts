import { describe, expect, it } from 'bun:test';
import { completionRendererParity } from '../src/run-completion-presentation.js';

describe('completionRendererParity', () => {
  it('reports equal when presentations match', () => {
    expect(completionRendererParity('a', 'a').equal).toBe(true);
  });
});
