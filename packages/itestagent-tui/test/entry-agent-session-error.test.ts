import { describe, expect, it } from 'bun:test';
import { agentSessionErrorMessage } from '../src/entry.js';

describe('agentSessionErrorMessage', () => {
  it('maps an error to a readable message', () => {
    expect(agentSessionErrorMessage(new Error('boom'))).toContain('boom');
  });
});
