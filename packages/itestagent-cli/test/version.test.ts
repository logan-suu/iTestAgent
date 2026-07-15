import { expect, test } from 'bun:test';
import { VERSION } from '../src/version.js';

test('VERSION is a string', () => {
  expect(typeof VERSION).toBe('string');
});

test('VERSION equals 0.0.1 (from package.json)', () => {
  expect(VERSION).toBe('0.0.1');
});
