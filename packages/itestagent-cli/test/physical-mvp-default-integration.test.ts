import { describe, expect, it } from 'bun:test';
import { createPhysicalMvpFactory } from '../src/physical-mvp-factory.js';

describe('createPhysicalMvpFactory', () => {
  it('builds a physical mvp runner through the factory', () => {
    const factory = createPhysicalMvpFactory({});
    expect(typeof factory.create).toBe('function');
  });
});
