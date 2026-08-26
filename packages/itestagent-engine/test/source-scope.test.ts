import { describe, expect, it } from 'bun:test';
import { resolveSourceScope } from '../src/analysis/source-scope.js';

describe('resolveSourceScope', () => {
  it('sums swift and objc file counts', () => {
    expect(resolveSourceScope({ swiftFiles: 10, objcFiles: 2 }).totalFiles).toBe(12);
  });
});
