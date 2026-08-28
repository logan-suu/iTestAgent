import { describe, expect, it } from 'bun:test';
import { applyRetentionToTranscript } from '../src/message-retention.js';

describe('applyRetentionToTranscript', () => {
  it('caps a transcript to the retention window', () => {
    const transcript = ['a', 'b', 'c', 'd'];
    expect(applyRetentionToTranscript(transcript, 2)).toEqual(['c', 'd']);
  });
});
