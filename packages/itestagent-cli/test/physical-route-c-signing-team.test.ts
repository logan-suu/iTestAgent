import { describe, expect, it } from 'bun:test';
import { resolveSigningTeam } from '../src/signing-certificate-team.js';

describe('resolveSigningTeam', () => {
  it('keeps an injected team id memory-only', () => {
    expect(resolveSigningTeam({ teamId: 'TEAM-X' }).teamId).toBe('TEAM-X');
  });
});
